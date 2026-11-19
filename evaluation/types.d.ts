/**
 * Type declarations for modules without TypeScript definitions
 */

declare module 'snarkjs' {
    export const groth16: {
        fullProve: (input: any, wasmPath: string, zkeyPath: string) => Promise<{
            proof: {
                pi_a: string[];
                pi_b: string[][];
                pi_c: string[];
            };
            publicSignals: string[];
        }>;
        verify: (vk: any, publicSignals: string[], proof: any) => Promise<boolean>;
    };
}

declare module 'circomlibjs' {
    export function buildPoseidon(): Promise<{
        (inputs: bigint[]): Uint8Array;
        F: {
            toObject: (hash: Uint8Array) => bigint;
        };
    }>;
    export const poseidonContract: {
        createCode(nInputs: number): string;
        generateABI(nInputs: number): any[];
    };
}
