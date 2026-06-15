"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { motion, AnimatePresence, LayoutGroup } from "framer-motion";
import { useTranslations } from "@/lib/copy";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWallet } from "@/lib/wallet";
import { shortenAddress } from "@/lib/constants";
import { getExplorerAddressUrl } from "@/lib/mantle";
import {
  BarChart3,
  Bot,
  Copy,
  ExternalLink,
  LayoutDashboard,
  LogOut,
  Menu,
  Plus,
  Swords,
  UsersRound,
  X,
  type LucideIcon,
} from "lucide-react";

type NavHref =
  | "/vs/create"
  | "/explorer"
  | "/dashboard"
  | "/stats"
  | "/agents"
  | "/panels";

type NavItem = {
  href: NavHref;
  label: string;
  accent: boolean;
  mobileLabel?: string;
};

const NAV_ICONS: Record<NavHref, LucideIcon> = {
  "/vs/create": Plus,
  "/explorer": Swords,
  "/dashboard": LayoutDashboard,
  "/panels": UsersRound,
  "/agents": Bot,
  "/stats": BarChart3,
};

function ConnectedSidebar({
  items,
  pathname,
  address,
  onDisconnect,
}: {
  items: NavItem[];
  pathname: string;
  address: string;
  onDisconnect: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const explorerHref = getExplorerAddressUrl(address);

  async function handleCopyAddress() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <aside className="pointer-events-none fixed bottom-4 left-3 top-[calc(env(safe-area-inset-top,0px)+0.75rem)] z-50 hidden md:block">
      <nav
        aria-label="Connected workspace navigation"
        className="pointer-events-auto flex h-full w-[6rem] flex-col items-center gap-2 overflow-y-auto rounded-2xl border border-[#2670DC]/35 bg-white/96 p-2 shadow-[0_18px_54px_-24px_rgba(38,112,220,0.48)] backdrop-blur-[18px]"
      >
        <Link
          href="/"
          aria-label="Branium home"
          className="mb-1 flex w-full flex-col items-center gap-1 rounded-xl border border-pv-emerald/[0.18] bg-pv-emerald/[0.055] px-2 py-3 text-pv-emerald"
        >
          <img
            src="/icons/branium-logo.svg"
            alt=""
            className="h-7 w-7 rounded-lg shadow-[0_10px_24px_-16px_rgba(38,112,220,0.75)]"
            aria-hidden
          />
          <span className="font-display text-sm font-bold tracking-normal">
            Branium<span className="text-pv-text">.</span>
          </span>
        </Link>

        {items.map((item) => {
          const Icon = NAV_ICONS[item.href];
          const isActive = pathname === item.href;
          const label = item.mobileLabel ?? item.label.replace(/^\+\s*/, "");
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              title={item.label}
              className={`group flex w-full flex-col items-center justify-center gap-1 rounded-xl border px-2 py-3 text-center transition-[background-color,border-color,color,transform] hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-emerald/35 focus-visible:ring-offset-2 focus-visible:ring-offset-white ${
                isActive
                  ? "border-pv-emerald/35 bg-pv-emerald/[0.1] text-pv-emerald"
                  : item.accent
                    ? "border-pv-emerald/[0.22] bg-pv-emerald/[0.055] text-pv-emerald hover:border-pv-emerald/35"
                    : "border-transparent text-pv-muted hover:border-black/[0.12] hover:bg-black/[0.035] hover:text-pv-text"
              }`}
            >
              <Icon className="h-5 w-5 shrink-0" strokeWidth={1.8} aria-hidden />
              <span className="max-w-full truncate font-mono text-[9px] font-bold uppercase tracking-[0.09em]">
                {label}
              </span>
            </Link>
          );
        })}

        <div className="mt-auto flex w-full flex-col gap-1.5 rounded-xl border border-black/[0.08] bg-black/[0.03] p-1.5">
          <div className="truncate rounded-lg bg-white/55 px-2 py-2 text-center font-mono text-[10px] font-bold text-pv-emerald">
            {shortenAddress(address)}
          </div>
          <div className="grid grid-cols-3 gap-1">
            <button
              type="button"
              onClick={handleCopyAddress}
              title={copied ? "Copied" : "Copy address"}
              aria-label={copied ? "Address copied" : "Copy address"}
              className="flex h-8 items-center justify-center rounded-lg text-pv-muted transition-colors hover:bg-white/70 hover:text-pv-emerald"
            >
              <Copy className="h-4 w-4" aria-hidden />
            </button>
            <a
              href={explorerHref}
              target="_blank"
              rel="noreferrer"
              title="View on explorer"
              aria-label="View wallet on explorer"
              className="flex h-8 items-center justify-center rounded-lg text-pv-muted transition-colors hover:bg-white/70 hover:text-pv-emerald"
            >
              <ExternalLink className="h-4 w-4" aria-hidden />
            </a>
            <button
              type="button"
              onClick={onDisconnect}
              title="Disconnect"
              aria-label="Disconnect wallet"
              className="flex h-8 items-center justify-center rounded-lg text-pv-muted transition-colors hover:bg-white/70 hover:text-pv-text"
            >
              <LogOut className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </div>
      </nav>
    </aside>
  );
}

