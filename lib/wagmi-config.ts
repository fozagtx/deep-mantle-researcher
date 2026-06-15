/**
 * wagmi config for Branium on Mantle Sepolia.
 *
 * Supports: MetaMask, Coinbase Wallet, Rainbow, Phantom, Trust, Brave,
 * any EIP-6963 injected wallet, and WalletConnect QR (380+ mobile wallets).
 * The connect modal is rendered by ConnectKit (lib/wagmi-providers.tsx).
 *
 * Primary chain: Mantle Sepolia (5003), native MNT (18 decimals).
 */
import { createConfig, http } from "wagmi";
import { coinbaseWallet, injected, walletConnect } from "wagmi/connectors";
import { mantleSepolia, getMantleRpcUrl } from "./mantle";

// WalletConnect Cloud project id — get one free at https://cloud.walletconnect.com.
// When the var is missing we skip the walletconnect connector so local dev still
// works; the connect modal just won't show the QR option until it's set.
const WC_PROJECT_ID = process.env.NEXT_PUBLIC_WC_PROJECT_ID?.trim();

const APP_METADATA = {
  name:        "Branium",
  description: "AI-settled MNT claim markets on Mantle",
  url:         "https://branium.app",
  icons:       ["https://branium.app/icons/branium-logo.svg"],
};

export const wagmiConfig = createConfig({
  chains: [mantleSepolia],
  connectors: [
    injected({ target: "metaMask", shimDisconnect: true }),
    coinbaseWallet({
      appName:    APP_METADATA.name,
      appLogoUrl: APP_METADATA.icons[0],
    }),
    // EIP-6963 discovery picks up Phantom, Rainbow, Trust, Brave, OKX, etc.
    // automatically — no per-wallet config needed.
    injected({ shimDisconnect: true }),
    ...(WC_PROJECT_ID
      ? [walletConnect({
          projectId:    WC_PROJECT_ID,
          metadata:     APP_METADATA,
          showQrModal:  false, // ConnectKit renders the QR itself
        })]
      : []),
  ],
  // JSON-RPC batching + retry keeps feed reads from overwhelming public RPCs.
  transports: {
    [mantleSepolia.id]: http(getMantleRpcUrl(), {
      batch: { batchSize: 200, wait: 16 },
      retryCount: 3,
      retryDelay: 300,
      timeout: 20_000,
    }),
  },
  ssr: true,
});
