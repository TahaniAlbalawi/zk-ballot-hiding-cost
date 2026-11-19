import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const circuitsRoot = path.resolve(scriptDir, "..");
const repositoryRoot = path.resolve(circuitsRoot, "..");
const buildRoot = path.join(circuitsRoot, "build");
const entryRoot = path.join(buildRoot, "entrypoints");
const outputRoot = path.join(buildRoot, "configurations");
const registry = JSON.parse(readFileSync(path.join(circuitsRoot, "configurations.json"), "utf8"));

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function assertRegistry() {
  // Depths 3, 5, 7, 8, 9 and 10 (with C = 2, 4 and 8 at depth 10) and the depth sweep 12,
  // 13, 16 and 20; depth 13 is the predicted Groth16 domain threshold for the commitment circuit.
  const expected = ["D03-C04", "D05-C04", "D07-C04", "D08-C04", "D09-C04", "D10-C02", "D10-C04", "D10-C08", "D12-C04", "D13-C04", "D16-C04", "D20-C04"];
  if (registry.configuration_registry_version !== "CMC-CONFIG-ARTIFACTS-v1" || !Array.isArray(registry.configurations)) {
    throw new Error("configuration registry version or shape is invalid");
  }
  const ids = registry.configurations.map((item) => item.configuration_id);
  if (ids.length !== expected.length || [...ids].sort().join("|") !== expected.sort().join("|")) {
    throw new Error("configuration registry must contain exactly the registered D/C set");
  }
  for (const item of registry.configurations) {
    if (!Number.isSafeInteger(item.merkle_depth_d) || !Number.isSafeInteger(item.candidate_count_c)) {
      throw new Error(`invalid configuration values for ${item.configuration_id}`);
    }
    if (item.configuration_id !== `D${String(item.merkle_depth_d).padStart(2, "0")}-C${String(item.candidate_count_c).padStart(2, "0")}`) {
      throw new Error(`configuration identifier does not bind D/C values: ${item.configuration_id}`);
    }
  }
}

function run(command, args, logPath) {
  writeFileSync(logPath, `$ ${[command, ...args].join(" ")}\n`, { flag: "a" });
  const result = spawnSync(command, args, { cwd: repositoryRoot, encoding: "utf8" });
  writeFileSync(logPath, `${result.stdout ?? ""}${result.stderr ?? ""}`, { flag: "a" });
  if (result.status !== 0) throw new Error(`${command} failed for ${logPath}`);
}

function entrypoint(mode, circuitName, configuration) {
  const template = mode === "public" ? "VoteProof" : "VoteProofPrivate";
  const publicSignals = mode === "public"
    ? "root, nullifier, electionId, vote, candidateCount, voter"
    : "root, nullifier, electionId, candidateCount, commitment, voter";
  return `pragma circom 2.1.6;\ninclude \"../../circuits/${template}.circom\";\ncomponent main {public [${publicSignals}]} = ${template}(${configuration.merkle_depth_d}, ${configuration.candidate_count_c});\n`;
}

assertRegistry();
rmSync(outputRoot, { recursive: true, force: true });
rmSync(entryRoot, { recursive: true, force: true });
mkdirSync(outputRoot, { recursive: true });
mkdirSync(entryRoot, { recursive: true });

for (const configuration of registry.configurations) {
  for (const mode of ["public", "commitment"]) {
    const template = mode === "public" ? "VoteProof" : "VoteProofPrivate";
    const circuitName = `${template}_${configuration.configuration_id.replace("-", "_")}`;
    const bundleDir = path.join(outputRoot, configuration.configuration_id, mode);
    const logPath = path.join(bundleDir, "build.log");
    const entryPath = path.join(entryRoot, `${circuitName}.circom`);
    mkdirSync(bundleDir, { recursive: true });
    writeFileSync(entryPath, entrypoint(mode, circuitName, configuration), "utf8");
    writeFileSync(logPath, `CMC configuration compilation\nconfiguration_id=${configuration.configuration_id}\nworkflow_mode=${mode === "public" ? "PUBLIC_DISCLOSURE" : "COMMITMENT_BALLOT_HIDING"}\nentrypoint_sha256=${sha256(readFileSync(entryPath))}\n`, "utf8");
    run("circom", [entryPath, "--r1cs", "--wasm", "--sym", "-o", bundleDir, "-l", path.join(repositoryRoot, "node_modules")], logPath);
  }
}

console.log(`Compiled ${registry.configurations.length * 2} configuration-specific circuit bundles.`);