function WalletAccountMenu({
  address,
  open,
  onOpenChange,
  onDisconnect,
  containerRef,
  buttonClassName,
}: {
  address: string;
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onDisconnect: () => void;
  containerRef: React.MutableRefObject<HTMLDivElement | null>;
  buttonClassName: string;
}) {
  const t = useTranslations("header");
  const [copied, setCopied] = useState(false);
  const explorerHref = getExplorerAddressUrl(address);

  const actionItemClass =
    "group flex w-full items-center gap-3 rounded-xl border border-transparent px-3.5 py-3 text-left text-[13px] font-medium text-pv-text transition-[background-color,border-color,color,transform] hover:border-pv-emerald/20 hover:bg-pv-emerald/[0.07] hover:text-pv-text";
  const iconClass =
    "h-4 w-4 shrink-0 text-pv-muted transition-colors group-hover:text-pv-emerald";

  async function handleCopyAddress() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={t("walletMenu")}
        className={buttonClassName}
      >
        {shortenAddress(address)}
      </button>
      <AnimatePresence>
        {open ? (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-[calc(100%+4px)] z-[60] min-w-[240px] overflow-hidden rounded-2xl border border-pv-border/40 bg-pv-surface/95 p-2 shadow-[0_22px_60px_-20px_rgba(216,95,95,0.22)] backdrop-blur-xl"
          >
            <div className="mb-1 rounded-xl border border-black/[0.08] bg-black/[0.03] px-3.5 py-3">
              <p className="font-display text-[13px] font-bold tracking-tight text-pv-text">
                {shortenAddress(address)}
              </p>
              <p className="mt-1 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-pv-muted">
                {t("connectedWallet")}
              </p>
            </div>

            <button
              type="button"
              role="menuitem"
              onClick={handleCopyAddress}
              className={actionItemClass}
            >
              <Copy className={iconClass} aria-hidden />
              <span>{copied ? t("copiedAddress") : t("copyAddress")}</span>
            </button>
            <a
              href={explorerHref}
              target="_blank"
              rel="noreferrer"
              role="menuitem"
              onClick={() => onOpenChange(false)}
              className={`${actionItemClass} mt-1`}
            >
              <ExternalLink className={iconClass} aria-hidden />
              <span>{t("viewOnExplorer")}</span>
            </a>
            <div className="my-2 h-px bg-black/[0.08]" aria-hidden />
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onDisconnect();
                onOpenChange(false);
              }}
              className="group flex w-full items-center gap-3 rounded-xl border border-transparent px-3.5 py-3 text-left text-[13px] font-medium text-pv-muted transition-[background-color,border-color,color] hover:border-black/[0.08] hover:bg-black/[0.04] hover:text-pv-text"
            >
              <LogOut
                className="h-4 w-4 shrink-0 text-pv-muted transition-colors group-hover:text-pv-text"
                aria-hidden
              />
              <span>{t("disconnect")}</span>
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

export default function Header() {
  const { address, isConnected, isConnecting, connect, disconnect } = useWallet();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [walletMenuOpen, setWalletMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const walletMenuDesktopRef = useRef<HTMLDivElement>(null);
  const walletMenuMobileRef = useRef<HTMLDivElement>(null);

  // Track scroll position so the floating header can gain a touch more
  // contrast once content starts moving underneath it.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const t = useTranslations("header");
  const tc = useTranslations("common");

  const isPresentationHome = pathname === "/";
  const showConnectedShell = !isPresentationHome && isConnected && Boolean(address);

  const NAV_ITEMS = useMemo<NavItem[]>(() => {
    return [
      { href: "/vs/create", label: t("challenge"), accent: true },
      { href: "/explorer", label: t("explore"), accent: false },
      { href: "/dashboard", label: t("myVS"), accent: false },
      { href: "/panels", label: "Panels", accent: false },
      { href: "/agents", label: "Activity", accent: false },
      { href: "/stats", label: "Stats", accent: false },
    ];
  }, [t]);

  useEffect(() => {
    document.body.classList.toggle("branium-sidebar-active", showConnectedShell);
    return () => document.body.classList.remove("branium-sidebar-active");
  }, [showConnectedShell]);

  useEffect(() => {
    if (!walletMenuOpen) return;
    const onDoc = (e: MouseEvent) => {
      const el = e.target as Node;
      if (
        walletMenuDesktopRef.current?.contains(el) ||
        walletMenuMobileRef.current?.contains(el)
      ) {
        return;
      }
      setWalletMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [walletMenuOpen]);

  useEffect(() => {
    if (!walletMenuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setWalletMenuOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [walletMenuOpen]);

  return (
    <>
      {showConnectedShell ? (
        <ConnectedSidebar
          items={NAV_ITEMS}
          pathname={pathname}
          address={address as string}
          onDisconnect={disconnect}
        />
      ) : null}
      <header className={`pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top,0px)+0.75rem)] z-50 px-3 sm:px-4 ${showConnectedShell ? "md:hidden" : ""}`}>
      <div
        className={`pointer-events-auto mx-auto flex h-14 max-w-[1100px] items-center justify-between rounded-2xl border px-4 backdrop-blur-[18px] transition-[background-color,border-color,box-shadow,transform] duration-300 ease-out sm:px-6 ${
          scrolled || mobileOpen
            ? "border-[#2670DC]/40 bg-white/96 shadow-[0_18px_54px_-24px_rgba(38,112,220,0.48)]"
            : "border-[#2670DC]/32 bg-white/94 shadow-[0_16px_46px_-28px_rgba(38,112,220,0.42)]"
        }`}
      >
        <Link href="/" className="flex items-center gap-2.5">
          <img
            src="/icons/branium-logo.svg"
            alt=""
            className="h-7 w-7 rounded-lg shadow-[0_10px_24px_-16px_rgba(38,112,220,0.75)]"
            aria-hidden
          />
          <span className="group font-display text-lg font-bold tracking-normal text-pv-emerald transition-colors duration-300 ease-in-out sm:text-xl">
            Branium
            <span
              className="ml-[1px] inline-block origin-center leading-none text-pv-text transition-[color,transform] duration-300 ease-out will-change-transform group-hover:scale-[1.22] group-hover:-rotate-6 group-hover:text-pv-emerald"
              aria-hidden
            >
              .
            </span>
          </span>
        </Link>

        {isPresentationHome ? (
          <div className="flex items-center">
            <Link
              href="/explorer"
              className="btn-compact-primary px-4 py-1.5 text-[12px] focus-ring sm:text-[13px]"
            >
              {t("launchApp")}
            </Link>
          </div>
        ) : (
          <>
            {/* Desktop controls */}
            <div className="hidden items-center gap-2 md:flex lg:gap-3">
              {!showConnectedShell
                ? NAV_ITEMS.map((item) => {
                    const isActive = pathname === item.href;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={`chip relative text-[13px] transition-all ${
                          item.accent
                            ? "border-pv-emerald/[0.28] bg-pv-emerald/[0.08] text-pv-emerald"
                            : isActive
                              ? "border-black/[0.32] bg-black/[0.06] text-pv-text"
                              : "text-pv-muted hover:border-black/[0.22] hover:text-pv-text"
                        }`}
                      >
                        {item.label}
                      </Link>
                    );
                  })
                : null}

              {isConnected && address ? (
                <WalletAccountMenu
                  address={address}
                  open={walletMenuOpen}
                  onOpenChange={setWalletMenuOpen}
                  onDisconnect={disconnect}
                  containerRef={walletMenuDesktopRef}
                  buttonClassName="chip font-mono text-[11px] text-pv-emerald border-pv-emerald/[0.25] focus-ring"
                />
              ) : (
                <button
                  type="button"
                  onClick={connect}
                  disabled={isConnecting}
                  className="btn-compact-primary px-4 py-1.5 text-[13px] focus-ring"
                >
                  {isConnecting ? "..." : tc("connect")}
                </button>
              )}
            </div>

            {/* Mobile */}
            <div className="flex items-center gap-2 md:hidden">
              {isConnected && address ? (
                <WalletAccountMenu
                  address={address}
                  open={walletMenuOpen}
                  onOpenChange={setWalletMenuOpen}
                  onDisconnect={disconnect}
                  containerRef={walletMenuMobileRef}
                  buttonClassName="chip font-mono text-[10px] text-pv-emerald border-pv-emerald/[0.25]"
                />
              ) : (
                <button
                  type="button"
                  onClick={connect}
                  disabled={isConnecting}
                  className="btn-compact-primary px-3 py-1.5 text-[12px]"
                >
                  {isConnecting ? "..." : tc("connect")}
                </button>
              )}
              <button
                type="button"
                onClick={() => setMobileOpen(!mobileOpen)}
                className="rounded p-1.5 text-pv-muted transition-colors hover:text-pv-text"
                aria-expanded={mobileOpen}
                aria-label={mobileOpen ? t("closeMenu") : t("openMenu")}
              >
                {mobileOpen ? <X size={20} /> : <Menu size={20} />}
              </button>
            </div>
          </>
        )}
      </div>

      {/* Mobile sheet */}
      <AnimatePresence>
        {!isPresentationHome && mobileOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="pointer-events-auto mx-auto mt-2 max-w-[1100px] overflow-hidden rounded-2xl border border-pv-border/45 bg-white/90 shadow-[0_22px_60px_-30px_rgba(0,34,89,0.34)] backdrop-blur-xl md:hidden"
          >
            <LayoutGroup id="mobile-header-nav">
              <nav
                className="flex flex-col gap-0.5 px-5 py-3"
                aria-label={t("mobileNavAria")}
              >
                {NAV_ITEMS.map((item) => {
                  const isActive = pathname === item.href;
                  const label = item.accent
                    ? t("challengeMobile")
                    : item.mobileLabel ?? item.label;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMobileOpen(false)}
                      aria-current={isActive ? "page" : undefined}
                      className={`relative block overflow-hidden rounded-lg px-4 py-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-emerald/35 focus-visible:ring-offset-2 focus-visible:ring-offset-pv-bg ${
                        isActive
                          ? "text-pv-text"
                          : "text-pv-muted hover:text-pv-text"
                      }`}
                    >
                      {isActive ? (
                        <motion.span
                          layoutId="mobile-nav-active-highlight"
                          className="absolute inset-0 rounded-lg border border-pv-emerald/[0.28] bg-pv-emerald/[0.1]"
                          transition={{ type: "spring", stiffness: 420, damping: 34 }}
                          initial={false}
                        />
                      ) : null}
                      <span className="relative z-10">{label}</span>
                    </Link>
                  );
                })}
              </nav>
            </LayoutGroup>
          </motion.div>
        )}
      </AnimatePresence>
      </header>
    </>
  );
}
