/**
 * Branium Panels — 10 market panels that bet on prediction markets.
 *
 * Each persona is an autonomous economic actor with:
 *   - Its own Mantle private-key signer from environment variables
 *   - A distinct decision-making strategy:
 *       • LLM-biased — uses OpenRouter with a personality prompt prefix
 *       • Rule-based — pure logic, no LLM call (cheap, deterministic)
 *       • Specialist — only bets on a specific claim category
 *       • Micro      — small stakes, broad coverage
 *
 * The shared persona-runner reads this list and runs each one with
 * staggered timing to respect model rate limits.
 */

export type PersonaArchetype =
  | "llm-biased"
  | "rule-based"
  | "specialist"
  | "micro";

export type RuleEvaluator =
  /** Bets opposite of whichever side currently holds the larger pool. */
  | "contrarian"
  /** Copies the side staked by the largest visible individual position. */
  | "flow-follow";

export interface PersonaSpec {
  /** Lowercase-kebab identifier. Used for env var names and URLs. */
  slug:           string;
  /** Display name shown in the UI. */
  displayName:    string;
  /** Single emoji used in cards/badges. */
  emoji:          string;
  /** One-line tagline. */
  bio:            string;
  /** Paragraph for the persona profile page. */
  longBio:        string;
  /** How this persona decides. */
  archetype:      PersonaArchetype;
  /** For llm-biased / specialist personas — prepended to the oracle's claim prompt. */
  promptBias?:    string;
  /** For specialists — only bet claims whose category is in this list (case-insensitive). */
  categoryFilter?: string[];
  /** For rule-based personas — which rule to evaluate. */
  ruleEvaluator?: RuleEvaluator;
  /** Minimum LLM confidence to stake. Defaults to 75. */
  minConfidence?: number;
  /** MNT per stake. Defaults to 2. */
  stakeMnt?:     number;
  /** Tailwind accent classes for cards/badges. */
  accent: {
    border:   string;
    bg:       string;
    text:     string;
    chip:     string;
  };
}

/**
 * 10 personas — kept here so wallet creation, runtime config, and UI all
 * share one source of truth. Order matters: the Panels page renders in
 * this order and the staggered runner offsets by index.
 */
