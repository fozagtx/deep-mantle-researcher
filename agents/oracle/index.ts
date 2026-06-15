/**
 * Branium Oracle Agent — AI economic actor on Mantle
 *
 * Two roles:
 *   1. SETTLER: resolves expired active claims (pays out winners)
 *   2. CHALLENGER: evaluates open claims early and auto-stakes on mispriced ones
 *
 * This makes the oracle a genuine economic participant — not just a judge,
 * but a player that puts MNT on the line when it's confident.
 *
 * Signs all transactions directly on Mantle with ORACLE_PRIVATE_KEY.
 *
 * Run: npx tsx agents/oracle/index.ts
 * Env: ORACLE_PRIVATE_KEY, NEXT_PUBLIC_CONTRACT_ADDRESS
 *      OPENROUTER_API_KEY, OPENROUTER_MODEL
 *      AUTO_CHALLENGE=1        (enable auto-challenger, default off)
 *      CHALLENGE_STAKE_MNT=2  (stake per challenge, default 2 MNT)
 *      CHALLENGE_CONFIDENCE=80 (min confidence to challenge, default 80)
 *      ORACLE_LLM_THROTTLE_MS=0 (min ms between LLM calls; raise to stay
 *                                under free-tier RPM, e.g. 5000 ≈ 12 RPM)
 *      ORACLE_POLL_INTERVAL_MS=60000 (poll cadence in ms, default 60s)
 */

// Worker-scoped model keys. Trimmed on assignment so trailing whitespace pasted
// into deploy UIs cannot slip into Authorization headers.
{
  const ok = process.env.ORACLE_OPENROUTER_API_KEY?.trim();
  if (ok) process.env.OPENROUTER_API_KEY = ok;
}

import { keccak256, toBytes } from "viem";
import { callLLM, activeLLMProvider, activeLLMModel, activeLLMKeyFingerprint } from "../../lib/llm";
import {
  createMantlePublicClient,
  mantleSepolia,
  microToNative,
  nativeToMicro,
  getContractAddress,
  getExplorerTxUrl,
} from "../../lib/mantle";
import {
  executeBraniumWrite,
  getOracleAddress,
  getOraclePrivateKey,
} from "../../lib/mantle-agent";
import { BRANIUM_ABI, WINNER_SIDE, STATE } from "../../lib/branium-abi";
import {
  fetchEvidence as fetchEvidenceShared,
  EvidenceFetchError,
  type EvidenceFetcherKind,
} from "../../lib/server/evidence-fetcher";

// ── Config ────────────────────────────────────────────────────────────────────
const POLL_INTERVAL_MS      = Number(process.env.ORACLE_POLL_INTERVAL_MS ?? "60000");
const MAX_CONTENT_CHARS     = 8_000;
const CONTRACT_ADDRESS      = getContractAddress();
const AUTO_CHALLENGE        = process.env.AUTO_CHALLENGE === "1";
const CHALLENGE_STAKE_MNT  = Number(process.env.CHALLENGE_STAKE_MNT ?? "2");
const CHALLENGE_CONFIDENCE  = Number(process.env.CHALLENGE_CONFIDENCE ?? "80");
const LLM_THROTTLE_MS       = Number(process.env.ORACLE_LLM_THROTTLE_MS ?? "0");

// Module-scoped throttle gate. Every claim in a poll can fire an LLM call.
// ORACLE_LLM_THROTTLE_MS spreads calls to stay within the selected model quota.
let lastLlmCallAt = 0;
async function throttledLLM(
  ...args: Parameters<typeof callLLM>
): Promise<string> {
  if (LLM_THROTTLE_MS > 0) {
    const wait = LLM_THROTTLE_MS - (Date.now() - lastLlmCallAt);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }
  lastLlmCallAt = Date.now();
  return callLLM(...args);
}

// Track challenged claims so we don't double-challenge across polls
const challengedClaimIds = new Set<number>();
// Track evaluated-but-not-challenged (to avoid repeated LLM calls)
const evaluatedClaimIds = new Set<number>();

