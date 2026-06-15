/**
 * Mantle Sepolia chain configuration.
 *
 * Chain ID: 5003 (0x138b)
 * Native currency: MNT (18 decimals) — used for gas and Branium stakes.
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  custom,
  type PublicClient,
  type WalletClient,
  type Chain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

// Pulled out so the rest of the file can read the URL without optional-chain noise.
export const NATIVE_TOKEN_SYMBOL = "MNT";
const MANTLE_EXPLORER_URL = "https://sepolia.mantlescan.xyz";

// ── Chain definition ──────────────────────────────────────────────────────────
export const mantleSepolia: Chain = {
  id: 5003,
  name: "Mantle Sepolia",
  nativeCurrency: {
    name: "Mantle",
    symbol: NATIVE_TOKEN_SYMBOL,
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ["https://rpc.sepolia.mantle.xyz"],
    },
  },
  blockExplorers: {
    default: {
      name: "Mantle Sepolia Explorer",
      url: MANTLE_EXPLORER_URL,
    },
  },
  testnet: true,
};

// ── RPC endpoint ──────────────────────────────────────────────────────────────
export function getMantleRpcUrl(): string {
  return (
    process.env.NEXT_PUBLIC_MANTLE_RPC ||
    (typeof window === "undefined" ? process.env.MANTLE_RPC : undefined) ||
    mantleSepolia.rpcUrls.default.http[0]
  );
}

export function getContractAddress(): `0x${string}` {
  const addr =
    process.env.NEXT_PUBLIC_CONTRACT_ADDRESS ||
    "0x0000000000000000000000000000000000000000";
  return addr as `0x${string}`;
}

export function isContractConfigured(address = getContractAddress()): boolean {
  return address !== "0x0000000000000000000000000000000000000000";
}

// Keep log scans bounded so public RPC providers don't reject wide queries.
export const MANTLE_LOG_CHUNK = 9_999n;

export function getDeployBlock(): bigint {
  const raw = process.env.NEXT_PUBLIC_DEPLOY_BLOCK;
  if (raw && raw.trim().length > 0) {
    try { return BigInt(raw); } catch { /* fall through */ }
  }
  return 0n;
}

export async function paginatedGetLogs(
  client: PublicClient,
  params: Omit<Parameters<PublicClient["getLogs"]>[0], "fromBlock" | "toBlock">,
  fromBlock: bigint,
  toBlock?: bigint,
): Promise<any[]> {
  const end = toBlock ?? (await client.getBlockNumber());
  const all: any[] = [];
  for (let start = fromBlock; start <= end; ) {
    const stop = start + MANTLE_LOG_CHUNK > end ? end : start + MANTLE_LOG_CHUNK;
    const logs = await client.getLogs({ ...(params as any), fromBlock: start, toBlock: stop });
    all.push(...logs);
    start = stop + 1n;
  }
  return all;
}

export function getExplorerTxUrl(txHash: string): string {
  return `${MANTLE_EXPLORER_URL}/tx/${txHash}`;
}

export function getExplorerAddressUrl(address: string): string {
  return `${MANTLE_EXPLORER_URL}/address/${address}`;
}

// ── viem clients ──────────────────────────────────────────────────────────────
// Batch feed reads to keep public RPC request volume predictable.
const MANTLE_HTTP_OPTS = {
  batch: { batchSize: 200, wait: 16 } as const,
  retryCount: 3,
  retryDelay: 300,
  timeout: 20_000,
};

export function createMantlePublicClient(): PublicClient {
  return createPublicClient({
    chain: mantleSepolia,
    transport: http(getMantleRpcUrl(), MANTLE_HTTP_OPTS),
  }) as PublicClient;
}

export function createMantleHttpTransport() {
  return http(getMantleRpcUrl(), MANTLE_HTTP_OPTS);
}

export function createMantleWalletClient(provider: unknown): WalletClient {
  return createWalletClient({
    chain: mantleSepolia,
    transport: custom(provider as any),
  });
}

export function createMantleWalletClientWithKey(privateKey: string): WalletClient {
  const account = privateKeyToAccount(privateKey as `0x${string}`);
  return createWalletClient({
    chain: mantleSepolia,
    account,
    transport: http(getMantleRpcUrl(), MANTLE_HTTP_OPTS),
  });
}

// ── MetaMask chain-switch helper ──────────────────────────────────────────────
export async function ensureMantleChain(ethereum: {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
}): Promise<void> {
  const chainIdHex = `0x${mantleSepolia.id.toString(16)}`;
  const currentChainId = (await ethereum.request({ method: "eth_chainId" })) as string;

  if (currentChainId === chainIdHex) return;

  try {
    await ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chainIdHex }],
    });
  } catch (err: any) {
    if (err?.code !== 4902) throw err;
    await ethereum.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: chainIdHex,
          chainName: mantleSepolia.name,
          rpcUrls: mantleSepolia.rpcUrls.default.http,
          nativeCurrency: mantleSepolia.nativeCurrency,
          blockExplorerUrls: [MANTLE_EXPLORER_URL],
        },
      ],
    });
  }
}

// ── Unit helpers ──────────────────────────────────────────────────────────────
// Mantle native MNT uses 18 decimals. Branium accepts up to 6 displayed
// decimal places in the UI and scales them to wei for payable calls.
export const NATIVE_TOKEN_DECIMALS = 18;
export const NATIVE_TOKEN_UNIT = BigInt(10 ** NATIVE_TOKEN_DECIMALS); // 1_000_000_000_000_000_000n

export function nativeToMicro(amount: number): bigint {
  if (!Number.isFinite(amount) || amount < 0) throw new Error(`Invalid ${NATIVE_TOKEN_SYMBOL} amount`);
  return BigInt(Math.round(amount * 1_000_000)) * BigInt(10 ** 12);
}

export function microToNative(micro: bigint | number): number {
  return Number(BigInt(micro) / BigInt(10 ** 12)) / 1_000_000;
}

export function formatNative(micro: bigint | number, decimals = 2): string {
  return `${microToNative(micro).toFixed(decimals)} ${NATIVE_TOKEN_SYMBOL}`;
}
