"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, useInView, useReducedMotion } from "framer-motion";
import {
  BadgeCheck,
  FilePenLine,
  Gavel,
  Megaphone,
  Vault,
  type LucideIcon,
} from "lucide-react";
import Plasma from "@/components/Plasma";
import { useTranslations } from "@/lib/copy";
import Link from "next/link";
import {
  getAllVSSnapshot,
  getVSSingleWinnerPayout,
  getVSTotalPot,
  hasVSWinner,
  isVSJoinable,
  type VSData,
} from "@/lib/contract";
import { ZERO_ADDRESS, shortenAddress } from "@/lib/constants";
import PageTransition, { AnimatedItem } from "@/components/PageTransition";
import { Button } from "@/components/ui";
import VSCard from "@/components/VSCard";
import ArenaCard from "@/components/ArenaCard";
import ArenaProposeCard from "@/components/ArenaProposeCard";
import SettlementArchiveSection from "@/components/SettlementArchiveSection";
import Artifact from "@/components/Artifact";
import LiveStat from "@/components/LiveStat";
import { kineticContainer, kineticLetter } from "@/lib/animations/rituals";

type ParsedStat = {
  prefix: string;
  unit: string; // e.g. "M" or "B"
  suffix: string; // e.g. "+" or "%"
  target: number;
  decimals: number;
};

type ProtocolStep = {
  Icon: LucideIcon;
  title: string;
  description: string;
  label: string;
  tone: string;
};

function parseStat(raw: string): ParsedStat | null {
  const trimmed = raw.trim();

  let prefix = "";
  let suffix = "";
  let unit = "";
  let working = trimmed;

  if (working.startsWith("$")) {
    prefix = "$";
    working = working.slice(1);
  }

  if (working.endsWith("%")) {
    suffix = "%";
    working = working.slice(0, -1);
  }

  const m = working.match(/^([0-9]+(?:\.[0-9]+)?)([MB])?(\+)?$/);
  if (!m) return null;

  const numStr = m[1];
  unit = m[2] ?? "";
  const matchSuffix = m[3] ?? "";
  suffix = suffix || matchSuffix;
  const decimals = numStr.includes(".") ? numStr.split(".")[1].length : 0;

  return {
    prefix,
    unit,
    suffix,
    target: Number.parseFloat(numStr),
    decimals,
  };
}

function formatStat(current: number, parsed: ParsedStat): string {
  const formattedNumber =
    parsed.decimals > 0 ? current.toFixed(parsed.decimals) : current.toFixed(0);

  return `${parsed.prefix}${formattedNumber}${parsed.unit}${parsed.suffix}`;
}