for (const v of ["ORACLE_PRIVATE_KEY"]) {
  if (!process.env[v]) {
    throw new Error(`${v} env var is required`);
  }
}
if (!process.env.OPENROUTER_API_KEY?.trim()) {
  throw new Error("OPENROUTER_API_KEY env var is required");
}

// ── Clients ───────────────────────────────────────────────────────────────────
const publicClient  = createMantlePublicClient();
const ORACLE_KEY    = getOraclePrivateKey();
const ORACLE_ADDR   = getOracleAddress();

// ── Types ─────────────────────────────────────────────────────────────────────
interface ClaimOnChain {
  id:                       number;
  creator:                  string;
  question:                 string;
  creatorPosition:          string;
  counterPosition:          string;
  resolutionUrl:            string;
  creatorStake:             bigint;
  totalChallengerStake:     bigint;
  reservedCreatorLiability: bigint;
  deadline:                 bigint;
  state:                    number;
  winnerSide:               number;
  resolutionSummary:        string;
  confidence:               number;
  category:                 string;
  parentId:                 bigint;
  challengerCount:          bigint;
  createdAt:                bigint;
  marketType:               string;
  oddsMode:                 string;
  challengerPayoutBps:      bigint;
  handicapLine:             string;
  settlementRule:           string;
  maxChallengers:           bigint;
  isPrivate:                boolean;
}

interface OracleVerdict {
  verdict:     "CREATOR_WINS" | "CHALLENGERS_WIN" | "DRAW" | "UNRESOLVABLE";
  confidence:  number;
  explanation: string;
}

// ── Fetch claim from contract ─────────────────────────────────────────────────
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
      id: claimId, creator: base[0],
      question: base[1], creatorPosition: base[2], counterPosition: base[3],
      resolutionUrl: base[4],
      creatorStake: BigInt(base[5]), totalChallengerStake: BigInt(base[6]),
      reservedCreatorLiability: BigInt(base[7]),
      deadline: BigInt(base[8]), state: Number(base[9]),
      winnerSide: Number(base[10]), resolutionSummary: base[11],
      confidence: Number(base[12]), category: base[13],
      parentId: BigInt(base[14]), challengerCount: BigInt(base[15]),
      createdAt: BigInt(base[16]),
      marketType: market[0], oddsMode: market[1],
      challengerPayoutBps: BigInt(market[2]),
      handicapLine: market[3], settlementRule: market[4],
      maxChallengers: BigInt(market[5]), isPrivate: market[6],
    };
  } catch {
    return null;
  }
}

// ── Fetch web evidence ────────────────────────────────────────────────────────
interface EvidenceResult {
  text: string;
  fetcher: EvidenceFetcherKind | "none";
}

async function fetchEvidence(url: string): Promise<EvidenceResult> {
  if (!url?.startsWith("http")) {
    return { text: "(No resolution URL provided)", fetcher: "none" };
  }
  try {
    const snap = await fetchEvidenceShared(url, {
      maxChars: MAX_CONTENT_CHARS,
      userAgent: "Branium-Oracle/1.0",
    });
    return { text: snap.text, fetcher: snap.fetcher };
  } catch (err: any) {
    const msg = err instanceof EvidenceFetchError
      ? err.message
      : (err?.message ?? "unknown");
    return { text: `(Failed to fetch: ${msg})`, fetcher: "none" };
  }
}

