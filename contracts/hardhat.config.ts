import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR: true,  // Required for complex functions with many local variables
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
      hardfork: "cancun",
      blockGasLimit: 30_000_000,
      mining: { auto: true, interval: 0 },
    },
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337,
      hardfork: "cancun",
      blockGasLimit: 30_000_000,
    },
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS !== undefined,
    currency: "USD",
  },
};

export default config;
