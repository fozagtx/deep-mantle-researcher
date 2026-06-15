import Link from "next/link";
import PageTransition, { AnimatedItem } from "@/components/PageTransition";
import {
  createMantlePublicClient,
  getContractAddress,
  getDeployBlock,
  isContractConfigured,
  paginatedGetLogs,
  microToNative,
  getExplorerAddressUrl,
  getExplorerTxUrl,
} from "@/lib/mantle";
import { BRANIUM_ABI } from "@/lib/branium-abi";
import { getPersonaForAddress } from "@/lib/panels-resolver";
import type { PersonaSpec } from "@/agents/panels/personas";

export const dynamic = "force-dynamic";
export const revalidate = 30;

// ── Data ─────────────────────────────────────────────────────────────────────

interface Settlement {
  id:           number;
  winnerSide:   number;
  confidence:   number;
  summary:      string;
  evidenceHash: string;
  txHash:       string;
  blockNumber:  number;
}

interface ClaimRow {
  id:                   number;
  creator:              string;
  question:             string;
  creatorStake:         bigint;
  totalChallengerStake: bigint;
  state:                number;
  winnerSide:           number;
  confidence:           number;
}

// Concurrency cap for the per-claim getClaim fan-out. Mantle testnet RPC throttles
// (HTTP 429) when slammed with `Promise.all` over 100+ IDs. 5 workers keeps the
// burst tiny while still finishing a 100-claim page in well under a second.
const STATS_READ_CONCURRENCY = 5;

async function fetchClaims(): Promise<ClaimRow[]> {
  const client  = createMantlePublicClient();
  const address = getContractAddress();
  if (!isContractConfigured(address)) return [];

  try {
    const count = await client.readContract({
      address, abi: BRANIUM_ABI, functionName: "claimCount",
    }) as bigint;
    const total = Number(count);
    const claims: (ClaimRow | null)[] = new Array(total);

    async function readOne(id: number): Promise<ClaimRow | null> {
      try {
        const base = await client.readContract({
          address, abi: BRANIUM_ABI, functionName: "getClaim", args: [BigInt(id)],
        }) as readonly any[];
        return {
          id,
          creator:              base[0] as string,
          question:             base[1] as string,
          creatorStake:         BigInt(base[5]),
          totalChallengerStake: BigInt(base[6]),
          state:                Number(base[9]),
          winnerSide:           Number(base[10]),
          confidence:           Number(base[12]),
        };
      } catch {
        return null;
      }
    }

    let cursor = 0;
    async function worker() {
      while (true) {
        const idx = cursor++;
        if (idx >= total) return;
        claims[idx] = await readOne(idx + 1);
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(STATS_READ_CONCURRENCY, total) }, () => worker()),
    );
    return claims.filter((c): c is ClaimRow => c !== null);
  } catch (err) {
    console.error("[stats] fetchClaims failed:", err);
    return [];
  }
}

interface StakerRow {
  address:        string;
  firstBlock:     number;
  firstTxHash:    string;
  claimsCreated:  number;
  challengesMade: number;
  kind:           "oracle" | "market-creator" | "panel" | "human";
  persona?:       PersonaSpec;
}

