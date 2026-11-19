import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

export type WorkflowMode = "PUBLIC_DISCLOSURE" | "COMMITMENT_BALLOT_HIDING";
export type ArtifactFile = { relative_path: string; sha256: string; byte_size: number };
export type Bundle = {
    manifest_locator: string;
    artifact_bundle_version: string;
    configuration_registry_version: string;
    configuration_id: string;
    workflow_mode: WorkflowMode;
    artifact_family_id: string;
    merkle_depth_d: number;
    candidate_count_c: number;
    contract_name: string;
    files: Record<"r1cs" | "wasm" | "zkey" | "verification_key" | "solidity_verifier" | "build_log", ArtifactFile & { locator: string }>;
};

export type ProvisionedVerifier = {
    configuration_id: string;
    workflow_mode: WorkflowMode;
    contract_name: string;
    manifest_locator: string;
    source_locator: string;
    source_sha256: string;
    source_byte_size: number;
    staged_locator: string;
    staged_sha256: string;
    staged_byte_size: number;
    compiled_artifact_locator: string;
    compiled_artifact_sha256: string;
    compiled_artifact_byte_size: number;
    bytecode_sha256: string;
    bytecode_byte_size: number;
};

const SHA256 = /^[0-9a-f]{64}$/;
const fileKeys = ["r1cs", "wasm", "zkey", "verification_key", "solidity_verifier", "build_log"] as const;

export function configurationId(depth: number, candidates: number): string {
    if (!Number.isSafeInteger(depth) || !Number.isSafeInteger(candidates) || depth < 1 || candidates < 1) throw new Error("configuration depth and candidate count must be positive integers");
    return `D${String(depth).padStart(2, "0")}-C${String(candidates).padStart(2, "0")}`;
}

function digest(value: Buffer): string { return crypto.createHash("sha256").update(value).digest("hex"); }

function verifyFile(bundleDir: string, descriptor: ArtifactFile, name: string): ArtifactFile & { locator: string } {
    if (!descriptor || typeof descriptor.relative_path !== "string" || !descriptor.relative_path || path.isAbsolute(descriptor.relative_path) || descriptor.relative_path.split(path.sep).includes("..")) throw new Error(`${name} path is invalid`);
    if (!SHA256.test(descriptor.sha256) || !Number.isSafeInteger(descriptor.byte_size) || descriptor.byte_size < 1) throw new Error(`${name} metadata is invalid`);
    const locator = path.resolve(bundleDir, descriptor.relative_path);
    if (!locator.startsWith(`${bundleDir}${path.sep}`) || !fs.existsSync(locator)) throw new Error(`${name} is unavailable`);
    const payload = fs.readFileSync(locator);
    if (payload.byteLength !== descriptor.byte_size || digest(payload) !== descriptor.sha256) throw new Error(`${name} hash or byte size differs from manifest`);
    return { ...descriptor, locator };
}

export function loadConfigurationArtifactBundleForConfiguration(manifestLocator: string, workflowMode: WorkflowMode, depth: number, candidates: number): Bundle {
    if (!path.isAbsolute(manifestLocator) || !fs.existsSync(manifestLocator)) throw new Error("configuration-artifact manifest is unavailable");
    let bundle: Bundle;
    try { bundle = JSON.parse(fs.readFileSync(manifestLocator, "utf8")) as Bundle; } catch { throw new Error("configuration-artifact manifest must be valid JSON"); }
    if (bundle.artifact_bundle_version !== "CMC-CONFIG-ARTIFACT-v1" || bundle.configuration_registry_version !== "CMC-CONFIG-ARTIFACTS-v1") throw new Error("configuration-artifact manifest version is invalid");
    if (bundle.workflow_mode !== workflowMode || bundle.artifact_family_id !== "AF-ZKCORE-v1" || bundle.configuration_id !== configurationId(depth, candidates) || bundle.merkle_depth_d !== depth || bundle.candidate_count_c !== candidates) throw new Error("configuration-artifact manifest does not match the requested D/C/mode");
    if (!bundle.contract_name || typeof bundle.contract_name !== "string") throw new Error("configuration-artifact manifest lacks contract identity");
    const bundleDir = path.dirname(manifestLocator);
    for (const key of fileKeys) bundle.files[key] = verifyFile(bundleDir, bundle.files?.[key], key);
    bundle.manifest_locator = path.resolve(manifestLocator);
    return bundle;
}

export function expectedConfigurationArtifactManifest(root: string, workflowMode: WorkflowMode, depth: number, candidates: number): string {
    return path.join(root, "circuits", "build", "configurations", configurationId(depth, candidates), workflowMode === "PUBLIC_DISCLOSURE" ? "public" : "commitment", "configuration-artifact-manifest.json");
}

export function hardhatVerifierArtifact(root: string, bundle: Bundle): string {
    return path.join(root, "contracts", "artifacts", "contracts", "cmc_verifiers", path.basename(bundle.files.solidity_verifier.relative_path), `${bundle.contract_name}.json`);
}

function verifierSourceName(bundle: Bundle): string {
    const relative = bundle.files.solidity_verifier.relative_path;
    const basename = path.basename(relative);
    if (relative !== basename || !/^[A-Za-z][A-Za-z0-9_]*\.sol$/.test(basename)) {
        throw new Error("selected verifier source path must be one generated Solidity filename");
    }
    return basename;
}

