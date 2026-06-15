import "server-only";

import { normalizeResolutionSource } from "@/lib/constants";
import {
  sanitizeModerationResult,
  type ClaimModerationDecision,
  type ClaimModerationResult,
  type ClaimModerationViolationCode,
  type ModerationPayload,
} from "@/lib/moderation/sanitize-moderation-result";
import { callLLM } from "@/lib/llm";

export type {
  ClaimModerationDecision,
  ClaimModerationViolationCode,
  ClaimModerationResult,
};
export { sanitizeModerationResult };

const LOCAL_BLOCK_PATTERNS: Array<{
  code: ClaimModerationViolationCode;
  re: RegExp;
}> = [
  // Death / self-harm (ES/EN light coverage)
  {
    code: "death_self_harm",
    re: /\b(suicid|suicidarse|autolesi|self[-\s]?harm|kill\s+myself)\b/i,
  },
  {
    code: "death_self_harm",
    re: /\b(morir|muere|muerte|asesin|mat[ao]n|killed|die|death|murder)\b/i,
  },
  // Violence / harm
  {
    code: "violence_harm",
    re: /\b(violaci|rape|raped|abuse|abus(?:o|ar)|golpear|disparar|shoot|stab|bomb|terror)\b/i,
  },
  // Doxxing / personal data
  {
    code: "doxxing_personal_data",
    re: /\b(doxx|doxxing|direcci[oó]n|domicilio|tel[eé]fono|dni|passport|ssn)\b/i,
  },
];

const POLICY_VERSION = "inline-v2";
const CLAIM_MODERATION_POLICY = `
## Branium claim moderation policy (v2)

Goal: prevent harmful, indecent, or abusive claim topics while allowing legitimate, verifiable markets.

### Core rule

Block claims that involve real-world harm, exploitation, targeted abuse, or privacy violations.

### Always block

- Death, suicide, self-harm, including "will X die/kill themself"
- Violence, physical harm, terrorism, threats
- Hate, harassment, targeted abuse, especially against protected classes
- Sexual content involving minors
- Non-consensual sexual content
- Illegal activity facilitation, including crime coordination, hacking, trafficking, etc.
- Personal data or doxxing, including addresses, phone numbers, IDs, private contact info

### Usually block

- Graphic harm content, gore, or explicit injury details
- Non-violent private-life speculation about identifiable private individuals
  - If the subject is a public figure and the outcome is verifiable from a public source, prefer allow.

### Allowed examples

- Sports results, weather outcomes, crypto/market thresholds, tech/product announcements, entertainment releases/awards
- Public-figure life events, such as marriage announcements, when verifiable from public sources and not exploitative

### Decision guidance

- If it clearly matches "Always block", block it.
- If ambiguous but potentially harmful or invasive, send it to review.
- Otherwise, allow it.
`.trim();

export type ClaimModerationInput = {
  question: string;
  creator_position: string;
  opponent_position: string;
  category: string;
  settlement_rule: string;
  resolution_url: string;
};

function buildPrompt(args: {
  policy: string;
  policyVersion: string;
  input: ClaimModerationInput;
}) {
  const normalizedSource = normalizeResolutionSource(args.input.resolution_url);

  return [
    "You are a safety and policy enforcement system for Branium, a stake-backed claim duel product.",
    "Classify the user's claim against the provided policy.",
    "Return ONLY valid JSON that matches the given JSON schema.",
    "Do not include any preamble, markdown, or explanation. The first character of your response must be '{'.",
    "",
    "Policy text (authoritative):",
    args.policy,
    "",
    "Policy version (for traceability):",
    args.policyVersion,
    "",
    "User-submitted claim (to moderate):",
    `- question: ${args.input.question}`,
    `- creator_position: ${args.input.creator_position}`,
    `- opponent_position: ${args.input.opponent_position}`,
    `- category: ${args.input.category}`,
    `- settlement_rule: ${args.input.settlement_rule}`,
    `- resolution_url: ${normalizedSource || args.input.resolution_url}`,
    "",
    "Decision rules:",
    "- If it clearly violates an Always block rule, decision must be block.",
    "- If it is ambiguous but could be harmful, decision should be review.",
    "- Otherwise, decision should be allow.",
    "- Do NOT over-block harmless, non-violent claims (e.g., public figure announcements like marriage or publicly announced pregnancy/birth) when they are settled from public sources.",
    "- violationCodes must be empty for allow.",
    "- If blocked or review, include 1-3 violationCodes that best match the issue.",
    "- Choose the most specific code available; use other_policy only if none fit.",
    "",
    "JSON shape:",
    `{"decision":"allow|review|block","violationCodes":[],"confidence":0}`,
  ].join("\n");
}

async function callModerationModel(prompt: string): Promise<ModerationPayload> {
  const text = await callLLM(prompt, {
    temperature: 0,
    maxTokens: 800,
    jsonOnly: true,
  });
  if (!text) {
    throw new Error("Moderation returned an empty response");
  }

  const tryParse = (raw: string) => {
    try {
      return JSON.parse(raw) as ModerationPayload;
    } catch {
      return null;
    }
  };

  const extractFirstJsonObject = (raw: string) => {
    const start = raw.indexOf("{");
    if (start < 0) return "";
    let depth = 0;
    for (let i = start; i < raw.length; i++) {
      const ch = raw[i];
      if (ch === "{") depth++;
      if (ch === "}") depth--;
      if (depth === 0) {
        return raw.slice(start, i + 1);
      }
    }
    return "";
  };

  // 1) Best case: it's pure JSON.
  const direct = tryParse(text);
  if (direct) return direct;

  // 2) Strip common markdown fences and retry.
  const unfenced = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  const unfencedParsed = tryParse(unfenced);
  if (unfencedParsed) return unfencedParsed;

  // 3) Extract the first JSON object substring.
  const firstObj = extractFirstJsonObject(unfenced).trim();
  if (firstObj) {
    const sliced = tryParse(firstObj);
    if (sliced) return sliced;
  }

  throw new Error(
    `Moderation returned non-JSON output. First 200 chars: ${unfenced.slice(0, 200)}`
  );
}

export async function moderateClaim(args: {
  input: ClaimModerationInput;
}): Promise<ClaimModerationResult> {
  const combinedText = [
    args.input.question,
    args.input.creator_position,
    args.input.opponent_position,
    args.input.settlement_rule,
  ]
    .join(" ")
    .trim();

  // Rules-first: block obvious disallowed topics without spending model quota.
  for (const pattern of LOCAL_BLOCK_PATTERNS) {
    if (pattern.re.test(combinedText)) {
      return {
        decision: "block",
        violationCodes: [pattern.code],
        confidence: 100,
        policyVersion: "local-rules:v1",
      };
    }
  }

  const prompt = buildPrompt({
    policy: CLAIM_MODERATION_POLICY,
    policyVersion: POLICY_VERSION,
    input: args.input,
  });
  const raw = await callModerationModel(prompt);
  return sanitizeModerationResult({ raw, policyVersion: POLICY_VERSION });
}
