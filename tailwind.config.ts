import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        pv: {
          bg:       "#F7F7F9",
          surface:  "#FFFFFF",
          surface2: "#F4F9FF",
          border:   "#D3E8FF",
          text:     "#002259",
          muted:    "#203A60",
          cyan:     "#2670DC",
          fuch:     "#0042AB",
          emerald:  "#2670DC",
          gold:     "#0DDE53",
          danger:   "#EF4444",
        },
      },
      fontFamily: {
        display: ["var(--font-display)", "Georgia", "serif"],
        body:    ["var(--font-body)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono:    ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      borderRadius: {
        DEFAULT: "8px",
        sm:    "4px",
        md:    "8px",
        lg:    "10px",
        xl:    "12px",
        "2xl": "14px",
        "3xl": "16px",
        "4xl": "20px",
        full:  "9999px",
      },
      boxShadow: {
        glow:           "inset -4px -4px 6px rgba(255,255,255,0.75), inset 4px 4px 6px rgba(255,255,255,0.75)",
        "glow-fuch":    "inset -4px -4px 6px rgba(255,255,255,0.75), inset 4px 4px 6px rgba(255,255,255,0.75)",
        "glow-emerald": "inset -4px -4px 6px rgba(235,243,255,0.75), inset 4px 4px 6px rgba(235,243,255,0.75)",
        "glow-gold":    "inset -2px -2px 4px rgba(235,243,255,0.75), inset 2px 2px 4px rgba(235,243,255,0.75)",
        "glow-lg":      "inset -6px -6px 10px rgba(255,255,255,0.78), inset 6px 6px 10px rgba(255,255,255,0.78)",
        "glow-fuch-lg": "inset -6px -6px 10px rgba(255,255,255,0.78), inset 6px 6px 10px rgba(255,255,255,0.78)",
        "glow-emerald-lg": "inset -6px -6px 10px rgba(235,243,255,0.78), inset 6px 6px 10px rgba(235,243,255,0.78)",
      },
      keyframes: {
        fadeUp: {
          from: { opacity: "0", transform: "translateY(18px)" },
          to:   { opacity: "1", transform: "translateY(0)" },
        },
        fadeIn: {
          from: { opacity: "0" },
          to:   { opacity: "1" },
        },
        stampIn: {
          "0%":   { opacity: "0", transform: "scale(2.5) rotate(-12deg)" },
          "50%":  { opacity: "1", transform: "scale(0.95) rotate(-12deg)" },
          "100%": { opacity: "1", transform: "scale(1) rotate(-12deg)" },
        },
        confDrop: {
          "0%":   { opacity: "1", transform: "translateY(0) rotate(0deg)" },
          "100%": { opacity: "0", transform: "translateY(100vh) rotate(600deg)" },
        },
        pulseGlow: {
          "0%, 100%": { boxShadow: "0 0 20px rgba(78,222,163,0.06)" },
          "50%":      { boxShadow: "0 0 50px rgba(78,222,163,0.18)" },
        },
        blink: {
          "0%, 100%": { opacity: "1" },
          "50%":      { opacity: "0" },
        },
        countRoll: {
          from: { opacity: "0", transform: "translateY(12px)" },
          to:   { opacity: "1", transform: "translateY(0)" },
        },
        shimmer: {
          "0%":   { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%":      { transform: "translateY(-6px)" },
        },
        "spin-slow": {
          to: { transform: "rotate(360deg)" },
        },
        /* ── Ritual system ── */
        fuseDecay: {
          "0%":   { backgroundPosition: "0% 50%" },
          "100%": { backgroundPosition: "200% 50%" },
        },
        phaseGlow: {
          "0%, 100%": { opacity: "0.4" },
          "50%":      { opacity: "1" },
        },
        tensionPulse: {
          "0%, 100%": { opacity: "0.2", transform: "scaleY(0.95)" },
          "50%":      { opacity: "0.6", transform: "scaleY(1)" },
        },
        sealFlash: {
          "0%":   { opacity: "0", transform: "scale(1.8) rotate(-8deg)" },
          "40%":  { opacity: "1", transform: "scale(0.96) rotate(-8deg)" },
          "100%": { opacity: "1", transform: "scale(1) rotate(-8deg)" },
        },
        tickDown: {
          "0%":   { opacity: "0", transform: "translateY(-8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-up":    "fadeUp 0.5s ease-out both",
        "fade-in":    "fadeIn 0.3s ease-out both",
        "stamp-in":   "stampIn 0.6s ease-out both",
        "conf-drop":  "confDrop 2s ease-in forwards",
        "pulse-glow": "pulseGlow 3s ease-in-out infinite",
        blink:        "blink 1s step-end infinite",
        "count-roll": "countRoll 0.4s ease-out both",
        shimmer:      "shimmer 2s linear infinite",
        float:        "float 3s ease-in-out infinite",
        "spin-slow":  "spin-slow 8s linear infinite",
        /* ── Ritual system ── */
        "fuse-decay":     "fuseDecay 2s linear infinite",
        "phase-glow":     "phaseGlow 2s ease-in-out infinite",
        "tension-pulse":  "tensionPulse 2.5s ease-in-out infinite",
        "seal-flash":     "sealFlash 0.55s ease-out both",
        "tick-down":      "tickDown 0.25s ease-out both",
      },
    },
  },
  plugins: [],
};

export default config;
