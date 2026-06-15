/**
 * Server-side helpers for resolving on-chain addresses to panel personas.
 *
 * Pages like /agents, /stats, /panels, and /vs/[id] need to map a raw
 * address to a persona spec (emoji, displayName, accent colors) so the UI
 * can show a panel label instead of "0x3e5e…ffac".
 *
 * Lookups are address-keyed and case-insensitive. The map is built once
 * per process from the persona signer env vars.
 */

import "server-only";
import {
  PANEL_PERSONAS,
  personaPrivateKeyEnv,
  type PersonaSpec,
} from "../agents/panels/personas";
import { getAddressFromPrivateKey } from "./mantle-agent";

export type ActorKind =
  | { kind: "oracle"; address: string }
  | { kind: "market-creator"; address: string }
  | { kind: "panel"; address: string; persona: PersonaSpec }
  | { kind: "human"; address: string };

let cachedPersonaByAddress: Map<string, PersonaSpec> | null = null;

function buildPersonaIndex(): Map<string, PersonaSpec> {
  const map = new Map<string, PersonaSpec>();
  for (const p of PANEL_PERSONAS) {
    const privateKey = process.env[personaPrivateKeyEnv(p)]?.trim();
    if (!privateKey) continue;
    try {
      map.set(getAddressFromPrivateKey(privateKey).toLowerCase(), p);
    } catch {
      continue;
    }
  }
  return map;
}

export function getPanelPersonaIndex(): Map<string, PersonaSpec> {
  if (!cachedPersonaByAddress) {
    cachedPersonaByAddress = buildPersonaIndex();
  }
  return cachedPersonaByAddress;
}

/**
 * Returns every persona whose signer env var is wired in the current
 * deploy. Used by /panels to render persona cards even when a persona
 * has zero on-chain activity yet.
 */
export function getActivePanelPersonas(): Array<{
  persona: PersonaSpec;
  address: string;
}> {
  const out: Array<{ persona: PersonaSpec; address: string }> = [];
  for (const p of PANEL_PERSONAS) {
    const privateKey = process.env[personaPrivateKeyEnv(p)]?.trim();
    if (!privateKey) continue;
    try {
      out.push({ persona: p, address: getAddressFromPrivateKey(privateKey) });
    } catch {
      continue;
    }
  }
  return out;
}

export function getPersonaForAddress(address: string): PersonaSpec | null {
  if (!address) return null;
  return getPanelPersonaIndex().get(address.toLowerCase()) ?? null;
}

export function classifyActor(
  address: string,
  oracleAddress?: string,
  marketCreatorAddress?: string,
): ActorKind {
  const lower = (address ?? "").toLowerCase();
  if (marketCreatorAddress && lower === marketCreatorAddress.toLowerCase()) {
    return { kind: "market-creator", address: lower };
  }
  if (oracleAddress && lower === oracleAddress.toLowerCase()) {
    return { kind: "oracle", address: lower };
  }
  const persona = getPanelPersonaIndex().get(lower);
  if (persona) {
    return { kind: "panel", address: lower, persona };
  }
  return { kind: "human", address: lower };
}

/**
 * One-line label for the activity feed.
 *   - panel name       (panel)
 *   - settlement       (settlement system)
 *   - market           (market opener)
 *   - 0xabcd…1234      (human)
 */
export function actorShortLabel(actor: ActorKind): string {
  switch (actor.kind) {
    case "oracle":         return "settlement";
    case "market-creator": return "market";
    case "panel":          return `${actor.persona.emoji} ${actor.persona.displayName}`;
    case "human":          return `${actor.address.slice(0, 6)}…${actor.address.slice(-4)}`;
  }
}
