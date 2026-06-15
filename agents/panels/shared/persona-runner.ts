/**
 * Per-persona evaluation + staking pipeline.
 *
 * Given a persona, a claim, and shared cycle context, this:
 *   1. Runs cheap skip checks (already-challenged, self-created, private, full).
 *   2. Branches on archetype:
 *        - rule-based → contrarian / flow-follow evaluators (no LLM)
 *        - llm-biased / specialist / micro → persona-LLM with cached evidence
 *   3. Decides whether to stake and how much (Kelly for LLM personas).
 *   4. Submits challengeClaim through the persona's Mantle signer.
 */

import {
  microToNative,
  nativeToMicro,
  getExplorerTxUrl,
} from "../../../lib/mantle";
import {
  executeBraniumWrite,
  getAddressFromPrivateKey,
} from "../../../lib/mantle-agent";
import { BRANIUM_ABI } from "../../../lib/branium-abi";
import {
  type PersonaSpec,
  personaPrivateKeyEnv,
} from "../personas";
import { getOrFetchEvidence } from "./evidence-cache";
import { evaluateClaimAsPersona, type PersonaVerdict } from "./persona-llm";
import {
  evaluateContrarian,
  evaluateFlowFollower,
} from "./persona-rules";
import type {
  ClaimOnChain,
  PersonaDecision,
  PersonaRunnerContext,
  PersonaStakeReceipt,
} from "./types";

const DEFAULT_MIN_CONFIDENCE = 75;
const DEFAULT_STAKE_MNT     = 2;

/**
 * LLM calls are chained serially inside a single process and separated by a small delay so bursts across personas do not trip model rate limits. Overridable via PANELS_LLM_THROTTLE_MS.
 */
const LLM_THROTTLE_MS = Number(process.env.PANELS_LLM_THROTTLE_MS ?? process.env.PANELS_LLM_THROTTLE_MS ?? 4500);
let lastLlmCallAt = 0;

async function throttleLlm(): Promise<void> {
  const now = Date.now();
  const since = now - lastLlmCallAt;
  if (since < LLM_THROTTLE_MS) {
    await new Promise((r) => setTimeout(r, LLM_THROTTLE_MS - since));
  }
  lastLlmCallAt = Date.now();
}

/**
 * Kelly Criterion fraction of bankroll for a given confidence,
 * conservative cap at 15% of bankroll per bet (lower than oracle's
 * 25% because personas play across many markets).
 */
function kellyFraction(confidencePct: number, netOdds = 1.0): number {
  const p = confidencePct / 100;
  const q = 1 - p;
  const f = (p * netOdds - q) / netOdds;
  return Math.max(0, Math.min(0.15, f));
}

function categoryMatches(persona: PersonaSpec, claim: ClaimOnChain): boolean {
  if (!persona.categoryFilter || persona.categoryFilter.length === 0) {
    return true;
  }
  const c = (claim.category ?? "").toLowerCase();
  return persona.categoryFilter.some((tag) => c.includes(tag.toLowerCase()));
}

/**
 * Pure decision step — no on-chain writes. Useful for the PanelVoteWidget
 * which wants to surface a persona's verdict without actually staking.
 */
export async function evaluatePersonaForClaim(
  persona: PersonaSpec,
  claim: ClaimOnChain,
  ctx: PersonaRunnerContext,
): Promise<PersonaDecision & { verdict?: PersonaVerdict }> {
  // Specialists only consider claims in their category.
  if (!categoryMatches(persona, claim)) {
    return {
      shouldStake: false,
      stakeMnt:   0,
      rationale:   `${persona.displayName} only watches ${persona.categoryFilter?.join(" / ")} markets — this one is out of scope.`,
      skipReason:  "category-filter",
    };
  }

  // Rule-based personas: no LLM call.
  if (persona.archetype === "rule-based") {
    if (persona.ruleEvaluator === "contrarian") {
      return evaluateContrarian(persona, claim);
    }
    if (persona.ruleEvaluator === "flow-follow") {
      return evaluateFlowFollower(persona, claim, ctx.publicClient, ctx.contractAddress);
    }
    return {
      shouldStake: false,
      stakeMnt:   0,
      rationale:   `${persona.displayName} has no rule evaluator wired.`,
      skipReason:  "abstain-low-confidence",
    };
  }

  // LLM-based path (llm-biased, specialist, micro).
  const evidence = await getOrFetchEvidence(claim.id, claim.resolutionUrl, ctx.evidenceCache);
  if (evidence.fetcher === "none") {
    return {
      shouldStake: false,
      stakeMnt:   0,
      rationale:   `${persona.displayName}: no usable evidence at the resolution URL — abstaining.`,
      skipReason:  "no-evidence",
    };
  }

  let verdict: PersonaVerdict;
  try {
    await throttleLlm();
    verdict = await evaluateClaimAsPersona(persona, claim, evidence.text);
  } catch (err) {
    return {
      shouldStake: false,
      stakeMnt:   0,
      rationale:   `${persona.displayName}: LLM call failed (${err instanceof Error ? err.message : "unknown"}).`,
      skipReason:  "llm-failed",
    };
  }

  const minConf = persona.minConfidence ?? DEFAULT_MIN_CONFIDENCE;

  if (verdict.verdict === "CREATOR_WINS") {
    return {
      shouldStake: false,
      stakeMnt:   0,
      rationale:   `${persona.displayName} agrees with the creator (${verdict.confidence}%): ${verdict.explanation}`,
      confidence:  verdict.confidence,
      skipReason:  "abstain-agrees-with-creator",
      verdict,
    };
  }

  if (verdict.verdict !== "CHALLENGERS_WIN" || verdict.confidence < minConf) {
    return {
      shouldStake: false,
      stakeMnt:   0,
      rationale:   `${persona.displayName} won't stake: verdict ${verdict.verdict} at ${verdict.confidence}% (threshold ${minConf}%). ${verdict.explanation}`,
      confidence:  verdict.confidence,
      skipReason:  "abstain-low-confidence",
      verdict,
    };
  }

  // Confident enough to stake. Size with Kelly, capped at 10% of bankroll.
  // Note: the bankroll cap is enforced inside runPersonaForClaim where the
  // wallet balance is read. Here we surface the base stake from the spec.
  return {
    shouldStake: true,
    stakeMnt:   persona.stakeMnt ?? DEFAULT_STAKE_MNT,
    rationale:   `${persona.displayName} stakes: ${verdict.explanation}`,
    confidence:  verdict.confidence,
    verdict,
  };
}