async function fetchStakers(oracleAddr?: string, creatorAddr?: string): Promise<StakerRow[]> {
  const client  = createMantlePublicClient();
  const address = getContractAddress();
  if (!isContractConfigured(address)) return [];
  const fromBlock = getDeployBlock();
  try {
    const [created, challenged] = await Promise.all([
      paginatedGetLogs(client, {
        address,
        event: {
          type: "event",
          name: "ClaimCreated",
          inputs: [
            { name: "id",       type: "uint256", indexed: true },
            { name: "creator",  type: "address", indexed: true },
            { name: "category", type: "string",  indexed: false },
          ],
        } as any,
      }, fromBlock),
      paginatedGetLogs(client, {
        address,
        event: {
          type: "event",
          name: "ClaimChallenged",
          inputs: [
            { name: "id",         type: "uint256", indexed: true },
            { name: "challenger", type: "address", indexed: true },
            { name: "stake",      type: "uint256", indexed: false },
          ],
        } as any,
      }, fromBlock),
    ]);

    const oracleLower  = oracleAddr?.toLowerCase();
    const creatorLower = creatorAddr?.toLowerCase();
    const byAddr = new Map<string, StakerRow>();

    const upsert = (
      rawAddr: string,
      blockNumber: number,
      txHash: string,
      bump: "created" | "challenged",
    ) => {
      const addr = rawAddr.toLowerCase();
      if (!addr || addr === "0x0000000000000000000000000000000000000000") return;
      const existing = byAddr.get(addr);
      if (existing) {
        if (blockNumber < existing.firstBlock) {
          existing.firstBlock  = blockNumber;
          existing.firstTxHash = txHash;
        }
        if (bump === "created")    existing.claimsCreated  += 1;
        else                       existing.challengesMade += 1;
        return;
      }
      const persona = getPersonaForAddress(addr);
      const kind: StakerRow["kind"] =
        bump === "created" && addr === creatorLower ? "market-creator" :
        persona                                   ? "panel" :
        bump === "challenged" && addr === oracleLower ? "oracle" :
        addr === creatorLower                     ? "market-creator" :
        addr === oracleLower                      ? "oracle" :
                                                      "human";
      byAddr.set(addr, {
        address: addr,
        firstBlock:     blockNumber,
        firstTxHash:    txHash,
        claimsCreated:  bump === "created"    ? 1 : 0,
        challengesMade: bump === "challenged" ? 1 : 0,
        kind,
        persona: persona ?? undefined,
      });
    };

    for (const log of created as any[]) {
      upsert(
        String(log.args.creator ?? ""),
        Number(log.blockNumber ?? 0),
        log.transactionHash,
        "created",
      );
    }
    for (const log of challenged as any[]) {
      upsert(
        String(log.args.challenger ?? ""),
        Number(log.blockNumber ?? 0),
        log.transactionHash,
        "challenged",
      );
    }

    return Array.from(byAddr.values()).sort((a, b) => a.firstBlock - b.firstBlock);
  } catch (err) {
    console.error("[stats] fetchStakers failed:", err);
    return [];
  }
}

async function fetchSettlements(): Promise<Settlement[]> {
  const client  = createMantlePublicClient();
  const address = getContractAddress();
  if (!isContractConfigured(address)) return [];
  try {
    const logs = await paginatedGetLogs(client, {
      address,
      event: {
        type: "event",
        name: "ClaimResolved",
        inputs: [
          { name: "id",           type: "uint256", indexed: true },
          { name: "winnerSide",   type: "uint8",   indexed: false },
          { name: "summary",      type: "string",  indexed: false },
          { name: "confidence",   type: "uint8",   indexed: false },
          { name: "evidenceHash", type: "bytes32", indexed: false },
        ],
      } as any,
    }, getDeployBlock());
    return logs.slice(-12).reverse().map((log: any) => ({
      id:           Number(log.args.id ?? 0),
      winnerSide:   Number(log.args.winnerSide ?? 0),
      confidence:   Number(log.args.confidence ?? 0),
      summary:      String(log.args.summary ?? "").slice(0, 180),
      evidenceHash: String(log.args.evidenceHash ?? ""),
      txHash:       log.transactionHash,
      blockNumber:  Number(log.blockNumber ?? 0),
    }));
  } catch (err) {
    console.error("[stats] fetchSettlements failed:", err);
    return [];
  }
}

async function fetchOracleAndCreator() {
  const client = createMantlePublicClient();
  const address = getContractAddress();
  if (!isContractConfigured(address)) return null;
  try {
    const oracle = (await client.readContract({
      address, abi: BRANIUM_ABI, functionName: "oracle",
    })) as `0x${string}`;
    const owner = (await client.readContract({
      address, abi: BRANIUM_ABI, functionName: "owner",
    })) as `0x${string}`;
    return {
      oracle, owner,
    };
  } catch (err) {
    console.error("[stats] fetchOracleAndCreator failed:", err);
    return null;
  }
}

// ── UI primitives ────────────────────────────────────────────────────────────

