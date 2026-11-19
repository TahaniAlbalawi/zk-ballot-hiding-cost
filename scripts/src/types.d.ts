// Type declarations for modules without TypeScript definitions

declare module 'circomlibjs' {
    export function buildPoseidon(): Promise<any>;
    export const poseidonContract: {
        createCode(nInputs: number): string;
        generateABI(nInputs: number): any[];
    };
}

declare module 'snarkjs' {
    export namespace groth16 {
        function fullProve(
            input: any,
            wasmPath: string,
            zkeyPath: string
        ): Promise<{ proof: any; publicSignals: string[] }>;

        function verify(
            vkey: any,
            publicSignals: string[],
            proof: any
        ): Promise<boolean>;

        function exportSolidityCallData(
            proof: any,
            publicSignals: string[]
        ): Promise<string>;
    }
}
