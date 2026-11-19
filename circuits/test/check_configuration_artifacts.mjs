import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildPoseidon } from "circomlibjs";
import * as snarkjs from "snarkjs";

// Any account can stand in for the voter signal the contracts bind to msg.sender.
const VOTER = BigInt("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const circuitsRoot = path.join(root, "circuits");
const buildRoot = path.join(circuitsRoot, "build", "configurations");
const registry = JSON.parse(fs.readFileSync(path.join(circuitsRoot, "configurations.json"), "utf8"));
const expectedIds = ["D03-C04", "D05-C04", "D07-C04", "D08-C04", "D09-C04", "D10-C02", "D10-C04", "D10-C08",
  "D12-C04", "D13-C04", "D16-C04", "D20-C04"];
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

assert.equal(registry.configuration_registry_version, "CMC-CONFIG-ARTIFACTS-v1");
assert.deepEqual(registry.configurations.map((item) => item.configuration_id), expectedIds);

function validateFile(bundleDir, descriptor, label) {
  assert.equal(typeof descriptor.relative_path, "string", `${label} requires a relative path`);
  const file = path.resolve(bundleDir, descriptor.relative_path);
  assert.ok(file.startsWith(`${bundleDir}${path.sep}`) || file === bundleDir, `${label} must remain within its bundle`);
  const payload = fs.readFileSync(file);
  assert.equal(payload.byteLength, descriptor.byte_size, `${label} byte size`);
  assert.equal(sha256(payload), descriptor.sha256, `${label} SHA-256`);
  return file;
}

const poseidon = await buildPoseidon();
const poseidonHash = (inputs) => BigInt(poseidon.F.toObject(poseidon(inputs)).toString());
const r1csHashes = new Map();
const results = [];

for (const configuration of registry.configurations) {
  const id = configuration.configuration_id;
  for (const mode of ["public", "commitment"]) {
    const workflowMode = mode === "public" ? "PUBLIC_DISCLOSURE" : "COMMITMENT_BALLOT_HIDING";
    const bundleDir = path.join(buildRoot, id, mode);
    const manifestPath = path.join(bundleDir, "configuration-artifact-manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    assert.equal(manifest.artifact_bundle_version, "CMC-CONFIG-ARTIFACT-v1");
    assert.equal(manifest.configuration_registry_version, "CMC-CONFIG-ARTIFACTS-v1");
    assert.equal(manifest.configuration_id, id);
    assert.equal(manifest.workflow_mode, workflowMode);
    assert.equal(manifest.merkle_depth_d, configuration.merkle_depth_d);
    assert.equal(manifest.candidate_count_c, configuration.candidate_count_c);
    assert.equal(manifest.artifact_family_id, "AF-ZKCORE-v1");
    assert.deepEqual(manifest.public_signal_order, mode === "public"
      ? ["root", "nullifier", "electionId", "vote", "candidateCount", "voter"]
      : ["root", "nullifier", "electionId", "candidateCount", "commitment", "voter"]);
    const files = Object.fromEntries(Object.entries(manifest.files).map(([key, descriptor]) => [key, validateFile(bundleDir, descriptor, `${id}/${mode}/${key}`)]));
    const provingParameterPath = path.resolve(bundleDir, manifest.proving_parameter.relative_path);
    const provingParameterPayload = fs.readFileSync(provingParameterPath);
    assert.equal(provingParameterPayload.byteLength, manifest.proving_parameter.byte_size, `${id}/${mode}/proving_parameter byte size`);
    assert.equal(sha256(provingParameterPayload), manifest.proving_parameter.sha256, `${id}/${mode}/proving_parameter SHA-256`);
    const sourceCopy = path.join(root, "contracts", "contracts", "cmc_verifiers", path.basename(manifest.files.solidity_verifier.relative_path));
    assert.equal(sha256(fs.readFileSync(sourceCopy)), manifest.files.solidity_verifier.sha256, `${id}/${mode} copied Solidity verifier`);
    const hardhatArtifact = path.join(root, "contracts", "artifacts", "contracts", "cmc_verifiers", path.basename(manifest.files.solidity_verifier.relative_path), `${manifest.contract_name}.json`);
    const compiledVerifier = JSON.parse(fs.readFileSync(hardhatArtifact, "utf8"));
    assert.equal(compiledVerifier.contractName, manifest.contract_name, `${id}/${mode} compiled verifier identity`);
    assert.match(compiledVerifier.bytecode, /^0x[0-9a-f]+$/i, `${id}/${mode} compiled verifier bytecode`);
    const r1csHash = manifest.files.r1cs.sha256;
    const r1csKey = `${workflowMode}|${r1csHash}`;
    assert.ok(!r1csHashes.has(r1csKey), `${id}/${mode} cannot reuse an R1CS from a different D/C configuration`);
    r1csHashes.set(r1csKey, id);
    assert.equal(await snarkjs.zKey.verifyFromR1cs(files.r1cs, provingParameterPath, files.zkey), true, `${id}/${mode} zkey/R1CS/proving-parameter compatibility`);
    if (id !== "D03-C04") {
      results.push({ configuration_id: id, workflow_mode: workflowMode, zkey_compatibility: "PASS", verifier_source_hash: "PASS" });
      continue;
    }

    const depth = configuration.merkle_depth_d;
    const capacity = 2 ** depth;
    const secrets = Array.from({ length: capacity }, (_, index) => BigInt(10_000 + index));
    const leaves = secrets.map((secret) => poseidonHash([secret]));
    const layers = [leaves];
    for (let level = 0; level < depth; level += 1) {
      const next = [];
      for (let index = 0; index < layers[level].length; index += 2) next.push(poseidonHash([layers[level][index], layers[level][index + 1]]));
      layers.push(next);
    }
    const selected = 1;
    const pathElements = [];
    const pathIndices = [];
    let cursor = selected;
    for (let level = 0; level < depth; level += 1) {
      pathElements.push(layers[level][cursor % 2 === 0 ? cursor + 1 : cursor - 1].toString());
      pathIndices.push(cursor % 2 === 0 ? 0 : 1);
      cursor = Math.floor(cursor / 2);
    }
    const secret = secrets[selected];
    const electionId = 7n;
    const vote = BigInt(configuration.candidate_count_c - 1);
    const candidateCount = BigInt(configuration.candidate_count_c);
    const nullifier = poseidonHash([secret, electionId]);
    const base = {
      root: layers[depth][0].toString(), nullifier: nullifier.toString(), electionId: electionId.toString(),
      candidateCount: candidateCount.toString(), voter: VOTER.toString(), secret: secret.toString(), pathElements, pathIndices,
    };
    const input = mode === "public" ? { ...base, vote: vote.toString() } : {
      ...base,
      commitment: poseidonHash([vote, 987654321n]).toString(),
      vote: vote.toString(), randomness: "987654321",
    };
    const proofBundle = await snarkjs.groth16.fullProve(input, files.wasm, files.zkey);
    const vkey = JSON.parse(fs.readFileSync(files.verification_key, "utf8"));
    assert.equal(await snarkjs.groth16.verify(vkey, proofBundle.publicSignals, proofBundle.proof), true, `${id}/${mode} matching proof`);
    const expectedSignals = mode === "public"
      ? [base.root, base.nullifier, base.electionId, vote.toString(), base.candidateCount, base.voter]
      : [base.root, base.nullifier, base.electionId, base.candidateCount, input.commitment, base.voter];
    assert.deepEqual(proofBundle.publicSignals, expectedSignals, `${id}/${mode} public-signal order`);
    const altered = [...proofBundle.publicSignals];
    altered[0] = (BigInt(altered[0]) + 1n).toString();
    assert.equal(await snarkjs.groth16.verify(vkey, altered, proofBundle.proof), false, `${id}/${mode} altered signal rejection`);
    results.push({ configuration_id: id, workflow_mode: workflowMode, zkey_compatibility: "PASS", proof_and_vkey: "PASS", verifier_source_hash: "PASS" });
  }
}

assert.equal(results.length, 2 * expectedIds.length);
console.log(JSON.stringify({ test_only: true, bundle_count: results.length, results }, null, 2));
process.exit(0);