function AnimatedStatNumber({
  raw,
  delayMs,
}: {
  raw: string;
  delayMs: number;
}) {
  const parsed = useMemo(() => parseStat(raw), [raw]);
  const reducedMotion = useReducedMotion();

  const targetText = useMemo(
    () => (parsed ? formatStat(parsed.target, parsed) : raw),
    [parsed, raw]
  );
  const initialText = useMemo(
    () => (parsed ? formatStat(0, parsed) : raw),
    [parsed, raw]
  );

  const [display, setDisplay] = useState(initialText);
  const ref = useRef<HTMLSpanElement | null>(null);
  const startedRef = useRef(false);
  const isInView = useInView(ref, { once: true, amount: 0.05 });

  useEffect(() => {
    if (startedRef.current) return;

    if (!parsed) {
      startedRef.current = true;
      setDisplay(raw);
      return;
    }

    if (reducedMotion) {
      startedRef.current = true;
      setDisplay(targetText);
      return;
    }

    let rafId: number | null = null;
    let timeoutId: number | null = null;
    let fallbackTimeoutId: number | null = null;

    const startAnimation = () => {
      const from = 0;
      const to = parsed.target;
      const durationMs = 1700;
      const start = performance.now();

      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / durationMs);
        // Ease-out cubic for a professional, smooth feel.
        const eased = 1 - Math.pow(1 - t, 3);
        const current = from + (to - from) * eased;

        setDisplay(formatStat(current, parsed));

        if (t < 1) {
          rafId = requestAnimationFrame(tick);
        } else {
          setDisplay(targetText);
        }
      };

      rafId = requestAnimationFrame(tick);
    };

    const trigger = () => {
      if (startedRef.current) return;
      startedRef.current = true;
      timeoutId = window.setTimeout(startAnimation, delayMs);
    };

    // Ideal: iniciar en el momento exacto en que entra al viewport.
    if (isInView) {
      trigger();
      return () => {
        if (timeoutId) window.clearTimeout(timeoutId);
        if (rafId) window.cancelAnimationFrame(rafId);
      };
    }

    // Fallback mobile: en algunos casos con targets inline y header fijo,
    // IntersectionObserver puede tardar o no disparar con el umbral.
    const isMobile = window.matchMedia("(max-width: 639px)").matches;
    if (!isMobile) return;

    fallbackTimeoutId = window.setTimeout(() => {
      if (startedRef.current) return;
      const el = ref.current;
      if (!el) return;

      const rect = el.getBoundingClientRect();
      const within = rect.top < window.innerHeight * 1.05 && rect.bottom > 0;
      if (!within) return;

      trigger();
    }, delayMs + 250);

    return () => {
      if (timeoutId) window.clearTimeout(timeoutId);
      if (rafId) window.cancelAnimationFrame(rafId);
      if (fallbackTimeoutId) window.clearTimeout(fallbackTimeoutId);
    };
  }, [delayMs, isInView, parsed, raw, reducedMotion, targetText]);

  useEffect(() => {
    // If the stat text changes with fresh data, reset and allow replay once.
    startedRef.current = false;
    setDisplay(initialText);
  }, [initialText, raw]);

  return (
    <span ref={ref} aria-label={raw} className="inline-block">
      {display}
    </span>
  );
}

