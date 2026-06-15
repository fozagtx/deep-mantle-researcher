/**
 * OpenRouter-only LLM call for Branium agents and server features.
 *
 * Required:
 *   - OPENROUTER_API_KEY
 *
 * Optional:
 *   - OPENROUTER_MODEL (defaults to google/gemini-2.5-flash)
 */

export type LLMProvider = "openrouter";

export interface CallLLMOptions {
  /** Max output tokens. Defaults to 1024. */
  maxTokens?: number;
  /** Sampling temperature 0-1. Defaults to 0.2. */
  temperature?: number;
  /** Ask OpenRouter for JSON object output. */
  jsonOnly?: boolean;
}

const DEFAULT_OPENROUTER_MODEL =
  process.env.OPENROUTER_MODEL?.trim() || "google/gemini-2.5-flash";
const QUOTA_COOLDOWN_MS = Number(process.env.LLM_QUOTA_COOLDOWN_MS ?? "300000");

let quotaCooldownUntil = 0;

function requireOpenRouterKey(): string {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  if (!key) {
    throw new Error("OPENROUTER_API_KEY env var is required");
  }
  return key;
}

function inQuotaCooldown(): number {
  const remaining = quotaCooldownUntil - Date.now();
  return remaining > 0 ? remaining : 0;
}

function tripQuotaCooldown(): void {
  quotaCooldownUntil = Date.now() + QUOTA_COOLDOWN_MS;
}

export function activeLLMProvider(): LLMProvider {
  requireOpenRouterKey();
  return "openrouter";
}

export function activeLLMModel(): string {
  return DEFAULT_OPENROUTER_MODEL;
}

/** Redacted fingerprint of the OpenRouter API key for startup logs. */
export function activeLLMKeyFingerprint(): string {
  const key = process.env.OPENROUTER_API_KEY?.trim() ?? "";
  if (!key) return "(missing)";
  return `...${key.slice(-6)} (len=${key.length})`;
}

export async function callLLM(prompt: string, opts: CallLLMOptions = {}): Promise<string> {
  const cooldown = inQuotaCooldown();
  if (cooldown > 0) {
    const secs = Math.ceil(cooldown / 1000);
    throw new Error(`OpenRouter quota cooldown: ${secs}s remaining`);
  }

  return callOpenRouter(prompt, {
    maxTokens: opts.maxTokens ?? 1024,
    temperature: opts.temperature ?? 0.2,
    jsonOnly: opts.jsonOnly ?? false,
  });
}

async function callOpenRouter(
  prompt: string,
  opts: { maxTokens: number; temperature: number; jsonOnly: boolean },
): Promise<string> {
  const apiKey = requireOpenRouterKey();
  const body: Record<string, unknown> = {
    model: activeLLMModel(),
    messages: [{ role: "user", content: prompt }],
    max_tokens: opts.maxTokens,
    temperature: opts.temperature,
  };
  if (opts.jsonOnly) body.response_format = { type: "json_object" };

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://branium.app",
      "X-OpenRouter-Title": "Branium",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    const text = (await res.text()).slice(0, 500);
    if (res.status === 429) tripQuotaCooldown();
    throw new Error(`OpenRouter ${res.status}: ${text}`);
  }

  const json: any = await res.json();
  const text = String(json?.choices?.[0]?.message?.content ?? "").trim();
  if (!text) {
    const reason = json?.choices?.[0]?.finish_reason ?? "unknown";
    throw new Error(`OpenRouter empty response (finishReason=${reason})`);
  }
  return text;
}