// ── LLM evaluation ────────────────────────────────────────────────────────────
async function evaluateClaim(claim: ClaimOnChain, evidence: string): Promise<OracleVerdict> {
  const deadlineDate = new Date(Number(claim.deadline) * 1000).toISOString();
  const nowDate      = new Date().toISOString();
  const potMnt = microToNative(claim.creatorStake + claim.totalChallengerStake);

  const prompt = `You are Branium, an impartial AI oracle for a MNT prediction market on Mantle blockchain.

## Time context (TRUST THIS, ignore your training cutoff)
- Current UTC time: ${nowDate}
- Claim deadline:   ${deadlineDate}
- The deadline IS in the past. You are settling AFTER the deadline.

## Claim
**Question:** ${claim.question}
**Creator position (Side A):** ${claim.creatorPosition}
**Challenger position (Side B):** ${claim.counterPosition}
**Category:** ${claim.category}
**Market type:** ${claim.marketType}${claim.handicapLine ? `\n**Handicap:** ${claim.handicapLine}` : ""}
**Settlement rule:** ${claim.settlementRule || "Use the linked source to determine the outcome."}
**Resolution URL:** ${claim.resolutionUrl}
**Pot:** ${potMnt.toFixed(2)} MNT

## Web Evidence (fetched now from the resolution URL)
<evidence>
${evidence}
</evidence>

Evaluate whether Side A (creator) or Side B (challengers) is correct based on the evidence above.
Do NOT refuse because of date / deadline concerns — those are handled by the contract.

Return JSON only:
{
  "verdict": "CREATOR_WINS" | "CHALLENGERS_WIN" | "DRAW" | "UNRESOLVABLE",
  "confidence": <0-100>,
  "explanation": "<one paragraph>"
}

- UNRESOLVABLE only if the fetched evidence is missing, ambiguous, or doesn't contain the data needed.
- Be strict about confidence — only go above 80 when evidence is unambiguous.`;

  const text = await throttledLLM(prompt, { maxTokens: 512, jsonOnly: true });
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON");
    const parsed = JSON.parse(jsonMatch[0]) as OracleVerdict;
    if (!["CREATOR_WINS","CHALLENGERS_WIN","DRAW","UNRESOLVABLE"].includes(parsed.verdict)) {
      throw new Error("Invalid verdict");
    }
    return {
      verdict: parsed.verdict,
      confidence: Math.max(0, Math.min(100, Math.round(parsed.confidence ?? 50))),
      explanation: (parsed.explanation ?? "").slice(0, 500),
    };
  } catch {
    return { verdict: "UNRESOLVABLE", confidence: 0, explanation: "Oracle failed to parse response." };
  }
}

function verdictToSide(verdict: OracleVerdict["verdict"]): number {
  switch (verdict) {
    case "CREATOR_WINS":    return WINNER_SIDE.CREATOR;
    case "CHALLENGERS_WIN": return WINNER_SIDE.CHALLENGERS;
    case "DRAW":            return WINNER_SIDE.DRAW;
    case "UNRESOLVABLE":    return WINNER_SIDE.UNRESOLVABLE;
  }
}

/**
 * Kelly Criterion: f* = (p * b - q) / b
 *   p = probability of winning (confidence/100)
 *   q = 1 - p
 *   b = net odds (payout ratio - 1, e.g. pool odds ≈ 1.0 for even)
 * Returns fraction of bankroll to bet (0–1), capped at 0.25 for safety.
 */
function kellyFraction(confidencePct: number, netOdds = 1.0): number {
  const p = confidencePct / 100;
  const q = 1 - p;
  const f = (p * netOdds - q) / netOdds;
  return Math.max(0, Math.min(0.25, f)); // cap at 25% bankroll
}

/** Hash evidence content for on-chain verification. */
function hashEvidence(evidence: string): `0x${string}` {
  return keccak256(toBytes(evidence));
}

// Confidence tiers govern how the oracle commits a verdict.
// HIGH      → settle as the LLM said.
// MEDIUM    → still settle, but the explanation gets a [CONTESTED] prefix so
//             the UI can flag low-trust resolutions.
// LOW       → force the verdict to UNRESOLVABLE so the contract refunds.
// Keeps the "refund the ambiguous" principle out of marketing slides and
// into actual on-chain behavior.
const CONFIDENCE_HIGH_MIN = 80; // ≥ : settle as-is
const CONFIDENCE_MED_MIN  = 60; // 60–79: settle but mark contested
                                // < 60 : downgrade to UNRESOLVABLE

