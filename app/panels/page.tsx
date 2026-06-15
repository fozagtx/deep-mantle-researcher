import Link from "next/link";
import PageTransition, { AnimatedItem } from "@/components/PageTransition";
import {
  createMantlePublicClient,
  getContractAddress,
  getDeployBlock,
  getExplorerAddressUrl,
  getExplorerTxUrl,
  isContractConfigured,
  microToNative,
  paginatedGetLogs,
} from "@/lib/mantle";
import {
  getActivePanelPersonas,
} from "@/lib/panels-resolver";
import {
  PANEL_PERSONAS,
  type PersonaSpec,
} from "@/agents/panels/personas";

export const dynamic = "force-dynamic";
export const revalidate = 30;

// ── Data ─────────────────────────────────────────────────────────────────────

interface PersonaStats {
  persona:         PersonaSpec;
  address:         string;
  balanceMnt:     number;
  stakesPlaced:    number;
  totalStakedMnt: number;
  recentBets:      Array<{
    claimId:      number;
    stakeMnt:    number;
    txHash:       string;
    blockNumber:  number;
  }>;
}

async function fetchPanelStats(): Promise<PersonaStats[]> {
  const client    = createMantlePublicClient();
  const address   = getContractAddress();
  if (!isContractConfigured(address)) return [];
  const fromBlock = getDeployBlock();
  const personas  = getActivePanelPersonas();

  if (personas.length === 0) return [];

  let challengeLogs: any[] = [];
  try {
    challengeLogs = await paginatedGetLogs(client, {
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
    }, fromBlock);
  } catch (err) {
    console.error("[panels] fetchPanelStats: log fetch failed:", err);
  }

  const byActor = new Map<string, Array<any>>();
  for (const log of challengeLogs) {
    const actor = String(log.args.challenger ?? "").toLowerCase();
    if (!actor) continue;
    const list = byActor.get(actor) ?? [];
    list.push(log);
    byActor.set(actor, list);
  }

  return Promise.all(
    personas.map(async ({ persona, address: addr }) => {
      const lowerAddr = addr.toLowerCase();
      const logs = byActor.get(lowerAddr) ?? [];

      let balance = 0n;
      try {
        balance = await client.getBalance({ address: addr as `0x${string}` });
      } catch {
        balance = 0n;
      }

      const totalStakedWei = logs.reduce<bigint>(
        (acc, log: any) => acc + BigInt(log.args.stake ?? 0),
        0n,
      );
      const sortedLogs = logs.slice().sort(
        (a: any, b: any) => Number(b.blockNumber ?? 0) - Number(a.blockNumber ?? 0),
      );

      return {
        persona,
        address: addr,
        balanceMnt:     microToNative(balance),
        stakesPlaced:    logs.length,
        totalStakedMnt: microToNative(totalStakedWei),
        recentBets:      sortedLogs.slice(0, 3).map((log: any) => ({
          claimId:     Number(log.args.id ?? 0),
          stakeMnt:   microToNative(BigInt(log.args.stake ?? 0)),
          txHash:      log.transactionHash,
          blockNumber: Number(log.blockNumber ?? 0),
        })),
      };
    }),
  );
}

// ── UI ───────────────────────────────────────────────────────────────────────

