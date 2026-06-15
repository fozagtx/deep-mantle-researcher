/**
 * Quick read of Branium agent signer balances on Mantle Sepolia.
 * Run: npx tsx scripts/check-agent-balances.ts
 */
import { createMantlePublicClient, microToNative, getExplorerAddressUrl } from "../lib/mantle";
import { getAddressFromPrivateKey } from "../lib/mantle-agent";

async function main(): Promise<void> {
  const oracleKey  = process.env.ORACLE_PRIVATE_KEY;
  const creatorKey = process.env.MARKET_CREATOR_PRIVATE_KEY;
  if (!oracleKey || !creatorKey) {
    console.error("Missing ORACLE_PRIVATE_KEY or MARKET_CREATOR_PRIVATE_KEY");
    process.exit(1);
  }
  const oracle  = getAddressFromPrivateKey(oracleKey);
  const creator = getAddressFromPrivateKey(creatorKey);

  const client = createMantlePublicClient();
  const [ob, cb] = await Promise.all([
    client.getBalance({ address: oracle  as `0x${string}` }),
    client.getBalance({ address: creator as `0x${string}` }),
  ]);

  console.log("Mantle Sepolia balances:\n");
  console.log(`  oracle          ${oracle}`);
  console.log(`                  ${microToNative(ob).toFixed(4)} MNT`);
  console.log(`                  ${getExplorerAddressUrl(oracle)}\n`);
  console.log(`  market-creator  ${creator}`);
  console.log(`                  ${microToNative(cb).toFixed(4)} MNT`);
  console.log(`                  ${getExplorerAddressUrl(creator)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