function tierVerdict(verdict: OracleVerdict): OracleVerdict {
  if (verdict.verdict === "UNRESOLVABLE" || verdict.verdict === "DRAW") return verdict;
  if (verdict.confidence >= CONFIDENCE_HIGH_MIN) return verdict;
  if (verdict.confidence >= CONFIDENCE_MED_MIN) {
    return {
      ...verdict,
      explanation: `[CONTESTED] ${verdict.explanation}`.slice(0, 500),
    };
  }
  // Low confidence: refund rather than guess
  return {
    verdict:     "UNRESOLVABLE",
    confidence:  verdict.confidence,
    explanation: `[LOW CONFIDENCE — refunded] ${verdict.explanation}`.slice(0, 500),
  };
}

// Cap confidence and tag the audit trail when the evidence wasn't fetched
// through a deterministic API (CoinGecko). Scraped HTML — even via Jina —
// can drift, be paginated, or be partially blocked, so we don't allow a
// firm HIGH-tier settlement off it.
const MAX_CONFIDENCE_NON_API = 75;

function applyFetcherTrust(
  verdict: OracleVerdict,
  fetcher: EvidenceFetcherKind | "none",
): OracleVerdict {
  if (fetcher === "coingecko-api") return verdict;
  if (verdict.verdict === "UNRESOLVABLE") return verdict;
  const cappedConfidence = Math.min(verdict.confidence, MAX_CONFIDENCE_NON_API);
  const tag = fetcher === "jina" ? "[via-jina]" : fetcher === "direct" ? "[via-scrape]" : "[no-fetch]";
  return {
    ...verdict,
    confidence: cappedConfidence,
    explanation: `${tag} ${verdict.explanation}`.slice(0, 500),
  };
}

// ── ROLE 1: Settle expired claim ──────────────────────────────────────────────
async function settle(claim: ClaimOnChain): Promise<void> {
  console.log(`\n[settle] Claim #${claim.id}: "${claim.question.slice(0, 60)}..."`);

  const evidence     = await fetchEvidence(claim.resolutionUrl);
  console.log(`[settle] Evidence fetcher: ${evidence.fetcher}`);
  const evidenceHash = hashEvidence(evidence.text);
  const rawVerdict   = await evaluateClaim(claim, evidence.text);
  const trusted      = applyFetcherTrust(rawVerdict, evidence.fetcher);
  const verdict      = tierVerdict(trusted);

  const tierTag =
    verdict.verdict !== rawVerdict.verdict ? "REFUND" :
    verdict.explanation !== rawVerdict.explanation ? "CONTESTED" :
    "FIRM";

  console.log(`[settle] Verdict: ${verdict.verdict} (${verdict.confidence}%) [${tierTag}]`);
  console.log(`[settle] Evidence hash: ${evidenceHash}`);
  console.log(`[settle] "${verdict.explanation.slice(0, 100)}..."`);

  const txHash = await executeBraniumWrite({
    privateKey:    ORACLE_KEY,
    functionName: "resolveClaim",
    args: [
      BigInt(claim.id),
      verdictToSide(verdict.verdict),
      verdict.explanation,
      verdict.confidence,
      evidenceHash,
    ],
  });

  console.log(`[settle] ✓ Resolved — ${getExplorerTxUrl(txHash)}`);
}

