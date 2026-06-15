const fs = require("fs");
const path = require("path");
const solc = require("solc");

const root = process.cwd();
const contractPath = path.join(root, "contracts", "Branium.sol");
const source = fs.readFileSync(contractPath, "utf8");

const input = {
  language: "Solidity",
  sources: {
    "contracts/Branium.sol": {
      content: source,
    },
  },
  settings: {
    optimizer: {
      enabled: true,
      runs: 200,
    },
    viaIR: true,
    outputSelection: {
      "*": {
        "*": ["abi", "evm.bytecode.object"],
      },
    },
  },
};

const output = JSON.parse(solc.compile(JSON.stringify(input)));
const errors = output.errors || [];
for (const entry of errors) {
  const prefix = entry.severity === "error" ? "error" : "warning";
  console.error(`${prefix}: ${entry.formattedMessage || entry.message}`);
}

if (errors.some((entry) => entry.severity === "error")) {
  process.exit(1);
}

const contract = output.contracts?.["contracts/Branium.sol"]?.Branium;
if (!contract?.evm?.bytecode?.object) {
  console.error("error: Branium bytecode was not emitted.");
  process.exit(1);
}

const artifactsDir = path.join(root, "artifacts");
fs.mkdirSync(artifactsDir, { recursive: true });

const bytecode = contract.evm.bytecode.object;
fs.writeFileSync(path.join(artifactsDir, "Branium.bin"), bytecode);
fs.writeFileSync(path.join(artifactsDir, "Branium.abi"), JSON.stringify(contract.abi, null, 2));
fs.writeFileSync(
  path.join(artifactsDir, "Branium.json"),
  JSON.stringify({ abi: contract.abi, bytecode: `0x${bytecode}` }, null, 2),
);

console.log(`Compiled Branium.sol -> artifacts/Branium.bin (${bytecode.length / 2} bytes)`);
