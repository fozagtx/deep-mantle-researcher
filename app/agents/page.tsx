import Link from "next/link";
import PageTransition, { AnimatedItem } from "@/components/PageTransition";
import {
  createMantlePublicClient,
  getContractAddress,
  getDeployBlock,
  isContractConfigured,
  paginatedGetLogs,
  microToNative,
  getExplorerTxUrl,
} from "@/lib/mantle";
import { BRANIUM_ABI } from "@/lib/branium-abi";
import {
  classifyActor,
  getActivePanelPersonas,
  getPersonaForAddress,
} from "@/lib/panels-resolver";

export const dynamic = "force-dynamic";
export const revalidate = 20;

/* ── Data ────────────────────────────────────────────────────────────────── */

type EventRow =
  | {
      kind:        "created";
      claimId:     number;
      actor:       string;
      category:    string;
      txHash:      string;
      blockNumber: number;
    }
  | {
      kind:        "challenged";
      claimId:     number;
      actor:       string;
      stakeWei:    bigint;
      txHash:      string;
      blockNumber: number;
    }
  | {
      kind:        "resolved";
      claimId:     number;
      winnerSide:  number;
      confidence:  number;
      summary:     string;
      txHash:      string;
      blockNumber: number;
    };

async function fetchEvents() {
  const client  = createMantlePublicClient();
  const address = getContractAddress();
  if (!isContractConfigured(address)) return [] as EventRow[];
  const fromBlock = getDeployBlock();
  try {
    const [created, challenged, resolved] = await Promise.all([
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
      paginatedGetLogs(client, {
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
      }, fromBlock),
    ]);

    const rows: EventRow[] = [
      ...created.map((log: any) => ({
        kind:        "created" as const,
        claimId:     Number(log.args.id ?? 0),
        actor:       String(log.args.creator ?? "").toLowerCase(),
        category:    String(log.args.category ?? ""),
        txHash:      log.transactionHash,
        blockNumber: Number(log.blockNumber ?? 0),
      })),
      ...challenged.map((log: any) => ({
        kind:        "challenged" as const,
        claimId:     Number(log.args.id ?? 0),
        actor:       String(log.args.challenger ?? "").toLowerCase(),
        stakeWei:    BigInt(log.args.stake ?? 0),
        txHash:      log.transactionHash,
        blockNumber: Number(log.blockNumber ?? 0),
      })),
      ...resolved.map((log: any) => ({
        kind:        "resolved" as const,
        claimId:     Number(log.args.id ?? 0),
        winnerSide:  Number(log.args.winnerSide ?? 0),
        confidence:  Number(log.args.confidence ?? 0),
        summary:     String(log.args.summary ?? "").slice(0, 180),
        txHash:      log.transactionHash,
        blockNumber: Number(log.blockNumber ?? 0),
      })),
    ];

    rows.sort((a, b) => b.blockNumber - a.blockNumber);
    return rows;
  } catch (err) {
    console.error("[agents] fetchEvents failed:", err);
    return [] as EventRow[];
  }
}

async function fetchAgentAddresses() {
  const client  = createMantlePublicClient();
  const address = getContractAddress();
  if (!isContractConfigured(address)) return null;
  try {
    const [oracle, owner] = await Promise.all([
      client.readContract({ address, abi: BRANIUM_ABI, functionName: "oracle" }) as Promise<`0x${string}`>,
      client.readContract({ address, abi: BRANIUM_ABI, functionName: "owner"  }) as Promise<`0x${string}`>,
    ]);
    return { oracle, owner };
  } catch (err) {
    console.error("[agents] fetchAgentAddresses failed:", err);
    return null;
  }
}

/* ── UI bits ─────────────────────────────────────────────────────────────── */