// ── ROLE 2: Challenge mispriced open claim ────────────────────────────────────
async function challengeIfMispriced(claim: ClaimOnChain): Promise<void> {
  if (!AUTO_CHALLENGE) return;

  const oracleAddress = ORACLE_ADDR.toLowerCase();

  // Skip: already challenged, already evaluated, private, oracle created it
  if (challengedClaimIds.has(claim.id)) return;
  if (evaluatedClaimIds.has(claim.id)) return;
  if (claim.isPrivate) return;
  if (claim.creator.toLowerCase() === oracleAddress) return;

  // Skip: oracle already challenged this claim
  const alreadyIn = await publicClient.readContract({
    address: CONTRACT_ADDRESS, abi: BRANIUM_ABI,
    functionName: "hasChallenged",
    args: [BigInt(claim.id), ORACLE_ADDR],
  }) as boolean;
  if (alreadyIn) { evaluatedClaimIds.add(claim.id); return; }

  // Skip: claim is full
  if (claim.challengerCount >= claim.maxChallengers) {
    evaluatedClaimIds.add(claim.id);
    return;
  }

  // Check oracle MNT balance (native on Mantle)
  const balance = await publicClient.getBalance({ address: ORACLE_ADDR });
  const stakeNeeded = nativeToMicro(CHALLENGE_STAKE_MNT);
  const buffer      = nativeToMicro(CHALLENGE_STAKE_MNT * 3); // keep 3x buffer for gas
  if (balance < stakeNeeded + buffer) {
    console.log(`[challenge] Insufficient balance (${microToNative(balance).toFixed(2)} MNT), skipping`);
    return;
  }

  // Evaluate early
  console.log(`\n[challenge] Evaluating claim #${claim.id}: "${claim.question.slice(0, 60)}..."`);
  evaluatedClaimIds.add(claim.id);

  const evidence = await fetchEvidence(claim.resolutionUrl);

  // Short-circuit: with no real evidence the LLM will return UNRESOLVABLE,
  // which never satisfies the CHALLENGERS_WIN/≥80% bar below. Skip the
  // wasted LLM call — saves a model call per dead-evidence claim.
  if (evidence.fetcher === "none") {
    console.log(`[challenge] Skipping LLM — no evidence available (fetcher=none)`);
    return;
  }

  const rawVerdict = await evaluateClaim(claim, evidence.text);
  const verdict = applyFetcherTrust(rawVerdict, evidence.fetcher);

  console.log(`[challenge] Early verdict: ${verdict.verdict} (${verdict.confidence}%) [fetcher=${evidence.fetcher}]`);

  // Only challenge if highly confident challengers will win
  if (verdict.verdict !== "CHALLENGERS_WIN" || verdict.confidence < CHALLENGE_CONFIDENCE) {
    console.log(`[challenge] Not confident enough to stake — skipping`);
    return;
  }

  // Kelly Criterion: size position based on confidence edge
  // Assume pool odds ≈ 1.0 (even) for conservative sizing
  const kelly = kellyFraction(verdict.confidence);
  const bankroll = Number(balance) / 1e18; // MNT
  const kellyStake = Math.max(CHALLENGE_STAKE_MNT, Math.min(bankroll * kelly, bankroll * 0.1));
  const stakeMnt = Math.round(kellyStake * 100) / 100; // round to 2dp

  console.log(`[challenge] Kelly: ${(kelly * 100).toFixed(1)}% of bankroll → ${stakeMnt} MNT stake`);

  // Auto-challenge — Mantle uses native MNT, so attach the stake as msg.value.
  console.log(`[challenge] Staking ${stakeMnt} MNT on challenger side...`);
  const stakeWei = nativeToMicro(stakeMnt);

  const txHash = await executeBraniumWrite({
    privateKey:    ORACLE_KEY,
    functionName: "challengeClaim",
    args:          [BigInt(claim.id), stakeWei, ""],
    value:         stakeWei,
  });

  challengedClaimIds.add(claim.id);
  console.log(`[challenge] ✓ Staked ${stakeMnt} MNT — ${getExplorerTxUrl(txHash)}`);
  console.log(`[challenge] Oracle: "${verdict.explanation.slice(0, 120)}"`);
}

