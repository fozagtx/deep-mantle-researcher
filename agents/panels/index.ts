/**
 * Branium Panel Worker
 *
 * Boots a single Node process that runs 10 market panels as autonomous
 * economic actors on Mantle. Every cycle:
 *
 *   1. Reads claimCount + each open/active claim from the contract.
 *   2. Builds a per-cycle evidence cache so 10 panels share 1 HTTP
 *      fetch per resolution URL.
 *   3. For each (claim, persona) pair, runs the decision pipeline:
 *        - Specialists skip out-of-category claims (no LLM call)
 *        - Rule-based personas evaluate from pool state (no LLM call)
 *        - LLM personas call the configured model provider with a persona prompt
 *   4. Submits challengeClaim through the persona's Mantle signer when the
 *      decision says stake.
 *
 * Rate-limit strategy:
 *   - Personas are processed sequentially within a cycle (not in parallel).
 *   - Calls are processed one at a time so the selected OpenRouter model stays
 *     within its quota.
 *   - Rule-based + category-filtered personas don't consume LLM budget.
 *
 * Run: npm run panels  (or via "npm run workers" alongside oracle + market-creator)
 * Env: PANEL_<SLUG>_PRIVATE_KEY for each active persona,
 *      NEXT_PUBLIC_CONTRACT_ADDRESS,
 *      OPENROUTER_API_KEY, OPENROUTER_MODEL
 *      PANELS_PERSONAS_ACTIVE (optional CSV of slugs, e.g.
 *        "momentum,risk,signal,liquidity,stress" — restricts
 *        active personas to this subset, cuts LLM load proportionally).
 */

// Worker-scoped model key. Falls back to the shared OpenRouter key when unset.
{
  const ok = process.env.PANELS_OPENROUTER_API_KEY?.trim();
  if (ok) process.env.OPENROUTER_API_KEY = ok;
}

import {
  createMantlePublicClient,
  mantleSepolia,
  getContractAddress,
  microToNative,
} from "../../lib/mantle";
import { BRANIUM_ABI, STATE } from "../../lib/branium-abi";
import { activeLLMProvider, activeLLMModel, activeLLMKeyFingerprint } from "../../lib/llm";
import {
  PANEL_PERSONAS,
  personaPrivateKeyEnv,
} from "./personas";
import { getAddressFromPrivateKey } from "../../lib/mantle-agent";
import { runPersonaForClaim } from "./shared/persona-runner";
import type {
  ClaimOnChain,
  PersonaRunnerContext,
  EvidenceCacheEntry,
} from "./shared/types";

const POLL_INTERVAL_MS = Number(
  process.env.PANELS_POLL_INTERVAL_MS ?? 180_000
);
/**
 * Per-cycle work cap for model and transaction rate limits.
 * Claims are sorted by deadline-proximity so the panels focus on
 * the markets closest to settling.
 */
const MAX_CLAIMS_PER_CYCLE = Number(
  process.env.PANELS_MAX_CLAIMS ?? 12
);
const CONTRACT_ADDRESS     = getContractAddress();
const publicClient         = createMantlePublicClient();

if (!process.env.OPENROUTER_API_KEY?.trim()) {
  throw new Error("OPENROUTER_API_KEY env var is required");
}

// Optional CSV allowlist of persona slugs to keep active. When set, personas
// not in the list are skipped even if their wallets exist — used to scale LLM
// load down without re-provisioning wallets.
const PERSONA_ALLOWLIST = (() => {
  const raw =
    process.env.PANELS_PERSONAS_ACTIVE?.trim() ||
    process.env.PANEL_PERSONAS_ACTIVE?.trim();
  if (!raw) return null;
  const slugs = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return slugs.length > 0 ? new Set(slugs) : null;
})();

// Skip personas missing signer env. Warn once at startup, not every cycle.
const ACTIVE_PERSONAS = PANEL_PERSONAS.filter((p) => {
  if (PERSONA_ALLOWLIST && !PERSONA_ALLOWLIST.has(p.slug)) {
    return false;
  }
  const privateKey = process.env[personaPrivateKeyEnv(p)]?.trim();
  if (!privateKey) {
    console.warn(
      `[panels] ${p.emoji} ${p.displayName} is missing ${personaPrivateKeyEnv(p)} — skipping.`,
    );
    return false;
  }
  try {
    getAddressFromPrivateKey(privateKey);
    return true;
  } catch (err) {
    console.warn(
      `[panels] ${p.emoji} ${p.displayName} has an invalid ${personaPrivateKeyEnv(p)} — skipping.`,
    );
    return false;
  }
});

if (ACTIVE_PERSONAS.length === 0) {
  throw new Error("[panels] No panel signers configured");
}

