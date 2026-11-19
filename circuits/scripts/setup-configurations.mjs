import { createHash, randomBytes } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const circuitsRoot = path.resolve(scriptDir, "..");
const repositoryRoot = path.resolve(circuitsRoot, "..");
const buildRoot = path.join(circuitsRoot, "build");
const outputRoot = path.join(buildRoot, "configurations");
const verifierRoot = path.join(repositoryRoot, "contracts", "contracts", "cmc_verifiers");
const registry = JSON.parse(readFileSync(path.join(circuitsRoot, "configurations.json"), "utf8"));
const snarkjs = path.join(repositoryRoot, "node_modules", ".bin", "snarkjs");
// Phase-1 parameters from the PSE Perpetual Powers of Tau ceremony, prepared for
// up to 2^14 constraints (depth-20 circuits fit).
const ptau = path.join(buildRoot, "ppot_0080_14.ptau");
const PTAU_URL = "https://pse-trusted-setup-ppot.s3.eu-central-1.amazonaws.com/pot28_0080/ppot_0080_14.ptau";
const PTAU_SHA256 = "3ca1149e9349b22b0ee0649399cfb787677129b7b1189d1899fc0d615d9583db";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function metadata(file, base) {
  const payload = readFileSync(file);
  return { relative_path: path.relative(base, file), sha256: sha256(payload), byte_size: payload.byteLength };
}

function run(command, args, logPath) {
  writeFileSync(logPath, `$ ${[command, ...args].join(" ")}\n`, { flag: "a" });
  const result = spawnSync(command, args, { cwd: repositoryRoot, encoding: "utf8" });
  writeFileSync(logPath, `${result.stdout ?? ""}${result.stderr ?? ""}`, { flag: "a" });
  if (result.status !== 0) throw new Error(`${command} failed for ${logPath}`);
}

function ensurePtau() {
  if (!existsSync(ptau)) {
    mkdirSync(buildRoot, { recursive: true });
    const download = spawnSync("curl", ["-L", "--fail", "-o", ptau, PTAU_URL], { encoding: "utf8" });
    if (download.status !== 0) throw new Error("unable to obtain the required ppot_0080_14 proving parameter file");
  }
  if (sha256(readFileSync(ptau)) !== PTAU_SHA256) {
    throw new Error("ppot_0080_14.ptau does not match its recorded SHA-256");
  }
}

if (!existsSync(snarkjs)) throw new Error("release-local snarkjs executable is required; run npm ci first");
ensurePtau();
mkdirSync(verifierRoot, { recursive: true });

for (const configuration of registry.configurations) {
  for (const mode of ["public", "commitment"]) {
    const workflowMode = mode === "public" ? "PUBLIC_DISCLOSURE" : "COMMITMENT_BALLOT_HIDING";
    const template = mode === "public" ? "VoteProof" : "VoteProofPrivate";
    const circuitName = `${template}_${configuration.configuration_id.replace("-", "_")}`;
    const bundleDir = path.join(outputRoot, configuration.configuration_id, mode);
    const logPath = path.join(bundleDir, "build.log");
    const r1cs = path.join(bundleDir, `${circuitName}.r1cs`);
    const wasm = path.join(bundleDir, `${circuitName}_js`, `${circuitName}.wasm`);
    const intermediate = path.join(bundleDir, `${circuitName}_0000.zkey`);
    const zkey = path.join(bundleDir, `${circuitName}_final.zkey`);
    const verificationKey = path.join(bundleDir, `${circuitName}_verification_key.json`);
    const verifier = path.join(bundleDir, `${mode === "public" ? "VerifierPublic" : "VerifierCommitment"}_${configuration.configuration_id.replace("-", "")}.sol`);
    const contractName = `Groth16Verifier${mode === "public" ? "Public" : "Commitment"}${configuration.configuration_id.replace("-", "")}`;
    if (!existsSync(r1cs) || !existsSync(wasm)) throw new Error(`missing compiled artifacts for ${configuration.configuration_id}/${mode}`);
    run(snarkjs, ["groth16", "setup", r1cs, ptau, intermediate], logPath);
    run(snarkjs, ["zkey", "beacon", intermediate, zkey, randomBytes(32).toString("hex"), "10"], logPath);
    run(snarkjs, ["zkey", "export", "verificationkey", zkey, verificationKey], logPath);
    run(snarkjs, ["zkey", "export", "solidityverifier", zkey, verifier], logPath);
    const source = readFileSync(verifier, "utf8");
    const renamed = source.replace(/contract Groth16Verifier\b/, `contract ${contractName}`).replace(/[ \t]+$/gm, "");
    if (renamed === source) throw new Error(`could not uniquely rename generated verifier for ${configuration.configuration_id}/${mode}`);
    writeFileSync(verifier, renamed, "utf8");
    copyFileSync(verifier, path.join(verifierRoot, path.basename(verifier)));
    rmSync(intermediate, { force: true });
    const manifest = {
      artifact_bundle_version: "CMC-CONFIG-ARTIFACT-v1",
      configuration_registry_version: registry.configuration_registry_version,
      configuration_id: configuration.configuration_id,
      workflow_mode: workflowMode,
      artifact_family_id: "AF-ZKCORE-v1",
      merkle_depth_d: configuration.merkle_depth_d,
      candidate_count_c: configuration.candidate_count_c,
      circuit_name: circuitName,
      contract_name: contractName,
      public_signal_order: mode === "public"
        ? ["root", "nullifier", "electionId", "vote", "candidateCount", "voter"]
        : ["root", "nullifier", "electionId", "candidateCount", "commitment", "voter"],
      proving_parameter: { relative_path: path.relative(bundleDir, ptau), sha256: sha256(readFileSync(ptau)), byte_size: statSync(ptau).size },
      files: {
        r1cs: metadata(r1cs, bundleDir),
        wasm: metadata(wasm, bundleDir),
        zkey: metadata(zkey, bundleDir),
        verification_key: metadata(verificationKey, bundleDir),
        solidity_verifier: metadata(verifier, bundleDir),
        build_log: metadata(logPath, bundleDir)
      }
    };
    writeFileSync(path.join(bundleDir, "configuration-artifact-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  }
}

console.log(`Prepared ${registry.configurations.length * 2} configuration-specific proving/verifier bundles.`);