function shortAddr(a: string): string {
  if (!a || a.length < 10) return a;
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

const SIDE_LABEL: Record<number, string> = {
  1: "creator won",
  2: "challengers won",
  3: "draw · refunded",
  4: "unresolvable · refunded",
};

function ActorTag({
  addr,
  oracle,
  creator,
  role,
}: {
  addr: string;
  oracle?: string;
  creator?: string;
  role?: "settlement" | "market";
}) {
  if (role === "settlement") {
    return <span className="inline-flex items-center rounded-md border border-pv-emerald/40 bg-pv-emerald/[0.08] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em] text-pv-emerald">settlement</span>;
  }
  if (role === "market") {
    return <span className="inline-flex items-center rounded-md border border-pv-border/60 bg-[#F4F9FF] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em] text-pv-text">market</span>;
  }

  const actor = classifyActor(addr, oracle, creator);
  if (actor.kind === "oracle") {
    return <span className="inline-flex items-center rounded-md border border-pv-emerald/40 bg-pv-emerald/[0.08] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em] text-pv-emerald">settlement</span>;
  }
  if (actor.kind === "market-creator") {
    return <span className="inline-flex items-center rounded-md border border-pv-border/60 bg-[#F4F9FF] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em] text-pv-text">market</span>;
  }
  if (actor.kind === "panel") {
    const p = actor.persona;
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-pv-border/50 bg-[#F4F9FF] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em] text-pv-text">
        <span className="text-[11px] leading-none grayscale opacity-75">{p.emoji}</span>
        <span>{p.displayName.replace(/^The /, "")}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-flex items-center rounded-md border border-pv-fuch/40 bg-pv-fuch/[0.08] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em] text-pv-fuch">human</span>
      <span className="font-mono text-[11px] text-pv-muted">{shortAddr(addr)}</span>
    </span>
  );
}

function tierPill(c: number) {
  if (c >= 80) return { label: "FIRM", cls: "border-pv-emerald/40 bg-pv-emerald/[0.08] text-pv-emerald" };
  if (c >= 60) return { label: "CONTESTED", cls: "border-pv-border/60 bg-[#F4F9FF] text-pv-text" };
  if (c > 0)   return { label: "LOW", cls: "border-amber-400/40 bg-amber-400/[0.10] text-amber-700" };
  return { label: "—", cls: "border-pv-border/40 bg-[#F4F9FF] text-pv-muted" };
}

/* ── Page ────────────────────────────────────────────────────────────────── */

function parseFilter(raw: string | string[] | undefined): string {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v ?? "all";
}

export default async function AgentsPage({
  searchParams,
}: {
  searchParams?: Promise<{ filter?: string | string[] }>;
}) {
  const [events, agentInfo, sp] = await Promise.all([
    fetchEvents(),
    fetchAgentAddresses(),
    searchParams ?? Promise.resolve({} as { filter?: string | string[] }),
  ]);
  const filter = parseFilter(sp?.filter);
  const panelPersonas = getActivePanelPersonas();

  const isOracle  = (a: string) => !!agentInfo && a.toLowerCase() === agentInfo.oracle.toLowerCase();
  const isCreator = (a: string) => !!agentInfo && a.toLowerCase() === agentInfo.owner.toLowerCase();
  const isPanelPersona = (a: string) => getPersonaForAddress(a) !== null;
  /** Resolved events have no .actor (oracle implied); created/challenged carry the staker address. */
  const eventActor = (e: EventRow): string | null =>
    e.kind === "resolved" ? null : e.actor;
  const isAgentEvent = (e: EventRow) => {
    if (e.kind === "resolved") return true;
    const a = eventActor(e);
    if (!a) return false;
    if (e.kind === "challenged") return isOracle(a) || isPanelPersona(a);
    if (e.kind === "created")    return isCreator(a);
    return false;
  };
  const isHumanEvent = (e: EventRow) => !isAgentEvent(e);

  const systemEvents   = events.filter(isAgentEvent);
  const humanEvents   = events.filter(isHumanEvent);
  const panelEvents = events.filter((e) => {
    const a = eventActor(e);
    return a !== null && isPanelPersona(a);
  });

  // Per-persona filter slugs come in as filter=persona:<slug>
  const personaFilter = filter.startsWith("persona:") ? filter.slice("persona:".length) : null;
  const visibleEvents = (() => {
    if (personaFilter) {
      const matchAddr = panelPersonas.find((p) => p.persona.slug === personaFilter)?.address.toLowerCase();
      if (!matchAddr) return [];
      return events.filter((e) => {
        const a = eventActor(e);
        return a !== null && a.toLowerCase() === matchAddr;
      });
    }
    if (filter === "agents")  return systemEvents;
    if (filter === "humans")  return humanEvents;
    if (filter === "panels" || filter === "panel") return panelEvents;
    return events;
  })();

  const humanStakerSet = new Set<string>();
  for (const e of humanEvents) {
    if (e.kind === "created" || e.kind === "challenged") {
      humanStakerSet.add(e.actor.toLowerCase());
    }
  }
  const humanStakerCount = humanStakerSet.size;

  return (
    <main className="mx-auto max-w-[1100px] px-4 py-10 sm:px-6 lg:px-8">
      <PageTransition>
      <AnimatedItem>
      <header className="mb-8 space-y-1.5">
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-pv-emerald">Activity log</p>
        <h1 className="font-display text-3xl font-bold tracking-tight text-pv-text sm:text-4xl">
          On-chain activity, side by side
        </h1>
        <p className="max-w-2xl text-sm text-pv-muted">
          Every row is a real on-chain transaction from the Branium contract. Human
          wallets, panel wallets, market opens, challenges, and settlements appear in one feed.
          Cached for 20 seconds.
        </p>
        <div className="flex flex-wrap items-center gap-2 pt-2 text-[11px] font-mono uppercase tracking-[0.16em]">
          <span className="rounded-md border border-pv-emerald/35 bg-pv-emerald/[0.06] px-2 py-1 text-pv-emerald">
            {systemEvents.length} system
          </span>
          {panelEvents.length > 0 && (
            <span className="rounded-md border border-amber-400/35 bg-amber-400/[0.06] px-2 py-1 text-amber-700">
              {panelEvents.length} panels ({panelPersonas.length} signers)
            </span>
          )}
          <span className="rounded-md border border-pv-fuch/35 bg-pv-fuch/[0.06] px-2 py-1 text-pv-fuch">
            {humanEvents.length} human · {humanStakerCount} unique
          </span>
          <span className="rounded-md border border-pv-border/40 bg-[#F4F9FF] px-2 py-1 text-pv-muted">
            {events.length} total
          </span>
        </div>
      </header>
      </AnimatedItem>

      {/* Combined live feed */}
      <AnimatedItem delay={0.06}>
      <section>
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="font-display text-xl font-bold tracking-tight text-pv-text">Live feed</h2>
          <nav className="flex flex-wrap items-center gap-1.5 text-[11px] font-mono uppercase tracking-[0.16em]">
            {[
              { key: "all",     label: `All · ${events.length}` },
              { key: "agents",  label: `System · ${systemEvents.length}` },
              { key: "panels", label: `Panels · ${panelEvents.length}` },
              { key: "humans",  label: `Humans · ${humanEvents.length}` },
            ].map(({ key, label }) => {
              const active = filter === key;
              const href = key === "all" ? "?" : `?filter=${key}`;
              return (
                <Link
                  key={key}
                  href={href}
                  scroll={false}
                  className={`rounded-md border px-2 py-1 transition-colors ${
                    active
                      ? "border-pv-emerald bg-pv-emerald/[0.10] text-pv-emerald"
                      : "border-pv-border/40 bg-[#F4F9FF] text-pv-muted hover:border-pv-emerald/40 hover:text-pv-text"
                  }`}
                >
                  {label}
                </Link>
              );
            })}
            {panelPersonas.length > 0 && (
              <details className="relative">
                <summary className={`cursor-pointer list-none rounded-md border px-2 py-1 transition-colors ${
                  personaFilter
                    ? "border-pv-emerald bg-pv-emerald/[0.10] text-pv-emerald"
                    : "border-pv-border/40 bg-[#F4F9FF] text-pv-muted hover:border-pv-emerald/40 hover:text-pv-text"
                }`}>
                  {personaFilter
                    ? panelPersonas.find((p) => p.persona.slug === personaFilter)?.persona.displayName ?? "Panel"
                    : "Pick panel ▾"}
                </summary>
                <div className="absolute right-0 z-10 mt-1 min-w-[200px] rounded-lg border border-pv-border/50 bg-pv-surface p-1 shadow-lg">
                  {panelPersonas.map(({ persona }) => (
                    <Link
                      key={persona.slug}
                      href={`?filter=persona:${persona.slug}`}
                      scroll={false}
                      className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-[#F4F9FF]"
                    >
                      <span className="text-base leading-none grayscale opacity-75">{persona.emoji}</span>
                      <span className="text-pv-text normal-case">{persona.displayName}</span>
                    </Link>
                  ))}
                </div>
              </details>
            )}
          </nav>
        </div>
        {visibleEvents.length === 0 ? (
          <div className="rounded-2xl border border-pv-border/30 bg-white p-8 text-center text-sm text-pv-muted">
            {filter === "humans"
              ? "No human stakers yet. Be the first — open a claim from /vs/create or challenge an open market."
              : filter === "agents"
              ? "No system activity yet. Once a settlement or market-open transaction lands, events stream here."
              : "No on-chain activity yet."}
          </div>
        ) : (
          <ul className="space-y-3">
            {visibleEvents.map((e, i) => (
              <li key={`${e.kind}-${e.claimId}-${e.txHash}-${i}`} className="rounded-2xl border border-pv-border/30 bg-white p-4">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-pv-muted">block #{e.blockNumber}</span>
                  <span className="font-mono text-[11px] text-pv-emerald">claim #{e.claimId}</span>
                  {e.kind === "created" && (
                    <>
                      <ActorTag addr={e.actor} oracle={agentInfo?.oracle} creator={agentInfo?.owner} role="market" />
                      <span className="text-[13px] font-bold text-pv-text">opened a market</span>
                      <span className="text-[11px] text-pv-muted">· {e.category}</span>
                    </>
                  )}
                  {e.kind === "challenged" && (
                    <>
                      <ActorTag addr={e.actor} oracle={agentInfo?.oracle} creator={agentInfo?.owner} />
                      <span className="text-[13px] font-bold text-pv-text">staked the contrarian side</span>
                      <span className="text-[11px] font-mono text-pv-text/95">{microToNative(e.stakeWei).toFixed(2)} MNT</span>
                    </>
                  )}
                  {e.kind === "resolved" && (() => {
                    const t = tierPill(e.confidence);
                    return (
                      <>
                        <ActorTag addr={agentInfo?.oracle ?? ""} oracle={agentInfo?.oracle} creator={agentInfo?.owner} role="settlement" />
                        <span className="text-[13px] font-bold text-pv-text">resolved · {SIDE_LABEL[e.winnerSide] ?? "unknown"}</span>
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] ${t.cls}`}>{t.label} · {e.confidence}%</span>
                      </>
                    );
                  })()}
                  <a href={getExplorerTxUrl(e.txHash)} target="_blank" rel="noreferrer" className="ml-auto font-mono text-[10px] text-pv-muted hover:text-pv-emerald">tx ↗</a>
                </div>
                {e.kind === "resolved" && e.summary && (
                  <p className="mt-2 text-[12px] leading-relaxed text-pv-text">{e.summary}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      </AnimatedItem>

      <AnimatedItem delay={0.1}>
      <div className="mt-10 text-center">
        <Link href="/stats" className="text-sm text-pv-muted transition-colors hover:text-pv-text">View aggregate stats →</Link>
      </div>
      </AnimatedItem>
      </PageTransition>
    </main>
  );
}