function shortAddr(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

const ARCHETYPE_LABEL: Record<PersonaSpec["archetype"], string> = {
  "llm-biased":  "LLM · biased",
  "rule-based":  "Rule · no LLM",
  "specialist":  "Specialist · category-filtered",
  "micro":       "Micro · low threshold",
};

function PersonaCard({ stats }: { stats: PersonaStats }) {
  const { persona, address, balanceMnt, stakesPlaced, totalStakedMnt, recentBets } = stats;
  const active = stakesPlaced > 0;

  return (
    <article className="flex h-full flex-col gap-4 rounded-xl border border-[#2670DC]/30 bg-white p-5 shadow-[0_18px_50px_-36px_rgba(38,112,220,0.42)] transition-[border-color,background-color,transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:border-[#2670DC]/55 hover:bg-[#F4F9FF]">
      <header className="flex items-start gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-white bg-white/70 text-2xl leading-none grayscale opacity-80 shadow-glow-emerald">
          {persona.emoji}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-base font-bold tracking-tight text-pv-text">
            {persona.displayName}
          </h3>
          <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-pv-muted">
            {ARCHETYPE_LABEL[persona.archetype]}
          </p>
        </div>
      </header>

      <p className="text-[12px] leading-relaxed text-pv-text">{persona.bio}</p>

      {persona.categoryFilter && persona.categoryFilter.length > 0 && (
        <div className="flex flex-wrap gap-1 font-mono text-[10px] uppercase tracking-[0.14em] text-pv-muted">
          {persona.categoryFilter.map((c) => (
            <span key={c} className="rounded-lg border border-pv-border/40 bg-white/70 px-1.5 py-0.5">{c}</span>
          ))}
        </div>
      )}

      <dl className="mt-auto grid grid-cols-3 gap-2 border-t border-pv-border/30 pt-3 text-center">
        <div>
          <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-pv-muted">balance</dt>
          <dd className="mt-0.5 font-display text-sm font-bold tabular-nums text-pv-text">
            {balanceMnt.toFixed(2)}
          </dd>
        </div>
        <div>
          <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-pv-muted">stakes</dt>
          <dd className={`mt-0.5 font-display text-sm font-bold tabular-nums ${active ? "text-pv-emerald" : "text-pv-text"}`}>
            {stakesPlaced}
          </dd>
        </div>
        <div>
          <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-pv-muted">at risk</dt>
          <dd className="mt-0.5 font-display text-sm font-bold tabular-nums text-pv-text">
            {totalStakedMnt.toFixed(2)}
          </dd>
        </div>
      </dl>

      {recentBets.length > 0 ? (
        <ul className="space-y-1.5 border-t border-pv-border/30 pt-3">
          {recentBets.map((b) => (
            <li key={b.txHash} className="flex items-baseline justify-between gap-2 font-mono text-[10px]">
              <Link href={`/vs/${b.claimId}`} className="text-pv-emerald hover:underline">
                claim #{b.claimId}
              </Link>
              <span className="tabular-nums text-pv-text/95">{b.stakeMnt.toFixed(2)} MNT</span>
              <a
                href={getExplorerTxUrl(b.txHash)}
                target="_blank"
                rel="noreferrer"
                className="text-pv-muted hover:text-pv-emerald"
              >
                tx ↗
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="border-t border-pv-border/30 pt-3 text-center font-mono text-[10px] italic text-pv-muted">
          no panel stakes recorded yet
        </p>
      )}

      <a
        href={getExplorerAddressUrl(address)}
        target="_blank"
        rel="noreferrer"
        className="text-center font-mono text-[10px] text-pv-muted hover:text-pv-emerald"
      >
        {shortAddr(address)} ↗
      </a>
    </article>
  );
}

function PanelBlueprintCard({
  persona,
  index,
}: {
  persona: PersonaSpec;
  index: number;
}) {
  return (
    <AnimatedItem delay={0.04 * index}>
      <article className={`flex h-full flex-col gap-4 rounded-xl border ${persona.accent.border} bg-white p-5 shadow-[0_18px_50px_-36px_rgba(38,112,220,0.36)] transition-[border-color,background-color,transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:bg-[#F4F9FF]`}>
        <header className="flex items-start gap-3">
          <span className={`flex h-11 w-11 items-center justify-center rounded-xl border ${persona.accent.border} ${persona.accent.bg} text-2xl leading-none grayscale`}>
            {persona.emoji}
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="font-display text-base font-bold tracking-tight text-pv-text">
              {persona.displayName}
            </h3>
            <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-pv-muted">
              {ARCHETYPE_LABEL[persona.archetype]}
            </p>
          </div>
        </header>
        <p className="text-[12px] leading-relaxed text-pv-text">{persona.bio}</p>
        {persona.categoryFilter && persona.categoryFilter.length > 0 ? (
          <div className="mt-auto flex flex-wrap gap-1 font-mono text-[10px] uppercase tracking-[0.14em] text-pv-muted">
            {persona.categoryFilter.map((category) => (
              <span key={category} className="rounded-lg border border-[#2670DC]/25 bg-[#F4F9FF] px-1.5 py-0.5">
                {category}
              </span>
            ))}
          </div>
        ) : (
          <p className="mt-auto rounded-lg border border-[#2670DC]/20 bg-[#F4F9FF] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-pv-muted">
            broad market coverage
          </p>
        )}
      </article>
    </AnimatedItem>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default async function PanelsPage() {
  const stats = await fetchPanelStats();

  const totalStakes       = stats.reduce((acc, s) => acc + s.stakesPlaced, 0);
  const totalStakedMnt   = stats.reduce((acc, s) => acc + s.totalStakedMnt, 0);
  const totalBankrollMnt = stats.reduce((acc, s) => acc + s.balanceMnt, 0);

  return (
    <main className="mx-auto max-w-[1200px] px-4 py-10 sm:px-6 lg:px-8">
      <PageTransition>
        <AnimatedItem>
      <header className="mb-10 space-y-1.5">
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-pv-emerald">
          Branium Panels
        </p>
        <h1 className="font-display text-3xl font-bold tracking-tight text-pv-text sm:text-4xl">
          Market panels for every claim.
        </h1>
        <p className="max-w-2xl text-sm text-pv-muted">
          Panels are distinct decision styles for reading the same claim, evidence,
          deadline, and stake pressure. Some are cautious, some follow imbalance,
          and some specialize by market category.
        </p>
        {stats.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 pt-2 font-mono text-[11px] uppercase tracking-[0.16em]">
            <span className="rounded-md border border-pv-border/40 bg-[#F4F9FF] px-2 py-1 text-pv-muted">
              {stats.length} active
            </span>
            <span className="rounded-md border border-pv-border/40 bg-[#F4F9FF] px-2 py-1 text-pv-muted">
              {totalStakes} stakes
            </span>
            <span className="rounded-md border border-pv-border/40 bg-[#F4F9FF] px-2 py-1 text-pv-muted">
              <span className="tabular-nums text-pv-text">{totalStakedMnt.toFixed(2)}</span> mnt at risk
            </span>
            <span className="rounded-md border border-pv-border/40 bg-[#F4F9FF] px-2 py-1 text-pv-muted">
              bankroll <span className="tabular-nums text-pv-text">{totalBankrollMnt.toFixed(2)}</span> mnt
            </span>
          </div>
        )}
      </header>
        </AnimatedItem>

      <section className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {stats.length > 0
          ? stats.map((s, index) => (
              <AnimatedItem key={s.persona.slug} delay={0.04 * index}>
                <PersonaCard stats={s} />
              </AnimatedItem>
            ))
          : PANEL_PERSONAS.map((persona, index) => (
              <PanelBlueprintCard key={persona.slug} persona={persona} index={index} />
            ))}
      </section>

      <AnimatedItem delay={0.1}>
      <nav className="mt-10 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm">
        <Link href="/agents" className="text-pv-muted transition-colors hover:text-pv-text">← all activity</Link>
        <Link href="/stats" className="text-pv-muted transition-colors hover:text-pv-text">aggregate stats →</Link>
      </nav>
      </AnimatedItem>
      </PageTransition>
    </main>
  );
}
