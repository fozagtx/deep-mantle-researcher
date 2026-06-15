import { CONTRACT_ADDRESS } from "../lib/contract";
import { getVsFeedSnapshot, reconcileVsIndex } from "../lib/server/vs-index";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

async function main() {
  if (CONTRACT_ADDRESS === ZERO_ADDRESS) {
    throw new Error(
      "Set NEXT_PUBLIC_CONTRACT_ADDRESS before warming the VS index"
    );
  }

  const summary = await reconcileVsIndex();
  const snapshot = await getVsFeedSnapshot();

  console.log(
    `Warmed VS index for ${snapshot.items.length} items from ${CONTRACT_ADDRESS}`
  );
  console.log(
    `Synced ${summary.synced} claims (${summary.new} new, ${summary.stateChanges} state changes)`
  );
}

main().catch((error) => {
  console.error("Failed to warm VS index:", error);
  process.exit(1);
});