function Kpi({ label, value, sub, tone = "default" }: {
  label: string;
  value: string | number;
  sub?:  string;
  tone?: "default" | "accent";
}) {
  return (
    <div className={`rounded-2xl border p-4 ${
      tone === "accent"
        ? "border-pv-emerald/35 bg-pv-emerald/[0.06]"
        : "border-pv-border/30 bg-white"
    }`}>
      <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-pv-muted">{label}</div>
      <div className={`mt-1 font-display text-2xl font-bold tracking-tight tabular-nums ${
        tone === "accent" ? "text-pv-emerald" : "text-pv-text"
      }`}>{value}</div>
      {sub ? <div className="mt-0.5 text-[11px] text-pv-muted">{sub}</div> : null}
    </div>
  );
}

function ConfidenceBar({ label, count, total, color }: {
  label: string;
  count: number;
  total: number;
  color: string;
}) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between text-[11px]">
        <span className="font-bold uppercase tracking-[0.16em] text-pv-text/95">{label}</span>
        <span className="font-mono text-pv-muted">{count} · {pct}%</span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-[#F4F9FF]">
        <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

const SIDE_LABEL: Record<number, { label: string; color: string }> = {
  1: { label: "Creator won",      color: "text-pv-emerald" },
  2: { label: "Challengers won",  color: "text-pv-fuch" },
  3: { label: "Draw · refunded",  color: "text-pv-muted" },
  4: { label: "Unresolvable · refunded", color: "text-amber-600" },
};

function tierLabel(c: number): { label: string; cls: string } {
  if (c >= 80) return { label: "FIRM",      cls: "border-pv-emerald/40 bg-pv-emerald/[0.08] text-pv-emerald" };
  if (c >= 60) return { label: "CONTESTED", cls: "border-pv-border/60 bg-[#F4F9FF] text-pv-text" };
  return         { label: "LOW",       cls: "border-amber-400/40 bg-amber-400/[0.10] text-amber-700" };
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default async function StatsPage() {
  const [claims, settlements, agentInfo] = await Promise.all([
    fetchClaims(),
    fetchSettlements(),
    fetchOracleAndCreator(),
  ]);
  const stakers = await fetchStakers(agentInfo?.oracle, agentInfo?.owner);
  const humanStakers   = stakers.filter((s) => s.kind === "human");
  const panelStakers = stakers.filter((s) => s.kind === "panel");

  const totalClaims    = claims.length;
  const totalResolved  = settlements.length;
  const openClaims     = claims.filter((c) => c.state === 0 || c.state === 1).length;

  // Total wagered = creator stakes + challenger stakes across all claims, in MNT.
  const totalWageredWei = claims.reduce(
    (acc, c) => acc + c.creatorStake + c.totalChallengerStake,
    0n,
  );
  const totalWageredMnt = microToNative(totalWageredWei);

  // Confidence tiers from on-chain settlement events.
  const firm      = settlements.filter((s) => s.confidence >= 80).length;
  const contested = settlements.filter((s) => s.confidence >= 60 && s.confidence < 80).length;
  const low       = settlements.filter((s) => s.confidence < 60 && s.confidence > 0).length;
  const accuracyPct =
    totalResolved > 0 ? Math.round((firm / totalResolved) * 100) : 0;

  // Refund rate: DRAW (3) or UNRESOLVABLE (4)
  const refunds  = settlements.filter((s) => s.winnerSide === 3 || s.winnerSide === 4).length;
  const refundPct = totalResolved > 0 ? Math.round((refunds / totalResolved) * 100) : 0;

  const creatorWins    = settlements.filter((s) => s.winnerSide === 1).length;
  const challengerWins = settlements.filter((s) => s.winnerSide === 2).length;
  const decided        = creatorWins + challengerWins;

  return (
    <main className="mx-auto max-w-[1100px] px-4 py-10 sm:px-6 lg:px-8">
      <PageTransition>
      <AnimatedItem>
      <header className="mb-8 space-y-1.5">
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-pv-emerald">Market analytics</p>
        <h1 className="font-display text-3xl font-bold tracking-tight text-pv-text sm:text-4xl">Live on-chain stats</h1>
        <p className="text-sm text-pv-muted">
          Every number on this page is read directly from the Branium contract on Mantle Sepolia. Cached for 30 seconds.
        </p>
      </header>
      </AnimatedItem>

      {/* Headline KPIs */}
      <AnimatedItem delay={0.03}>
      <section className="mb-10 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Kpi tone="accent" label="Total wagered" value={`${totalWageredMnt.toFixed(2)} MNT`} sub="creator + challenger stakes" />
        <Kpi label="Unique stakers" value={stakers.length} sub={`${humanStakers.length} human · ${panelStakers.length} panels · ${stakers.length - humanStakers.length - panelStakers.length} system`} />
        <Kpi label="Claims resolved" value={totalResolved} sub={`${openClaims} open · ${totalClaims} total`} />
        <Kpi label="Settlement confidence" value={`${accuracyPct}%`} sub="settlements at ≥ 80% confidence" />
        <Kpi label="Refund rate" value={`${refundPct}%`} sub="draw / unresolvable" />
      </section>
      </AnimatedItem>

      <AnimatedItem delay={0.06}>
      <section className="mb-10">
        <div className="rounded-2xl border border-[#2670DC]/25 bg-white p-5 sm:p-6">
          <h2 className="mb-1 font-display text-base font-bold tracking-tight text-pv-text">Settlement confidence distribution</h2>
          <p className="mb-5 text-xs text-pv-muted">
            How confident the settlement was when it closed a claim. Branium refunds the bottom band rather than guess.
          </p>
          <div className="space-y-4">
            <ConfidenceBar label="FIRM · ≥ 80%"      count={firm}      total={totalResolved} color="#D85F5F" />
            <ConfidenceBar label="CONTESTED · 60-79" count={contested} total={totalResolved} color="#F5AFAF" />
            <ConfidenceBar label="LOW · refunded"    count={low}       total={totalResolved} color="#E8C46C" />
          </div>
        </div>
      </section>
      </AnimatedItem>

      {/* Decided side split */}
      {decided > 0 && (
        <section className="mb-10 rounded-2xl border border-pv-border/30 bg-white p-5 sm:p-6">
          <h2 className="mb-4 font-display text-base font-bold tracking-tight text-pv-text">Decided settlements · who won</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-pv-emerald/30 bg-pv-emerald/[0.05] p-4">
              <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-pv-emerald">Creator wins</div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="font-display text-3xl font-bold tabular-nums text-pv-text">{creatorWins}</span>
                <span className="text-xs text-pv-muted">{Math.round((creatorWins / decided) * 100)}%</span>
              </div>
            </div>
            <div className="rounded-xl border border-pv-border/40 bg-[#F4F9FF] p-4">
              <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-pv-fuch">Challenger wins</div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="font-display text-3xl font-bold tabular-nums text-pv-text">{challengerWins}</span>
                <span className="text-xs text-pv-muted">{Math.round((challengerWins / decided) * 100)}%</span>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* First stakers wall */}
      <section className="mb-10">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-xl font-bold tracking-tight text-pv-text">First {Math.min(100, stakers.length)} stakers</h2>
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-pv-muted">
            ordered by first on-chain stake · earliest first
          </span>
        </div>
        {stakers.length === 0 ? (
          <div className="rounded-2xl border border-pv-border/30 bg-white p-8 text-center text-sm text-pv-muted">
            No stakers yet. The first wallet to create or challenge a claim takes seat #1.
          </div>
        ) : (
          <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {stakers.slice(0, 100).map((s, i) => {
              const seat = i + 1;
              const tone =
                s.kind === "oracle"         ? "border-pv-emerald/40 bg-pv-emerald/[0.06]" :
                s.kind === "market-creator" ? "border-pv-border/50 bg-[#F4F9FF]" :
                s.kind === "panel" && s.persona ? `${s.persona.accent.border} ${s.persona.accent.bg}` :
                                              "border-pv-fuch/30 bg-pv-fuch/[0.04]";
              const badge =
                s.kind === "oracle"
                  ? <span className="rounded border border-pv-emerald/40 bg-pv-emerald/[0.10] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.16em] text-pv-emerald">settlement</span>
                : s.kind === "market-creator"
                  ? <span className="rounded border border-pv-border/60 bg-[#F4F9FF] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.16em] text-pv-text">market</span>
                : s.kind === "panel" && s.persona
                  ? <span className="inline-flex items-center gap-1 rounded border border-pv-border/50 bg-[#F4F9FF] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.16em] text-pv-text">
                      <span className="text-[10px] leading-none grayscale opacity-75">{s.persona.emoji}</span>
                      <span className="normal-case">{s.persona.displayName.replace(/^The /, "")}</span>
                    </span>
                  : <span className="rounded border border-pv-fuch/40 bg-pv-fuch/[0.10] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.16em] text-pv-fuch">human</span>;
              return (
                <li
                  key={s.address}
                  className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${tone}`}
                >
                  <span className="w-8 shrink-0 text-right font-mono text-[12px] font-bold tabular-nums text-pv-muted">#{seat}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      {badge}
                      <a
                        href={getExplorerAddressUrl(s.address)}
                        target="_blank"
                        rel="noreferrer"
                        className="truncate font-mono text-[11px] text-pv-text/95 hover:text-pv-emerald"
                      >
                        {s.address.slice(0, 6)}…{s.address.slice(-4)} ↗
                      </a>
                    </div>
                    <div className="mt-0.5 font-mono text-[10px] text-pv-muted">
                      {s.claimsCreated > 0 && <>opened {s.claimsCreated}</>}
                      {s.claimsCreated > 0 && s.challengesMade > 0 && <> · </>}
                      {s.challengesMade > 0 && <>challenged {s.challengesMade}</>}
                      {" · block #"}{s.firstBlock}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {/* Recent settlements feed */}
      <section className="mb-10">
        <h2 className="mb-4 font-display text-xl font-bold tracking-tight text-pv-text">Settlement timeline</h2>
        {settlements.length === 0 ? (
          <div className="rounded-2xl border border-pv-border/30 bg-white p-8 text-center text-sm text-pv-muted">
            No settlements yet. Once a claim is resolved, it appears here.
          </div>
        ) : (
          <div className="space-y-3">
            {settlements.map((s) => {
              const side = SIDE_LABEL[s.winnerSide] ?? { label: "Unknown", color: "text-pv-muted" };
              const tier = tierLabel(s.confidence);
              return (
                <div key={s.txHash} className="rounded-2xl border border-pv-border/30 bg-white p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px]">
                        <span className="font-mono text-pv-muted">Claim #{s.id}</span>
                        <span className={`font-bold ${side.color}`}>{side.label}</span>
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 font-bold uppercase tracking-[0.14em] ${tier.cls}`}>{tier.label} · {s.confidence}%</span>
                      </div>
                      <p className="line-clamp-2 text-[13px] text-pv-text/95">{s.summary}</p>
                      {s.evidenceHash &&
                        s.evidenceHash !== "0x0000000000000000000000000000000000000000000000000000000000000000" && (
                          <div className="mt-1.5 flex items-center gap-1.5">
                            <span className="font-mono text-[10px] uppercase tracking-wide text-pv-muted">Evidence hash:</span>
                            <span className="max-w-[260px] truncate font-mono text-[10px] text-pv-emerald/85">{s.evidenceHash}</span>
                          </div>
                        )}
                    </div>
                    <a
                      href={getExplorerTxUrl(s.txHash)}
                      target="_blank"
                      rel="noreferrer"
                      className="shrink-0 rounded-lg border border-pv-border/40 px-2 py-1 text-[11px] text-pv-muted transition-colors hover:border-pv-emerald hover:text-pv-emerald"
                    >
                      View tx ↗
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <div className="mt-6 text-center">
        <Link href="/" className="text-sm text-pv-muted transition-colors hover:text-pv-text">
          ← Back to markets
        </Link>
      </div>
      </PageTransition>
    </main>
  );
}