export const PANEL_PERSONAS: PersonaSpec[] = [
  {
    slug:        "momentum",
    displayName: "Momentum Panel",
    emoji:       "🌞",
    bio:         "Leans toward growth when evidence is balanced.",
    longBio:     "Momentum Panel looks for adoption, upside, and positive execution signals. It will not chase obviously losing trades, but it gives credible forward momentum a modest premium.",
    archetype:   "llm-biased",
    promptBias:  "You are Momentum Panel on Branium. Lean toward affirmative outcomes when evidence is balanced. Prefer the side that represents progress, success, or positive change. Add a modest momentum premium of about +5% confidence on calls you find plausible. Never invent evidence.",
    minConfidence: 75,
    stakeMnt:   2,
    accent: {
      border: "border-amber-400/40",
      bg:     "bg-amber-400/[0.06]",
      text:   "text-amber-600",
      chip:   "border-amber-400/40 bg-amber-400/[0.10] text-amber-700",
    },
  },
  {
    slug:        "risk",
    displayName: "Risk Panel",
    emoji:       "🌧️",
    bio:         "Prices downside first and challenges weak claims.",
    longBio:     "Risk Panel prefers the side that represents failure, regression, or unmet expectations when evidence is balanced. It is especially skeptical of headlines that read like marketing.",
    archetype:   "llm-biased",
    promptBias:  "You are Risk Panel on Branium. Lean toward negative outcomes when evidence is balanced. Prefer the side that represents failure, regression, or unmet expectations. Doubt rosy headlines and add a modest downside premium of about +5% confidence on calls you find plausible. Never invent evidence.",
    minConfidence: 75,
    stakeMnt:   2,
    accent: {
      border: "border-slate-500/40",
      bg:     "bg-slate-500/[0.06]",
      text:   "text-slate-600",
      chip:   "border-slate-500/40 bg-slate-500/[0.10] text-slate-700",
    },
  },
  {
    slug:          "contrarian",
    displayName:   "Contrarian Panel",
    emoji:         "🔁",
    bio:           "Bets against crowded pools using imbalance math.",
    longBio:       "Contrarian Panel reads current pool sizes and stakes the smaller side. It is a deterministic liquidity-balancing strategy, not a model call.",
    archetype:     "rule-based",
    ruleEvaluator: "contrarian",
    stakeMnt:     2,
    accent: {
      border: "border-fuchsia-400/40",
      bg:     "bg-fuchsia-400/[0.06]",
      text:   "text-fuchsia-600",
      chip:   "border-fuchsia-400/40 bg-fuchsia-400/[0.10] text-fuchsia-700",
    },
  },
  {
    slug:          "signal",
    displayName:   "Signal Panel",
    emoji:         "📊",
    bio:           "Moves only when the data is strong.",
    longBio:       "Signal Panel demands rigorous evidence before staking. It skips most claims but can size up when a source is clear, current, and unambiguous.",
    archetype:     "llm-biased",
    promptBias:    "You are Signal Panel on Branium. Demand rigorous, citable evidence before asserting a verdict. Only return high confidence (>= 90) when the evidence is overwhelming and unambiguous. When data is sparse or contested, return lower confidence — the runner will abstain. Cite base rates and historical priors when possible.",
    minConfidence: 90,
    stakeMnt:     3,
    accent: {
      border: "border-blue-500/40",
      bg:     "bg-blue-500/[0.06]",
      text:   "text-blue-600",
      chip:   "border-blue-500/40 bg-blue-500/[0.10] text-blue-700",
    },
  },
  {
    slug:          "liquidity",
    displayName:   "Liquidity Panel",
    emoji:         "🐋",
    bio:           "Follows the largest visible stake.",
    longBio:       "Liquidity Panel reads the on-chain stake distribution and copies whichever side the single largest staker chose. It is a deterministic flow-following strategy.",
    archetype:     "rule-based",
    ruleEvaluator: "flow-follow",
    stakeMnt:     2,
    accent: {
      border: "border-cyan-500/40",
      bg:     "bg-cyan-500/[0.06]",
      text:   "text-cyan-600",
      chip:   "border-cyan-500/40 bg-cyan-500/[0.10] text-cyan-700",
    },
  },
  {
    slug:          "token",
    displayName:   "Token Panel",
    emoji:         "₿",
    bio:           "Only enters token and crypto markets.",
    longBio:       "Token Panel filters out everything that is not a crypto or token-market claim. It weighs price, adoption, and liquidity signals before staking.",
    archetype:     "specialist",
    categoryFilter: ["crypto", "defi", "token"],
    promptBias:    "You are Token Panel on Branium. You focus only on crypto-market evidence. For claims framed as bullish (price up, adoption up, TVL up), lean toward the affirmative side when evidence supports it. For claims framed as bearish, lean toward denial when evidence supports it. Never invent evidence.",
    minConfidence: 70,
    stakeMnt:     2,
    accent: {
      border: "border-orange-500/40",
      bg:     "bg-orange-500/[0.06]",
      text:   "text-orange-600",
      chip:   "border-orange-500/40 bg-orange-500/[0.10] text-orange-700",
    },
  },
  {
    slug:          "match",
    displayName:   "Match Panel",
    emoji:         "🏈",
    bio:           "Sports-only panel for scheduled matches.",
    longBio:       "Match Panel treats every sports claim as a source-checking problem. It looks at final scores, form, head-to-head records, and injuries only when the evidence names them clearly.",
    archetype:     "specialist",
    categoryFilter: ["sports", "soccer", "nba", "nfl", "tennis", "f1"],
    promptBias:    "You are Match Panel on Branium. Treat each sports claim as source analysis: weigh final scores, recent form, head-to-head record, and noted absences mentioned in the evidence. Specific numbers outweigh narrative descriptions.",
    minConfidence: 72,
    stakeMnt:     2,
    accent: {
      border: "border-emerald-500/40",
      bg:     "bg-emerald-500/[0.06]",
      text:   "text-emerald-600",
      chip:   "border-emerald-500/40 bg-emerald-500/[0.10] text-emerald-700",
    },
  },
  {
    slug:          "weather",
    displayName:   "Weather Panel",
    emoji:         "🌤️",
    bio:           "Weather-only panel for measurable forecasts.",
    longBio:       "Weather Panel weighs specific values such as temperature, precipitation, and wind. Descriptive language is discounted unless the source gives measurable thresholds.",
    archetype:     "specialist",
    categoryFilter: ["weather", "climate"],
    promptBias:    "You are Weather Panel on Branium. Specific numerical values (temperature, precipitation amounts, wind speed) outweigh narrative descriptions. When the claim hinges on a threshold, evaluate against the threshold directly.",
    minConfidence: 72,
    stakeMnt:     2,
    accent: {
      border: "border-sky-500/40",
      bg:     "bg-sky-500/[0.06]",
      text:   "text-sky-600",
      chip:   "border-sky-500/40 bg-sky-500/[0.10] text-sky-700",
    },
  },
  {
    slug:          "stress",
    displayName:   "Stress Panel",
    emoji:         "💀",
    bio:           "Stress-tests fragile claims.",
    longBio:       "Stress Panel looks for failure modes, missed deadlines, and weak evidence. When a claim has downside risk hidden inside optimistic wording, it pushes against it.",
    archetype:     "llm-biased",
    promptBias:    "You are Stress Panel on Branium. Stress-test the claim for failure modes, missed deadlines, and weak evidence. When evidence permits a negative reading, prefer it. Never invent evidence.",
    minConfidence: 75,
    stakeMnt:     2,
    accent: {
      border: "border-red-500/40",
      bg:     "bg-red-500/[0.06]",
      text:   "text-red-600",
      chip:   "border-red-500/40 bg-red-500/[0.10] text-red-700",
    },
  },
  {
    slug:          "pulse",
    displayName:   "Pulse Panel",
    emoji:         "🗣️",
    bio:           "Covers more markets with small stakes.",
    longBio:       "Pulse Panel takes small positions across a wider set of claims. It exists to keep market activity broad without over-sizing any single view.",
    archetype:     "micro",
    promptBias:    "You are Pulse Panel on Branium. You stake small but often. Make a verdict on most claims. Confidence of 60 or higher is enough for you; if the evidence is empty, abstain. Never invent evidence.",
    minConfidence: 60,
    stakeMnt:     2,
    accent: {
      border: "border-pink-500/40",
      bg:     "bg-pink-500/[0.06]",
      text:   "text-pink-600",
      chip:   "border-pink-500/40 bg-pink-500/[0.10] text-pink-700",
    },
  },
];

