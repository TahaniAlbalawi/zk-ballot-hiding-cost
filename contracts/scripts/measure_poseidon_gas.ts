/**
 * Measures the gas cost of on-chain Poseidon hashing with the circomlibjs-generated
 * contracts (the hash the commitment circuit uses), for the on-chain reveal design.
 * Run: npx hardhat --config contracts/hardhat.config.ts run contracts/scripts/measure_poseidon_gas.ts
 */
import { ethers } from "hardhat";
// circomlibjs ships CommonJS and ESM builds without type declarations.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const circomlibjs = require("circomlibjs");

function calldataGas(data: string): number {
    const bytes = ethers.getBytes(data);
    return bytes.reduce((sum, b) => sum + (b === 0 ? 4 : 16), 0);
}

async function main(): Promise<void> {
    const [signer] = await ethers.getSigners();
    const poseidon = await circomlibjs.buildPoseidon();

    for (const n of [2, 3]) {
        const factory = new ethers.ContractFactory(
            circomlibjs.poseidonContract.generateABI(n),
            circomlibjs.poseidonContract.createCode(n),
            signer,
        );
        const contract = await factory.deploy();
        await contract.waitForDeployment();

        const inputs = Array.from({ length: n }, (_, i) => BigInt(i + 1) * 1234567891011121314n);
        const fn = contract.getFunction(`poseidon(uint256[${n}])`);
        const onchain: bigint = await fn.staticCall(inputs);
        const offchain: bigint = poseidon.F.toObject(poseidon(inputs));
        const estimate = Number(await fn.estimateGas(inputs));
        const calldata = calldataGas(contract.interface.encodeFunctionData(`poseidon(uint256[${n}])`, [inputs]));

        console.log(JSON.stringify({
            inputs: n,
            matchesCircomlibjs: onchain === offchain,
            txEstimate: estimate,
            calldataGas: calldata,
            executionGas: estimate - 21000 - calldata,
        }));
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