/**
 * Full pipeline — runs decision + on-chain stake if all guards pass.
 * Returns a receipt when a stake is submitted, null otherwise.
 */
export async function runPersonaForClaim(
  persona: PersonaSpec,
  claim: ClaimOnChain,
  ctx: PersonaRunnerContext,
): Promise<PersonaStakeReceipt | null> {
  const privateKey = process.env[personaPrivateKeyEnv(persona)]?.trim();
  if (!privateKey) {
    console.warn(
      `[panels:${persona.slug}] missing ${personaPrivateKeyEnv(persona)} — skipping.`,
    );
    return null;
  }
  const address = getAddressFromPrivateKey(privateKey).toLowerCase() as `0x${string}`;

  // Cheap skip checks — same shape the oracle uses, scoped to this persona.
  if (claim.isPrivate) return null;
  if (claim.creator.toLowerCase() === address) return null;
  if (claim.challengerCount >= claim.maxChallengers) return null;

  // hasChallenged is an idempotent on-chain guard — skip if we're already in.
  let alreadyIn = false;
  try {
    alreadyIn = await ctx.publicClient.readContract({
      address: ctx.contractAddress,
      abi: BRANIUM_ABI,
      functionName: "hasChallenged",
      args: [BigInt(claim.id), address as `0x${string}`],
    }) as boolean;
  } catch {
    // If the read fails, default to skipping rather than risking double-stake.
    return null;
  }
  if (alreadyIn) return null;

  // Wallet balance — keep a 2x stake buffer so we never drain.
  const balance = await ctx.publicClient.getBalance({ address: address as `0x${string}` });
  const baseStakeMnt = persona.stakeMnt ?? DEFAULT_STAKE_MNT;
  const minRequired = nativeToMicro(baseStakeMnt * 2);
  if (balance < minRequired) {
    console.log(
      `[panels:${persona.slug}] insufficient balance (${microToNative(balance).toFixed(2)} MNT), skipping`,
    );
    return null;
  }

  // Decide.
  const decision = await evaluatePersonaForClaim(persona, claim, ctx);
  if (!decision.shouldStake) {
    return null;
  }

  // For LLM personas, apply Kelly sizing on top of the base stake.
  // Rule personas don't have a confidence score — they use the base stake as-is.
  let stakeMnt = decision.stakeMnt;
  if (decision.confidence && decision.confidence >= (persona.minConfidence ?? DEFAULT_MIN_CONFIDENCE)) {
    const kelly = kellyFraction(decision.confidence);
    const bankrollMnt = Number(balance) / 1e18;
    const kellyStake = Math.max(
      baseStakeMnt,
      Math.min(bankrollMnt * kelly, bankrollMnt * 0.10),
    );
    stakeMnt = Math.round(kellyStake * 100) / 100;
  }

  // Submit.
  const stakeWei = nativeToMicro(stakeMnt);
  const txHash = await executeBraniumWrite({
    privateKey,
    functionName: "challengeClaim",
    args:         [BigInt(claim.id), stakeWei, ""],
    value:        stakeWei,
  });

  console.log(
    `[panels:${persona.slug}] ✓ Staked ${stakeMnt} MNT on claim #${claim.id} — ${getExplorerTxUrl(txHash)}`,
  );
  console.log(`[panels:${persona.slug}]   ${decision.rationale.slice(0, 160)}`);

  return {
    persona,
    claimId:   claim.id,
    stakeMnt,
    txHash,
    rationale: decision.rationale,
  };
}
