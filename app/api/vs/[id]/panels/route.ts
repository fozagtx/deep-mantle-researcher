/**
 * GET /api/vs/[id]/panels
 *
 * Returns the panels' record on a single claim:
 *   - which personas have staked on the challenger side
 *   - how much each persona staked
 *   - the tx hash that proves it
 *
 * Pure on-chain read of ClaimChallenged logs filtered to the claim ID,
 * cross-referenced against the active panel persona addresses. No LLM
 * calls happen here — the worker handles those off-band — so this route
 * is cheap and cacheable.
 */

import { NextResponse } from "next/server";
import {
  createMantlePublicClient,
  getContractAddress,
  getDeployBlock,
  microToNative,
  paginatedGetLogs,
} from "@/lib/mantle";
import {
  PANEL_PERSONAS,
  personaPrivateKeyEnv,
  type PersonaSpec,
} from "@/agents/panels/personas";
import { getAddressFromPrivateKey } from "@/lib/mantle-agent";

export const revalidate = 20;

interface PersonaVote {
  slug:        string;
  displayName: string;
  emoji:       string;
  archetype:   PersonaSpec["archetype"];
  accent:      PersonaSpec["accent"];
  staked:      boolean;
  stakeMnt:   number;
  txHash:      string | null;
  blockNumber: number | null;
}

interface PanelResponse {
  claimId:    number;
  total:      number;
  stakedCount: number;
  totalMnt:  number;
  votes:      PersonaVote[];
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await ctx.params;
  const claimId = Number(rawId);
  if (!Number.isFinite(claimId) || claimId <= 0) {
    return NextResponse.json({ error: "invalid claim id" }, { status: 400 });
  }

  const client    = createMantlePublicClient();
  const address   = getContractAddress();
  const fromBlock = getDeployBlock();

  let logs: any[] = [];
  try {
    logs = await paginatedGetLogs(client, {
      address,
      event: {
        type: "event",
        name: "ClaimChallenged",
        inputs: [
          { name: "id",         type: "uint256", indexed: true },
          { name: "challenger", type: "address", indexed: true },
          { name: "stake",      type: "uint256", indexed: false },
        ],
      },
      // `args` is a sibling of `event` in viem's getLogs filter — placing it
      // inside the event object silently disables the indexed-topic filter
      // and returns ChallengeChallenged logs across ALL claims, which then
      // smear every persona's stakes onto whichever claim page is open.
      args: { id: BigInt(claimId) },
    } as any, fromBlock);
  } catch (err) {
    console.error("[api/vs/panels] log fetch failed:", err);
  }

  const stakeByAddress = new Map<string, { stake: bigint; txHash: string; blockNumber: number }>();
  for (const log of logs) {
    const actor = String(log.args.challenger ?? "").toLowerCase();
    if (!actor) continue;
    const stake = BigInt(log.args.stake ?? 0);
    const existing = stakeByAddress.get(actor);
    if (!existing || stake > existing.stake) {
      stakeByAddress.set(actor, {
        stake,
        txHash:      log.transactionHash,
        blockNumber: Number(log.blockNumber ?? 0),
      });
    }
  }

  const votes: PersonaVote[] = PANEL_PERSONAS.map((p) => {
    let addr: string | null = null;
    const privateKey = process.env[personaPrivateKeyEnv(p)]?.trim();
    if (privateKey) {
      try {
        addr = getAddressFromPrivateKey(privateKey).toLowerCase();
      } catch {
        addr = null;
      }
    }
    const hit = addr ? stakeByAddress.get(addr) : undefined;
    return {
      slug:        p.slug,
      displayName: p.displayName,
      emoji:       p.emoji,
      archetype:   p.archetype,
      accent:      p.accent,
      staked:      !!hit,
      stakeMnt:   hit ? microToNative(hit.stake) : 0,
      txHash:      hit?.txHash ?? null,
      blockNumber: hit?.blockNumber ?? null,
    };
  });

  const stakedCount = votes.filter((v) => v.staked).length;
  const totalMnt   = votes.reduce((acc, v) => acc + v.stakeMnt, 0);

  const body: PanelResponse = {
    claimId,
    total:       votes.length,
    stakedCount,
    totalMnt,
    votes,
  };
  return NextResponse.json(body, {
    headers: {
      "Cache-Control": "public, s-maxage=20, stale-while-revalidate=60",
    },
  });
}
