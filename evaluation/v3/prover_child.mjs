/**
 * Isolated prover process for peak-memory measurement; the parent runs it under
 * /usr/bin/time so the reading covers only this process.
 * Usage: node prover_child.mjs <baseline|prove> <wasm> <zkey> <input.json>
 *   baseline: Node runtime, snarkjs module and the artifact bytes, no proving
 *   prove:    the same plus witness generation and Groth16 proving
 */
import { readFileSync } from "node:fs";
import * as snarkjs from "snarkjs";

const [mode, wasm, zkey, inputPath] = process.argv.slice(2);
const input = JSON.parse(readFileSync(inputPath, "utf8"));

if (mode === "prove") {
    await snarkjs.groth16.fullProve(input, wasm, zkey);
} else if (mode === "baseline") {
    readFileSync(wasm);
    readFileSync(zkey);
} else {
    throw new Error("mode must be baseline or prove");
}
// snarkjs keeps its worker threads alive; exit explicitly.
process.exit(0);