export default function HomePage() {
  const [allVS, setAllVS]     = useState<VSData[]>([]);
  const [loading, setLoading] = useState(true);
  const t  = useTranslations("home");
  const tStamp = useTranslations("stamp");

  const loadVS = useCallback(async ({ showPageLoading = false } = {}) => {
    if (showPageLoading) {
      setLoading(true);
    }

    try {
      const results = await getAllVSSnapshot();
      setAllVS(results.items);
    } catch (e) {
      console.error("Failed to load VS:", e);
      setAllVS([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadVS({ showPageLoading: true });
  }, [loadVS]);

  const openVS     = allVS.filter((v) => isVSJoinable(v));
  const resolvedVS = allVS.filter((v) => v.state === "resolved");
  const decidedResolvedVS = resolvedVS.filter((v) => hasVSWinner(v));
  const totalGenStaked = allVS.reduce((sum, vs) => sum + getVSTotalPot(vs), 0);

  const arenaGridCards = Array.from(
    new Map(
      [...openVS, ...allVS.filter((v) => v.state !== "open")].map((vs) => [vs.id, vs]),
    ).values(),
  )
    .slice(0, 5)
    .map((vs) => ({ vs, challengersCount: undefined as number | undefined }));

  const steps: ProtocolStep[] = [
    {
      Icon: FilePenLine,
      title: `1. ${t("stepChallenge").toUpperCase()}`,
      description:
        "Define the exact outcome, deadline, stake size, and source that will prove the result.",
      label: "Write",
      tone: "text-pv-fuch bg-[#D8E9FF]",
    },
    {
      Icon: Megaphone,
      title: `2. ${t("stepSend").toUpperCase()}`,
      description:
        "Share the claim with a rival or publish it to the arena so the other side can stake.",
      label: "Broadcast",
      tone: "text-pv-emerald bg-[#DFFFEA]",
    },
    {
      Icon: Vault,
      title: `3. ${t("stepAccept").toUpperCase()}`,
      description:
        "Creator and challenger stakes stay in the Mantle contract until the deadline passes.",
      label: "Lock",
      tone: "text-[#006DAA] bg-[#E6F7FF]",
    },
    {
      Icon: Gavel,
      title: `4. ${t("stepProven").toUpperCase()}`,
      description:
        "Branium evaluates the agreed source, calls the contract, and routes the MNT payout to the winner.",
      label: "Settle",
      tone: "text-[#00553A] bg-[#DDF6EC]",
    },
  ];

  return (
    <PageTransition>
      {/* Hero — Manifesto with kinetic typography + arena grid */}
      <AnimatedItem>
        <section className="relative mb-6 w-full sm:mb-8">
          {/* Plasma WebGL backdrop — full-viewport-bleed, escapes both <main> and the hero box */}
          <div className="absolute inset-y-0 left-1/2 z-0 h-full w-screen -translate-x-1/2 overflow-hidden">
            <Plasma color="#2670DC" speed={0.45} direction="pingpong" scale={1.08} opacity={0.72} mouseInteractive={false} />
            <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-pv-bg via-pv-bg/35 to-transparent sm:h-32" />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-pv-bg via-pv-bg/60 to-transparent sm:h-40" />
          </div>

          {/* Text panel — full-viewport hero so scrolling reveals the rest */}
          <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-[1200px] items-center justify-center px-4 sm:px-6 lg:px-8 pt-[env(safe-area-inset-top,0px)]">
            <div className="w-full max-w-[640px] pt-14 pb-28 sm:py-16 lg:py-20 text-center">
              {/* Headline — 3 lines, reduced size, payoff line smaller */}
              <motion.h1
                className="mb-6 flex flex-col gap-1 text-center font-display font-bold leading-[0.92] tracking-normal text-pv-text"
                variants={kineticContainer}
                initial="hidden"
                animate="visible"
              >
                <span className="block overflow-hidden text-[clamp(2.6rem,7vw,4.6rem)] lg:text-[clamp(3rem,4.4vw,5rem)]">
                  <motion.span variants={kineticLetter} className="inline-block whitespace-nowrap">
                    {t("emptyHeroTitleLine1Lead")}.
                  </motion.span>
                </span>
                <span className="block overflow-hidden text-[clamp(2.6rem,7vw,4.6rem)] lg:text-[clamp(3rem,4.4vw,5rem)]">
                  <motion.span variants={kineticLetter} className="inline-block whitespace-nowrap">
                    {t("emptyHeroTitleOnChainSegment")}.
                  </motion.span>
                </span>
                {/* Rhythmic pause */}
                <span className="block h-2 lg:h-3" aria-hidden />
                <span className="block overflow-hidden text-[clamp(2.7rem,7vw,4rem)] lg:text-[clamp(2.8rem,4.5vw,4.2rem)]">
                  <motion.span variants={kineticLetter} className="inline-block mr-[0.25em] font-medium text-pv-muted">
                    {t("emptyHeroTitleLine2Lead")}
                  </motion.span>
                  {" "}
                  <motion.span
                    variants={kineticLetter}
                    className="inline-block italic text-pv-emerald drop-shadow-[0_0_18px_rgba(13,222,83,0.35)]"
                  >
                    Mantle.
                  </motion.span>
                </span>
              </motion.h1>

              <motion.p
                className="mb-5 mx-auto max-w-[460px] text-[13px] leading-relaxed text-pv-muted/90 sm:text-sm lg:text-[15px] lg:leading-7"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5, duration: 0.5 }}
              >
                {t("emptyHeroSubtitle")}
              </motion.p>

              <motion.div
                className="flex flex-col gap-3 sm:flex-row sm:justify-center sm:gap-4"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.58, duration: 0.5 }}
              >
                {/* Secondary CTA — fuchsia neon */}
                <Link
                  href="/explorer"
                  className="group relative flex items-center justify-center overflow-hidden rounded-lg border border-pv-fuch/30 bg-transparent px-7 py-3.5 font-display text-[13px] font-bold uppercase tracking-[0.14em] text-pv-fuch/80 transition-all duration-300 hover:border-pv-fuch/60 hover:bg-pv-fuch/[0.1] hover:text-pv-fuch hover:shadow-[0_0_28px_-4px_rgba(38,112,220,0.32),inset_0_0_20px_-8px_rgba(38,112,220,0.12)]"
                >
                  <span className="absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100 bg-gradient-to-r from-pv-fuch/[0.1] via-transparent to-pv-fuch/[0.05]" />
                  <span className="relative">{t("heroExploreChallenges")}</span>
                </Link>

                {/* Primary CTA — cyan neon */}
                <Link
                  href="/vs/create"
                  className="group relative flex items-center justify-center overflow-hidden rounded-lg border border-pv-emerald/40 bg-pv-emerald/[0.08] px-7 py-3.5 font-display text-[13px] font-bold uppercase tracking-[0.14em] text-pv-emerald transition-all duration-300 hover:border-pv-emerald/70 hover:bg-pv-emerald/[0.15] hover:text-pv-text hover:shadow-[0_0_28px_-4px_rgba(13,222,83,0.35),inset_0_0_20px_-8px_rgba(13,222,83,0.12)]"
                >
                  <span className="absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100 bg-gradient-to-r from-pv-emerald/[0.12] via-transparent to-pv-emerald/[0.06]" />
                  <span className="relative">{t("heroChallengeSomeone")}</span>
                </Link>
              </motion.div>
            </div>
          </div>
        </section>
      </AnimatedItem>

      {/* Differentiator — stats strip (total / resolved / MNT staked); mismo patrón que THE PROTOCOL / LIVE ARENA */}
      <AnimatedItem>
        <div className="mb-12">
          <div className="mb-10 flex items-center gap-4 sm:gap-6">
            <h2 className="font-display text-2xl font-bold uppercase tracking-normal text-pv-text sm:text-3xl md:text-4xl">
              {t("statsSectionTitle")}
            </h2>
            <div className="h-px flex-1 bg-black/[0.12]" aria-hidden />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
            <div className="p-5 sm:p-6 text-center border border-black/[0.06] rounded-xl bg-pv-surface/30">
              <LiveStat
                value={allVS.length}
                label={t("totalClaims")}
                labelPosition="below"
                size="lg"
                color="emerald"
                  labelClassName="text-[12px]"
                className="items-center"
              />
            </div>
            <div className="p-5 sm:p-6 text-center border border-black/[0.06] rounded-xl bg-pv-surface/30">
              <LiveStat
                value={resolvedVS.length}
                label={t("resolvedClaims")}
                labelPosition="below"
                size="lg"
                color="emerald"
                  labelClassName="text-[12px]"
                className="items-center"
              />
            </div>
            <div className="p-5 sm:p-6 text-center border border-black/[0.06] rounded-xl bg-pv-surface/30">
              <LiveStat
                value={totalGenStaked}
                label={t("genStaked")}
                labelPosition="below"
                size="lg"
                color="gold"
                suffix="MNT"
                  labelClassName="text-[12px]"
                className="items-center"
              />
            </div>
          </div>
        </div>
      </AnimatedItem>

      {/* THE PROTOCOL — panels with oversized action icons */}
      <AnimatedItem>
        <div className="mb-12">
          <div className="mb-10 flex items-center gap-4 sm:gap-6">
            <h2 className="font-display text-2xl font-bold uppercase tracking-normal text-pv-text sm:text-3xl md:text-4xl">
              THE PROTOCOL
            </h2>
            <div className="h-px flex-1 bg-black/[0.12]" aria-hidden />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-4 md:auto-rows-[minmax(240px,auto)]">
            {steps.map(({ Icon, title, description, label, tone }, index) => {
              const stepLabel = `STEP ${String(index + 1).padStart(2, "0")}`;
              const isWide = index === 0 || index === 3;
              const cleanTitle = title.replace(/^\d+\.\s*/, "");

              return (
                <div
                  key={title}
                  className={`group relative col-span-1 overflow-hidden rounded-xl border border-black/[0.08] bg-[#EFF4F9]/85 p-6 shadow-glow transition-all duration-300 hover:-translate-y-1 hover:border-pv-fuch/30 hover:bg-white/90 sm:p-7 ${
                    index === 0
                      ? "md:col-span-2"
                      : index === 3
                        ? "md:col-span-4"
                        : "md:col-span-1"
                  }`}
                >
                  <div className={`flex h-full flex-col gap-6 ${isWide ? "md:grid md:grid-cols-[9.5rem,1fr] md:items-center" : ""}`}>
                    <div
                      className={`flex h-28 w-28 shrink-0 items-center justify-center rounded-xl border border-white/80 shadow-[inset_6px_6px_14px_rgba(0,34,89,0.08),inset_-6px_-6px_14px_rgba(255,255,255,0.85)] sm:h-32 sm:w-32 ${tone}`}
                      aria-hidden
                    >
                      <Icon className="h-20 w-20 sm:h-24 sm:w-24" strokeWidth={1.25} />
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col justify-between">
                      <div>
                        <div className="mb-3 flex items-center gap-2">
                          <span className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-pv-muted">
                            {stepLabel}
                          </span>
                          <span className="h-px flex-1 bg-black/[0.08]" aria-hidden />
                          <span className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-pv-fuch">
                            {label}
                          </span>
                        </div>
                        <h3 className="font-display text-2xl font-semibold leading-none tracking-normal text-pv-text sm:text-3xl">
                          {cleanTitle}
                        </h3>
                        <p className="mt-3 max-w-[46ch] text-sm leading-relaxed text-pv-muted sm:text-[15px]">
                          {description}
                        </p>
                      </div>
                      {index === 3 ? (
                        <div className="mt-6 flex items-center gap-2 text-pv-emerald">
                          <BadgeCheck className="h-5 w-5" strokeWidth={1.8} aria-hidden />
                          <span className="font-display text-lg font-semibold">On-chain</span>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </AnimatedItem>

      {/* LIVE ARENA — 3x2 grid of active challenges */}
      {arenaGridCards.length > 0 && (
        <AnimatedItem>
          <div className="mb-12">
            <div className="mb-10 flex items-center gap-4 sm:gap-6">
              <h2 className="font-display text-2xl font-bold uppercase tracking-normal text-pv-text sm:text-3xl md:text-4xl">
                LIVE ARENA
              </h2>
              <div className="h-px flex-1 bg-black/[0.12]" aria-hidden />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {arenaGridCards.map(({ vs, challengersCount }) => (
                <ArenaCard
                  key={vs.id}
                  vs={vs}
                  challengersCount={challengersCount}
                  archiveLabelShort={vs.id === -5}
                  hideClaimStrengthPill
                />
              ))}
              <ArenaProposeCard />
            </div>
          </div>
        </AnimatedItem>
      )}

      {/* THE ARCHIVE — settlement index + terminal (inspirado en “Archive / Odds” editorial) */}
      <AnimatedItem>
        <SettlementArchiveSection allVS={allVS} loading={loading} />
      </AnimatedItem>

      {/* Final claim CTA */}
      <AnimatedItem>
        <div className="mt-16 sm:mt-20 mb-12">
          <div className="group relative w-full overflow-hidden rounded-lg border border-black/[0.12] bg-white px-6 py-10 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)] backdrop-blur-xl sm:p-10 md:p-12 lg:p-14">
            <div
              className="pointer-events-none absolute inset-y-0 right-0 w-1/2 opacity-[0.14] transition-opacity duration-700 group-hover:opacity-[0.2]"
              aria-hidden
            >
              <div className="h-full w-full bg-gradient-to-l from-pv-emerald/40 via-pv-emerald/10 to-transparent" />
            </div>
            <div
              className="pointer-events-none absolute -right-20 top-1/2 h-72 w-72 -translate-y-1/2 rounded-full bg-pv-emerald/20 blur-3xl"
              aria-hidden
            />

            <div className="relative z-10 flex flex-col items-start gap-7 text-left sm:gap-8 md:flex-row md:items-end md:justify-between md:gap-10">
              <div className="max-w-xl">
                <div className="mb-4 flex items-center gap-3">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-pv-emerald opacity-40" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-pv-emerald" />
                  </span>
                  <span className="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-pv-muted">
                    Launch a claim
                  </span>
                </div>

                <h2 className="font-display text-[clamp(1.9rem,7vw,3.1rem)] font-bold leading-[0.95] tracking-normal text-pv-text">
                  MAKE A CLAIM <span className="text-pv-emerald">SETTLE ITSELF.</span>
                </h2>
                <p className="mt-4 max-w-[46ch] text-sm leading-relaxed text-pv-muted sm:text-base">
                  Set clean terms, stake MNT, and share the market. When the deadline passes, Branium checks the source and pays the winner from the contract.
                </p>
              </div>

              <div className="w-full md:w-auto">
                <Link href="/vs/create" className="block w-full md:w-auto">
                  <Button
                    variant="primary"
                    className="w-full md:w-auto px-8 font-display text-xs font-bold uppercase tracking-[0.2em]"
                  >
                    CREATE CLAIM
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </AnimatedItem>


      

      {/* Market Explorer preview — 2 cols en desktop */}
      {openVS.length > 0 && (
        <AnimatedItem>
          <div className="mb-10">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-pv-emerald shadow-[0_0_8px_rgba(216,95,95,0.6)]" />
                <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-pv-emerald">
                  {t("marketExplorerTeaser")}
                </span>
              </div>
              <span className="text-[11px] text-pv-muted">
                {t("waitingRival", { count: openVS.length })}
              </span>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
              {openVS.slice(0, 4).map((vs) => (
                <VSCard key={vs.id} vs={vs} />
              ))}
            </div>

            {openVS.length > 4 && (
              <Link
                href="/explorer"
                className="block w-full py-3.5 border border-pv-emerald/[0.24] bg-pv-emerald/[0.06] text-center font-display text-sm font-bold text-pv-emerald mt-2.5 hover:bg-pv-emerald/[0.1] transition-colors"
              >
                {t("viewAllOpen", { count: openVS.length })}
              </Link>
            )}
          </div>
        </AnimatedItem>
      )}

      {/* Proof Ledger — recently proven, terminal/document aesthetic */}
      {decidedResolvedVS.length > 0 && (
        <AnimatedItem>
          <Artifact serial="PV-LEDGER" watermark="BRANIUM" className="mt-4">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-1.5 h-1.5 rounded-full bg-pv-emerald shadow-[0_0_8px_rgba(216,95,95,0.6)]" />
              <span className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-pv-emerald">
                {t("recentlyProven")}
              </span>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-1.5">
              {decidedResolvedVS.slice(0, 4).map((vs) => {
                const payout = getVSSingleWinnerPayout(vs);
                const winnerLabel = tStamp("won", { address: shortenAddress(vs.winner) });

                return (
                <Link key={vs.id} href={`/vs/${vs.id}`} className="block group">
                  <motion.div
                    whileHover={{ x: 4 }}
                    className="flex items-center justify-between p-3 bg-black/[0.02] border border-black/[0.06] rounded group-hover:border-pv-emerald/[0.25] transition-colors"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="font-mono text-[10px] text-pv-muted/90 w-8 shrink-0">
                        #{vs.id}
                      </span>
                      <span className="w-1 h-1 rounded-full bg-pv-emerald shrink-0" />
                      <span className="font-mono text-[12px] truncate text-pv-text">
                        {winnerLabel}
                      </span>
                    </div>
                    <span className="font-mono text-[12px] font-bold text-pv-gold flex-shrink-0 ml-2">
                      {payout === null ? `${getVSTotalPot(vs)} MNT` : `+${payout} MNT`}
                    </span>
                  </motion.div>
                </Link>
                );
              })}
            </div>
          </Artifact>
        </AnimatedItem>
      )}
    </PageTransition>
  );
}