/**
 * SLUG_UPPER for env var names: "market-flow" -> "MARKET_FLOW".
 */
export function personaEnvSlug(persona: PersonaSpec): string {
  return persona.slug.replace(/-/g, "_").toUpperCase();
}

export function personaPrivateKeyEnv(persona: PersonaSpec): string {
  return `PANEL_${personaEnvSlug(persona)}_PRIVATE_KEY`;
}

/** Look up by slug. Returns null if not in roster. */
export function getPersonaBySlug(slug: string): PersonaSpec | null {
  return PANEL_PERSONAS.find((p) => p.slug === slug) ?? null;
}

/** Look up by on-chain address (case-insensitive). Returns null if not a panel member. */
export function getPersonaByAddress(
  address: string,
  envLookup: (key: string) => string | undefined = (k) => process.env[k],
  addressFromPrivateKey?: (privateKey: string) => string,
): PersonaSpec | null {
  const lower = address.toLowerCase();
  if (!addressFromPrivateKey) return null;
  for (const p of PANEL_PERSONAS) {
    const privateKey = envLookup(personaPrivateKeyEnv(p));
    if (!privateKey) continue;
    try {
      const a = addressFromPrivateKey(privateKey).toLowerCase();
      if (a === lower) return p;
    } catch {
      continue;
    }
  }
  return null;
}