function verifyPayload(locator: string, expectedSha256: string, expectedBytes: number, label: string): Buffer {
    if (!path.isAbsolute(locator) || !fs.existsSync(locator) || !fs.statSync(locator).isFile()) {
        throw new Error(`${label} is unavailable`);
    }
    const payload = fs.readFileSync(locator);
    if (payload.byteLength !== expectedBytes || digest(payload) !== expectedSha256) {
        throw new Error(`${label} hash or byte size differs from its selected manifest`);
    }
    return payload;
}

/**
 * Materialize the exact generated verifier named by a selected immutable
 * configuration bundle.  The destination is ignored runtime material, not a
 * tracked source input; an existing different file is rejected rather than
 * silently replacing a stale or wrong-configuration verifier.
 */
export function provisionConfiguredVerifierSource(root: string, bundle: Bundle): Omit<ProvisionedVerifier, "compiled_artifact_locator" | "compiled_artifact_sha256" | "compiled_artifact_byte_size" | "bytecode_sha256" | "bytecode_byte_size"> {
    if (!path.isAbsolute(root) || !fs.existsSync(root)) throw new Error("repository root is unavailable for verifier provisioning");
    const sourceName = verifierSourceName(bundle);
    const source = bundle.files.solidity_verifier;
    const sourcePayload = verifyPayload(source.locator, source.sha256, source.byte_size, "selected generated verifier source");
    const stageDirectory = path.join(root, "contracts", "contracts", "cmc_verifiers");
    const staged = path.join(stageDirectory, sourceName);
    fs.mkdirSync(stageDirectory, { recursive: true });
    if (fs.existsSync(staged)) {
        verifyPayload(staged, source.sha256, source.byte_size, "staged generated verifier source");
    } else {
        fs.copyFileSync(source.locator, staged, fs.constants.COPYFILE_EXCL);
        verifyPayload(staged, source.sha256, source.byte_size, "newly staged generated verifier source");
    }
    return {
        configuration_id: bundle.configuration_id,
        workflow_mode: bundle.workflow_mode,
        contract_name: bundle.contract_name,
        manifest_locator: bundle.manifest_locator,
        source_locator: source.locator,
        source_sha256: source.sha256,
        source_byte_size: source.byte_size,
        staged_locator: staged,
        staged_sha256: digest(fs.readFileSync(staged)),
        staged_byte_size: fs.statSync(staged).size,
    };
}

/**
 * Compile exact provisioned verifier sources.  Hardhat is forced to compile
 * so a cached artifact cannot stand in for the selected configuration source.
 */
export function provisionAndCompileConfiguredVerifiers(root: string, bundles: readonly Bundle[]): ProvisionedVerifier[] {
    if (bundles.length === 0) throw new Error("at least one selected verifier bundle is required");
    const seen = new Map<string, string>();
    const staged = bundles.map((bundle) => {
        const sourceName = verifierSourceName(bundle);
        const prior = seen.get(sourceName);
        if (prior && prior !== bundle.files.solidity_verifier.sha256) {
            throw new Error("different selected bundles resolve to the same verifier filename");
        }
        seen.set(sourceName, bundle.files.solidity_verifier.sha256);
        return provisionConfiguredVerifierSource(root, bundle);
    });
    try {
        execFileSync("npm", ["run", "compile", "--workspace=contracts", "--", "--force"], {
            cwd: root,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
        });
    } catch (error: unknown) {
        const detail = error as { stdout?: string; stderr?: string; message?: string };
        throw new Error(`selected verifier compilation failed: ${detail.stderr || detail.stdout || detail.message || String(error)}`);
    }
    return staged.map((entry, index) => {
        const bundle = bundles[index];
        const artifactLocator = hardhatVerifierArtifact(root, bundle);
        if (!fs.existsSync(artifactLocator) || !fs.statSync(artifactLocator).isFile()) {
            throw new Error("compiled selected verifier artifact is unavailable");
        }
        const artifactPayload = fs.readFileSync(artifactLocator);
        let artifact: { contractName?: unknown; sourceName?: unknown; bytecode?: unknown };
        try { artifact = JSON.parse(artifactPayload.toString("utf8")) as { contractName?: unknown; sourceName?: unknown; bytecode?: unknown }; }
        catch { throw new Error("compiled selected verifier artifact must be valid JSON"); }
        const expectedSource = `contracts/cmc_verifiers/${path.basename(bundle.files.solidity_verifier.relative_path)}`;
        if (artifact.contractName !== bundle.contract_name || artifact.sourceName !== expectedSource || typeof artifact.bytecode !== "string" || !/^0x[0-9a-fA-F]+$/.test(artifact.bytecode)) {
            throw new Error("compiled selected verifier artifact does not bind the selected source and contract identity");
        }
        const bytecode = Buffer.from(artifact.bytecode.slice(2), "hex");
        if (bytecode.byteLength === 0) throw new Error("compiled selected verifier bytecode is empty");
        return {
            ...entry,
            compiled_artifact_locator: artifactLocator,
            compiled_artifact_sha256: digest(artifactPayload),
            compiled_artifact_byte_size: artifactPayload.byteLength,
            bytecode_sha256: digest(bytecode),
            bytecode_byte_size: bytecode.byteLength,
        };
    });
}