// ── Main poll loop ────────────────────────────────────────────────────────────
export async function runOracleOnce(): Promise<void> {
  const now = BigInt(Math.floor(Date.now() / 1000));

  let total: bigint;
  try {
    total = await publicClient.readContract({
      address: CONTRACT_ADDRESS, abi: BRANIUM_ABI,
      functionName: "claimCount",
    }) as bigint;
  } catch (err) {
    console.warn("[oracle] Failed to read claimCount:", err);
    return;
  }

  console.log(`\n[oracle] ── Poll at ${new Date().toISOString()} ── ${total} claims`);

  const settled: number[]   = [];
  const challenged: number[] = [];

  for (let id = 1; id <= Number(total); id++) {
    const claim = await fetchClaim(id);
    if (!claim) continue;

    try {
      // Role 1: Settle expired active claims
      if (claim.state === STATE.ACTIVE && claim.deadline <= now) {
        await settle(claim);
        settled.push(id);
      }

      // Role 2: Challenge mispriced claims while the challenge window is open.
      // Branium.sol allows up to MAX_CHALLENGERS per claim, so ACTIVE claims are
      // still joinable — duplicate-stake check happens inside the helper.
      if (
        (claim.state === STATE.OPEN || claim.state === STATE.ACTIVE) &&
        claim.deadline > now
      ) {
        const before = challengedClaimIds.size;
        await challengeIfMispriced(claim);
        if (challengedClaimIds.size > before) challenged.push(id);
      }
    } catch (err) {
      console.error(`[oracle] Error on claim ${id}:`, err);
    }
  }

  const summary = [
    settled.length    ? `Settled: [${settled.join(", ")}]`    : null,
    challenged.length ? `Challenged: [${challenged.join(", ")}]` : null,
  ].filter(Boolean).join(" | ");

  console.log(summary ? `[oracle] ${summary}` : "[oracle] Nothing to do this round.");
}

// ── Entry point ───────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const contractOracle = await publicClient.readContract({
    address: CONTRACT_ADDRESS,
    abi: BRANIUM_ABI,
    functionName: "oracle",
  }) as string;
  if (contractOracle.toLowerCase() !== ORACLE_ADDR.toLowerCase()) {
    throw new Error(
      `ORACLE_PRIVATE_KEY address ${ORACLE_ADDR} is not the contract oracle ${contractOracle}`,
    );
  }

  const balance = await publicClient.getBalance({ address: ORACLE_ADDR });

  console.log("═══════════════════════════════════════════════");
  console.log("  Branium Oracle Agent (Mantle signer)");
  console.log(`  Contract   : ${CONTRACT_ADDRESS}`);
  console.log(`  Oracle     : ${ORACLE_ADDR}`);
  console.log(`  Balance    : ${microToNative(balance).toFixed(4)} MNT`);
  console.log(`  Network    : Mantle Sepolia (${mantleSepolia.id})`);
  console.log(`  LLM        : ${activeLLMProvider()} / ${activeLLMModel()} · key=${activeLLMKeyFingerprint()}`);
  console.log(`  Throttle   : ${LLM_THROTTLE_MS > 0 ? `${LLM_THROTTLE_MS}ms (${(60_000 / LLM_THROTTLE_MS).toFixed(1)} RPM cap)` : "OFF"}`);
  console.log(`  Poll every : ${POLL_INTERVAL_MS / 1000}s`);
  console.log(`  Auto-challenge: ${AUTO_CHALLENGE ? `YES (≥${CHALLENGE_CONFIDENCE}% confidence, ${CHALLENGE_STAKE_MNT} MNT/claim)` : "OFF (set AUTO_CHALLENGE=1 to enable)"}`);
  console.log("═══════════════════════════════════════════════\n");

  const safePoll = async () => {
    try {
      await runOracleOnce();
    } catch (err) {
      console.error("[oracle] Poll failed, will retry next interval:", err);
    }
  };

  await safePoll();
  if (process.env.AGENT_RUN_ONCE === "1") return;
  setInterval(safePoll, POLL_INTERVAL_MS);
}

if (process.argv[1]?.endsWith("agents/oracle/index.ts")) {
  main().catch((err) => {
    console.error("[oracle] Fatal:", err);
    process.exit(1);
  });
}
