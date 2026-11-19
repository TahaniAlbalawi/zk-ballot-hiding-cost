/**
 * Measurement primitives for the v0.3 experiment.
 *
 * Timing and memory are measured separately (RC.26 measured both at once: its
 * memory sampler spawned `ps` inside the timed window, and its "peak" included
 * a 5-second pre-proof baseline).  Here:
 *   - timing splits witness generation from Groth16 proving, with nothing else
 *     running in the process;
 *   - peak memory comes from isolated child processes under /usr/bin/time, as
 *     the difference between a proving run and a load-only baseline run.
 */
import * as snarkjs from "snarkjs";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The bundled declarations cover only fullProve/verify.
const sj: any = snarkjs;
const CHILD = path.join(path.dirname(fileURLToPath(import.meta.url)), "prover_child.mjs");

export interface ProofTiming {
    witnessMs: number;
    proveMs: number;
    proof: any;
    publicSignals: string[];
}

export async function timeProof(input: Record<string, unknown>, wasm: string, zkey: string): Promise<ProofTiming> {
    const witness = { type: "mem" };
    const started = process.hrtime.bigint();
    await sj.wtns.calculate(input, wasm, witness);
    const witnessDone = process.hrtime.bigint();
    const { proof, publicSignals } = await sj.groth16.prove(zkey, witness);
    const proved = process.hrtime.bigint();
    return {
        witnessMs: Number(witnessDone - started) / 1e6,
        proveMs: Number(proved - witnessDone) / 1e6,
        proof,
        publicSignals,
    };
}

export async function timeVerify(verificationKey: unknown, publicSignals: string[], proof: unknown): Promise<{ valid: boolean; verifyMs: number }> {
    const started = process.hrtime.bigint();
    const valid = Boolean(await sj.groth16.verify(verificationKey, publicSignals, proof));
    return { valid, verifyMs: Number(process.hrtime.bigint() - started) / 1e6 };
}

export interface ProverMemory {
    proveBytes: number;
    baselineBytes: number;
    deltaBytes: number;
}

function maxResidentBytes(stderr: string): number {
    const macos = stderr.match(/(\d+)\s+maximum resident set size/);
    if (macos) return Number(macos[1]);
    const linux = stderr.match(/Maximum resident set size \(kbytes\):\s*(\d+)/);
    if (linux) return Number(linux[1]) * 1024;
    throw new Error("could not read maximum resident set size from /usr/bin/time");
}

export function measureProverMemory(input: Record<string, unknown>, wasm: string, zkey: string): ProverMemory {
    const directory = mkdtempSync(path.join(os.tmpdir(), "zkv-mem-"));
    const inputPath = path.join(directory, "input.json");
    writeFileSync(inputPath, JSON.stringify(input, (_key, value) => typeof value === "bigint" ? value.toString() : value));
    const timeFlag = process.platform === "darwin" ? "-l" : "-v";
    const run = (mode: "baseline" | "prove"): number => {
        const result = spawnSync("/usr/bin/time", [timeFlag, process.execPath, CHILD, mode, wasm, zkey, inputPath], { encoding: "utf8" });
        if (result.status !== 0) {
            throw new Error(`isolated ${mode} run failed: ${result.stderr.slice(-400)}`);
        }
        return maxResidentBytes(result.stderr);
    };
    try {
        const baselineBytes = run("baseline");
        const proveBytes = run("prove");
        return { proveBytes, baselineBytes, deltaBytes: proveBytes - baselineBytes };
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
}

/** EIP-2028 calldata pricing: 4 gas per zero byte, 16 per non-zero byte. */
export function calldataGas(data: string): number {
    const hex = data.startsWith("0x") ? data.slice(2) : data;
    let gas = 0;
    for (let i = 0; i < hex.length; i += 2) {
        gas += hex.slice(i, i + 2) === "00" ? 4 : 16;
    }
    return gas;
}

/** Solidity calldata layout of a snarkjs Groth16 proof (pi_b coordinates swapped). */
export function solidityProof(proof: any): { a: [string, string]; b: [[string, string], [string, string]]; c: [string, string] } {
    return {
        a: [proof.pi_a[0], proof.pi_a[1]],
        b: [[proof.pi_b[0][1], proof.pi_b[0][0]], [proof.pi_b[1][1], proof.pi_b[1][0]]],
        c: [proof.pi_c[0], proof.pi_c[1]],
    };
}
