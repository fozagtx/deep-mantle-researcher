"use client";

import { useEffect } from "react";

type Props = {
  error: Error & { digest?: string };
  reset: () => void;
};

const COPY = {
  eyebrow: "Recovered safely",
  title: "This page hit a snag.",
  body: "Branium kept the rest of the app alive. Try the request again or head back to the arena.",
  retry: "Try again",
  home: "Back home",
} as const;

export default function AppError({ error, reset }: Props) {
  useEffect(() => {
    console.error("Route error", error);
  }, [error]);

  return (
    <section className="min-h-[60vh] flex items-center justify-center">
      <div className="w-full max-w-2xl rounded-3xl border border-black/[0.08] bg-white p-8 sm:p-10 text-center shadow-[0_24px_80px_rgba(0,0,0,0.35)]">
        <p className="text-xs uppercase tracking-[0.35em] text-pv-emerald/85 font-bold">
          {COPY.eyebrow}
        </p>
        <h1 className="mt-4 font-display text-4xl sm:text-5xl font-bold tracking-tight text-pv-text">
          {COPY.title}
        </h1>
        <p className="mt-4 text-sm sm:text-base text-pv-muted max-w-xl mx-auto">
          {COPY.body}
        </p>
        <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
          <button
            onClick={reset}
            className="w-full sm:w-auto px-5 py-3 rounded-xl bg-pv-emerald text-pv-bg font-bold hover:brightness-110 transition-all focus-ring"
          >
            {COPY.retry}
          </button>
          <a
            href="/"
            className="w-full sm:w-auto px-5 py-3 rounded-xl border border-black/[0.12] text-pv-text hover:border-black/[0.2] hover:bg-black/[0.04] transition-all focus-ring"
          >
            {COPY.home}
          </a>
        </div>
      </div>
    </section>
  );
}