// ── Fetch claim ───────────────────────────────────────────────────────────────
async function fetchClaim(claimId: number): Promise<ClaimOnChain | null> {
  try {
    const [base, market] = await Promise.all([
      publicClient.readContract({
        address: CONTRACT_ADDRESS, abi: BRANIUM_ABI,
        functionName: "getClaim", args: [BigInt(claimId)],
      }) as Promise<readonly any[]>,
      publicClient.readContract({
        address: CONTRACT_ADDRESS, abi: BRANIUM_ABI,
        functionName: "getClaimMarketConfig", args: [BigInt(claimId)],
      }) as Promise<readonly any[]>,
    ]);
    if (!base[0] || base[0] === "0x0000000000000000000000000000000000000000") {
      return null;
    }
    return {
      id: claimId,
      creator:              base[0] as string,
      question:             base[1] as string,
      creatorPosition:      base[2] as string,
      counterPosition:      base[3] as string,
      resolutionUrl:        base[4] as string,
      creatorStake:         BigInt(base[5]),
      totalChallengerStake: BigInt(base[6]),
      deadline:             BigInt(base[8]),
      state:                Number(base[9]),
      category:             base[13] as string,
      challengerCount:      BigInt(base[15]),
      marketType:           market[0] as string,
      settlementRule:       market[4] as string,
      maxChallengers:       BigInt(market[5]),
      isPrivate:            Boolean(market[6]),
    };
  } catch {
    return null;
  }
}

// ── Poll loop ─────────────────────────────────────────────────────────────────
export async function runPanelsOnce(): Promise<void> {
  const now = BigInt(Math.floor(Date.now() / 1000));

  let total: bigint;
  try {
    total = await publicClient.readContract({
      address: CONTRACT_ADDRESS, abi: BRANIUM_ABI, functionName: "claimCount",
    }) as bigint;
  } catch (err) {
    console.warn("[panels] Failed to read claimCount:", err);
    return;
  }

  console.log(
    `\n[panels] ── Poll at ${new Date().toISOString()} ── ${total} claims, ${ACTIVE_PERSONAS.length} personas`,
  );

  // Shared per-cycle evidence cache — one HTTP fetch per claim no matter
  // how many personas need it.
  const evidenceCache = new Map<number, EvidenceCacheEntry>();
  const ctx: PersonaRunnerContext = {
    publicClient,
    contractAddress: CONTRACT_ADDRESS,
    evidenceCache,
  };

  // Pre-load joinable claims so we don't refetch in the inner loop.
  const allClaims: ClaimOnChain[] = [];
  for (let id = 1; id <= Number(total); id++) {
    const claim = await fetchClaim(id);
    if (!claim) continue;
    const joinable =
      (claim.state === STATE.OPEN || claim.state === STATE.ACTIVE) &&
      claim.deadline > now;
    if (joinable) allClaims.push(claim);
  }
  if (allClaims.length === 0) {
    console.log("[panels] No joinable claims this round.");
    return;
  }

  // Focus on claims closest to settling — they're the most interesting for
  // the panels to weigh in on and keeps LLM-call volume bounded.
  allClaims.sort((a, b) => Number(a.deadline - b.deadline));
  const claims = allClaims.slice(0, MAX_CLAIMS_PER_CYCLE);
  if (claims.length < allClaims.length) {
    console.log(
      `[panels] Evaluating ${claims.length} of ${allClaims.length} joinable claims this cycle (deadline-prioritized).`,
    );
  }

  let stakesThisCycle = 0;

  for (const persona of ACTIVE_PERSONAS) {
    for (const claim of claims) {
      try {
        const receipt = await runPersonaForClaim(persona, claim, ctx);
        if (receipt) stakesThisCycle += 1;
      } catch (err) {
        console.error(
          `[panels:${persona.slug}] error on claim #${claim.id}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  }

  console.log(
    stakesThisCycle > 0
      ? `[panels] Cycle complete — ${stakesThisCycle} new stakes submitted.`
      : "[panels] Cycle complete — no new stakes.",
  );
}

// ── Entry ─────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log("═══════════════════════════════════════════════");
  console.log("  Branium Panels — 10 market panels as economic actors");
  console.log(`  Contract       : ${CONTRACT_ADDRESS}`);
  console.log(`  Network        : Mantle Sepolia (${mantleSepolia.id})`);
  console.log(`  LLM            : ${activeLLMProvider()} / ${activeLLMModel()} · key=${activeLLMKeyFingerprint()}`);
  console.log(`  Active personas: ${ACTIVE_PERSONAS.length} / ${PANEL_PERSONAS.length}`);
  console.log(`  Poll every     : ${POLL_INTERVAL_MS / 1000}s`);
  console.log("───────────────────────────────────────────────");

  for (const p of ACTIVE_PERSONAS) {
    const privateKey = process.env[personaPrivateKeyEnv(p)] as string;
    const addr = getAddressFromPrivateKey(privateKey);
    const bal  = await publicClient.getBalance({ address: addr }).catch(() => 0n);
    console.log(
      `  ${p.emoji} ${p.displayName.padEnd(22)} ${addr.slice(0, 6)}…${addr.slice(-4)} · ${microToNative(bal).toFixed(2)} MNT`,
    );
  }
  console.log("═══════════════════════════════════════════════\n");

  const safePoll = async () => {
    try {
      await runPanelsOnce();
    } catch (err) {
      console.error("[panels] poll failed, will retry next interval:", err);
    }
  };

  await safePoll();
  if (process.env.AGENT_RUN_ONCE === "1") return;
  setInterval(safePoll, POLL_INTERVAL_MS);
}

if (process.argv[1]?.endsWith("agents/panels/index.ts")) {
  main().catch((err) => {
    console.error("[panels] fatal:", err);
    process.exit(1);
  });
}
