import type { Address, Hash } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { BRANIUM_ABI } from "./branium-abi";
import {
  createMantlePublicClient,
  createMantleWalletClientWithKey,
  getContractAddress,
  mantleSepolia,
} from "./mantle";

export type BraniumWriteFunction =
  | "resolveClaim"
  | "challengeClaim"
  | "createClaim"
  | "cancelClaim";

export interface BraniumWriteRequest {
  privateKey: string;
  functionName: BraniumWriteFunction;
  args: readonly unknown[];
  value?: bigint;
  waitForReceipt?: boolean;
}

function normalizePrivateKey(privateKey: string): `0x${string}` {
  const trimmed = privateKey.trim();
  const withPrefix = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(withPrefix)) {
    throw new Error("Agent private key must be a 32-byte hex string");
  }
  return withPrefix as `0x${string}`;
}

export function getRequiredPrivateKey(envName: string): `0x${string}` {
  const value = process.env[envName]?.trim();
  if (!value) {
    throw new Error(`${envName} env var is required`);
  }
  return normalizePrivateKey(value);
}

export function getOraclePrivateKey(): `0x${string}` {
  return getRequiredPrivateKey("ORACLE_PRIVATE_KEY");
}

export function getMarketCreatorPrivateKey(): `0x${string}` {
  return getRequiredPrivateKey("MARKET_CREATOR_PRIVATE_KEY");
}

export function getAddressFromPrivateKey(privateKey: string): Address {
  return privateKeyToAccount(normalizePrivateKey(privateKey)).address;
}

export function getOracleAddress(): Address {
  return getAddressFromPrivateKey(getOraclePrivateKey());
}

export function getMarketCreatorAddress(): Address {
  return getAddressFromPrivateKey(getMarketCreatorPrivateKey());
}

export async function executeBraniumWrite({
  privateKey,
  functionName,
  args,
  value = 0n,
  waitForReceipt = true,
}: BraniumWriteRequest): Promise<Hash> {
  const walletClient = createMantleWalletClientWithKey(normalizePrivateKey(privateKey));
  const account = walletClient.account;
  if (!account) {
    throw new Error("Mantle wallet client has no account");
  }

  const hash = await walletClient.writeContract({
    address: getContractAddress(),
    abi: BRANIUM_ABI as any,
    functionName,
    args: args as any,
    value,
    account,
    chain: mantleSepolia,
  } as any);

  if (waitForReceipt) {
    const receipt = await createMantlePublicClient().waitForTransactionReceipt({ hash });
    if (receipt.status === "reverted") {
      throw new Error(`Mantle transaction reverted: ${hash}`);
    }
  }

  return hash;
}
