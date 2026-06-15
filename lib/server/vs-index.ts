import {
  getClaim,
  getClaimCount,
  getClaimWithAccess,
  mapClaimToVS,
  type ClaimChallenger,
  type ClaimData,
  type VSData,
} from "@/lib/contract";
import {
  getClaimById,
  getClaimsByChallenger,
  getClaimsByFilter,
  getChallengersByClaimId,
  getSyncMeta,
  setSyncMeta,
  upsertClaim,
  upsertClaimsBatch,
  upsertChallengers,
  type ChallengerRow,
  type ClaimRow,
} from "@/lib/db";
import {
  buildVSCacheFreshness,
  makeContractFreshness,
  type VSCacheFreshness,
} from "@/lib/vs-freshness";

const LIST_FRESHNESS_MS = 60_000;
const DETAIL_FRESHNESS_MS = 15_000;
const CONTRACT_FEED_WINDOW = 12;
const CLAIM_SYNC_PAGE_SIZE = 6;
const CLAIM_SYNC_LATEST_WINDOW = 12;
const CLAIM_SYNC_DELAY_MS = 150;
const POST_WRITE_REFRESH_ATTEMPTS = 5;
const POST_WRITE_REFRESH_DELAY_MS = 1_500;
const BACKGROUND_REFRESH_COOLDOWN_MS = 30_000;

type ReconcileResult = {
  synced: number;
  new: number;
  stateChanges: number;
};

export type VSFeedSnapshot = {
  items: VSData[];
  cache: VSCacheFreshness;
};

export type VSDetailSnapshot = {
  item: VSData | null;
  cache: VSCacheFreshness;
};

type BackgroundTaskEntry = {
  startedAt: number;
  promise?: Promise<void>;
};

type VsIndexBackgroundState = {
  feedRefresh?: BackgroundTaskEntry;
  userRefreshes: Map<string, BackgroundTaskEntry>;
  detailRefreshes: Map<number, BackgroundTaskEntry>;
};

declare global {
  var __provenVsIndexBackgroundState: VsIndexBackgroundState | undefined;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getBackgroundState(): VsIndexBackgroundState {
  if (!globalThis.__provenVsIndexBackgroundState) {
    globalThis.__provenVsIndexBackgroundState = {
      userRefreshes: new Map<string, BackgroundTaskEntry>(),
      detailRefreshes: new Map<number, BackgroundTaskEntry>(),
    };
  }

  return globalThis.__provenVsIndexBackgroundState;
}

function isBackgroundTaskCoolingDown(startedAt?: number) {
  return (
    typeof startedAt === "number" &&
    Date.now() - startedAt < BACKGROUND_REFRESH_COOLDOWN_MS
  );
}

function refreshVsIndexInBackground() {
  const state = getBackgroundState();
  const entry = state.feedRefresh;
  if (entry?.promise || isBackgroundTaskCoolingDown(entry?.startedAt)) {
    return;
  }

  const nextEntry: BackgroundTaskEntry = {
    startedAt: Date.now(),
  };

  nextEntry.promise = reconcileVsIndex()
    .then(() => {})
    .catch(() => {
      // Serve indexed rows immediately and let refresh failures degrade quietly.
    })
    .finally(() => {
      const currentState = getBackgroundState();
      const currentEntry = currentState.feedRefresh;
      if (currentEntry?.promise === nextEntry.promise) {
        currentState.feedRefresh = {
          startedAt: nextEntry.startedAt,
        };
      }
    });

  state.feedRefresh = nextEntry;
}

function hydrateUserClaimsInBackground(address: string) {
  const normalizedAddress = address.toLowerCase();
  const state = getBackgroundState();
  const entry = state.userRefreshes.get(normalizedAddress);
  if (entry?.promise || isBackgroundTaskCoolingDown(entry?.startedAt)) {
    return;
  }

  const nextEntry: BackgroundTaskEntry = {
    startedAt: Date.now(),
  };

  nextEntry.promise = hydrateUserClaimsFromContract(address)
    .then(() => {})
    .catch(() => {
      // Keep serving indexed rows if Mantle reads are currently unreliable.
    })
    .finally(() => {
      const currentState = getBackgroundState();
      const currentEntry = currentState.userRefreshes.get(normalizedAddress);
      if (currentEntry?.promise === nextEntry.promise) {
        currentState.userRefreshes.set(normalizedAddress, {
          startedAt: nextEntry.startedAt,
        });
      }
    });

  state.userRefreshes.set(normalizedAddress, nextEntry);
}

function refreshIndexedClaimInBackground(options: {
  claimId: number;
  inviteKey?: string | null;
}) {
  const state = getBackgroundState();
  const entry = state.detailRefreshes.get(options.claimId);
  if (entry?.promise || isBackgroundTaskCoolingDown(entry?.startedAt)) {
    return;
  }

  const nextEntry: BackgroundTaskEntry = {
    startedAt: Date.now(),
  };

  nextEntry.promise = refreshIndexedClaim({
    claimId: options.claimId,
    inviteKey: options.inviteKey,
  })
    .then(() => {})
    .catch(() => {
      // Keep serving indexed rows if Mantle reads are currently unreliable.
    })
    .finally(() => {
      const currentState = getBackgroundState();
      const currentEntry = currentState.detailRefreshes.get(options.claimId);
      if (currentEntry?.promise === nextEntry.promise) {
        currentState.detailRefreshes.set(options.claimId, {
          startedAt: nextEntry.startedAt,
        });
      }
    });

  state.detailRefreshes.set(options.claimId, nextEntry);
}

function isPrivateClaim(claim: Pick<ClaimData, "visibility" | "is_private">) {
  return claim.visibility === "private" || Boolean(claim.is_private);
}

function sanitizeClaimForPublicRead(claim: ClaimData): ClaimData {
  if (!isPrivateClaim(claim)) {
    return claim;
  }

  return {
    ...claim,
    question: "",
    creator_position: "",
    counter_position: "",
    resolution_url: "",
    resolution_summary: "",
    handicap_line: "",
    settlement_rule: "",
  };
}

function isClaimFinal(state: string) {
  return state === "resolved" || state === "cancelled";
}

function isFresh(updatedAt: number, thresholdMs: number) {
  return Date.now() - updatedAt <= thresholdMs;
}

function userMatchesClaim(claim: ClaimData, address: string) {
  const normalized = address.toLowerCase();
  return (
    claim.creator.toLowerCase() === normalized ||
    (claim.challenger_addresses ?? []).some(
      (challengerAddress) => challengerAddress.toLowerCase() === normalized
    )
  );
}

function uniqueSortedIds(ids: number[]) {
  return Array.from(
    new Set(
      ids.filter((id) => Number.isInteger(id) && id > 0)
    )
  ).sort((a, b) => a - b);
}

function rangeIds(startId: number, endId: number) {
  if (endId < startId) {
    return [];
  }
  return Array.from({ length: endId - startId + 1 }, (_, index) => startId + index);
}

async function fetchClaimsForIndex(ids: number[]) {
  const claims: ClaimData[] = [];

  for (const id of uniqueSortedIds(ids)) {
    const claim = await getClaim(id);
    if (claim) {
      claims.push(claim);
    }
    if (CLAIM_SYNC_DELAY_MS > 0) {
      await delay(CLAIM_SYNC_DELAY_MS);
    }
  }

  return claims;
}

async function getRecentContractClaims(limit = CONTRACT_FEED_WINDOW) {
  const totalClaimCount = await getClaimCount();
  const startId = Math.max(1, totalClaimCount - limit + 1);
  const ids = rangeIds(startId, totalClaimCount);
  const claims = await fetchClaimsForIndex(ids);
  return claims
    .filter((claim) => !isPrivateClaim(claim))
    .sort((a, b) => b.id - a.id);
}

async function getRecentContractVs(limit = CONTRACT_FEED_WINDOW) {
  return (await getRecentContractClaims(limit)).map((claim) =>
    mapClaimToVS(sanitizeClaimForPublicRead(claim))
  );
}

async function getRecentUserContractVs(address: string) {
  return (await getRecentContractClaims()).filter((claim) =>
    userMatchesClaim(claim, address)
  ).map((claim) => mapClaimToVS(sanitizeClaimForPublicRead(claim)));
}

function getReferenceUpdatedAt(
  rows: Array<Pick<ClaimRow, "updated_at" | "is_final">>,
  fallbackUpdatedAt?: number | null
) {
  const mutableRows = rows.filter((row) => row.is_final === 0);
  const mutableReference =
    mutableRows.length > 0
      ? Math.min(...mutableRows.map((row) => row.updated_at))
      : null;
  const anyReference =
    rows.length > 0 ? Math.max(...rows.map((row) => row.updated_at)) : null;

  if (typeof fallbackUpdatedAt === "number" && Number.isFinite(fallbackUpdatedAt)) {
    if (mutableReference != null) {
      return Math.max(fallbackUpdatedAt, mutableReference);
    }

    if (anyReference != null) {
      return Math.max(fallbackUpdatedAt, anyReference);
    }

    return fallbackUpdatedAt;
  }

  return mutableReference ?? anyReference ?? null;
}

async function buildListCacheFreshness(rows: ClaimRow[]) {
  const lastSyncAt = Number((await getSyncMeta("last_sync_at")) ?? "0");
  return buildVSCacheFreshness({
    updatedAtMs: getReferenceUpdatedAt(rows, lastSyncAt > 0 ? lastSyncAt : null),
    freshnessWindowMs: LIST_FRESHNESS_MS,
    source: "index",
  });
}

function buildDetailCacheFreshness(row: ClaimRow | null) {
  return buildVSCacheFreshness({
    updatedAtMs: row?.updated_at ?? null,
    freshnessWindowMs: DETAIL_FRESHNESS_MS,
    source: "index",
  });
}

function challengerRowsToClaimChallengers(rows: ChallengerRow[]): ClaimChallenger[] {
  return rows.map((row) => ({
    address: row.address,
    stake: row.stake,
    potential_payout: row.potential_payout,
  }));
}

function claimRowToClaimData(
  row: ClaimRow,
  challengerRows: ChallengerRow[] = []
): ClaimData {
  const challengers = challengerRowsToClaimChallengers(challengerRows);
  const challengerAddresses =
    challengers.length > 0
      ? challengers.map((challenger) => challenger.address)
      : row.first_challenger
      ? [row.first_challenger]
      : [];

  return {
    id: row.id,
    creator: row.creator,
    question: row.question ?? "",
    creator_position: row.creator_position ?? "",
    counter_position: row.counter_position ?? "",
    resolution_url: row.resolution_url ?? "",
    creator_stake: row.creator_stake,
    total_challenger_stake: row.total_challenger_stake,
    reserved_creator_liability: row.reserved_creator_liability,
    available_creator_liability: Math.max(
      0,
      row.creator_stake - row.reserved_creator_liability
    ),
    deadline: row.deadline,
    state: row.state as ClaimData["state"],
    winner_side: row.winner_side as ClaimData["winner_side"],
    resolution_summary: row.resolution_summary ?? "",
    confidence: row.confidence,
    category: row.category,
    parent_id: row.parent_id,
    challenger_count: row.challenger_count,
    market_type: row.market_type,
    odds_mode: row.odds_mode,
    challenger_payout_bps: row.challenger_payout_bps,
    handicap_line: row.handicap_line ?? "",
    settlement_rule: row.settlement_rule ?? "",
    max_challengers: row.max_challengers,
    visibility: row.visibility as ClaimData["visibility"],
    is_private: row.visibility === "private",
    resolve_attempts: 0,
    creator_requested_resolve: false,
    challenger_requested_resolve: false,
    challengers: challengers.length > 0 ? challengers : undefined,
    first_challenger: row.first_challenger,
    challenger_addresses: challengerAddresses,
    total_pot: row.total_pot,
  };
}

function claimRowToVSData(row: ClaimRow, challengerRows: ChallengerRow[] = []) {
  return mapClaimToVS(claimRowToClaimData(row, challengerRows));
}

async function persistIndexedClaim(claim: ClaimData) {
  await upsertClaim(claim);

  if (Array.isArray(claim.challengers)) {
    await upsertChallengers(claim.id, claim.challengers);
    return;
  }

  if (claim.challenger_count === 0) {
    await upsertChallengers(claim.id, []);
  }
}

async function persistIndexedClaims(claims: ClaimData[]) {
  if (claims.length === 0) {
    return;
  }

  await upsertClaimsBatch(claims);
  await Promise.all(
    claims
      .filter((claim) => claim.challenger_count === 0)
      .map((claim) => upsertChallengers(claim.id, []))
  );
}

async function loadStoredVsById(vsId: number) {
  const [row, challengerRows] = await Promise.all([
    getClaimById(vsId),
    getChallengersByClaimId(vsId),
  ]);

  return { row, challengerRows };
}

async function loadStoredUserVs(address: string) {
  const normalized = address.toLowerCase();
  const creatorRows = await getClaimsByFilter({
    creator: normalized,
    orderBy: "id_desc",
  });

  const challengerClaimIds = await getClaimsByChallenger(normalized);
  const creatorIds = new Set(creatorRows.map((row) => row.id));
  const otherIds = challengerClaimIds.filter((id) => !creatorIds.has(id));
  const otherRows =
    otherIds.length > 0
      ? await getClaimsByFilter({
          ids: otherIds,
          orderBy: "id_desc",
        })
      : [];

  const rows = [...creatorRows, ...otherRows].sort((a, b) => b.id - a.id);
  const withChallengers = await Promise.all(
    rows.map(async (row) => {
      const challengerRows = await getChallengersByClaimId(row.id);
      return {
        row,
        challengerRows,
        vs: claimRowToVSData(row, challengerRows),
      };
    })
  );

  return withChallengers;
}

async function fetchClaimForIndex(
  claimId: number,
  inviteKey?: string | null
): Promise<ClaimData | null> {
  if (inviteKey) {
    return getClaimWithAccess(claimId, inviteKey);
  }

  return getClaim(claimId);
}

async function hydrateUserClaimsFromContract(address: string) {
  const storedEntries = await loadStoredUserVs(address);
  const claims = (
    await Promise.all(storedEntries.map(({ row }) => getClaim(row.id)))
  ).filter((claim): claim is ClaimData => claim !== null);

  if (claims.length === 0) {
    return [];
  }

  await persistIndexedClaims(claims);

  const publicClaimsNeedingDetails = claims.filter(
    (claim) => !isPrivateClaim(claim) && claim.challenger_count > 0
  );

  if (publicClaimsNeedingDetails.length > 0) {
    const fullClaims = await Promise.all(
      publicClaimsNeedingDetails.map((claim) => getClaim(claim.id))
    );

    await Promise.all(
      fullClaims
        .filter((claim): claim is ClaimData => claim !== null)
        .map((claim) => persistIndexedClaim(claim))
    );
  }

  return claims
    .map(sanitizeClaimForPublicRead)
    .map(mapClaimToVS)
    .sort((a, b) => b.id - a.id);
}

export async function refreshIndexedClaim(options: {
  claimId: number;
  inviteKey?: string | null;
  attempts?: number;
  attemptDelayMs?: number;
}) {
  const attempts = options.attempts ?? 1;
  const attemptDelayMs = options.attemptDelayMs ?? 0;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const claim = await fetchClaimForIndex(options.claimId, options.inviteKey);
    if (claim) {
      await persistIndexedClaim(claim);
      return claim;
    }

    if (attempt < attempts - 1 && attemptDelayMs > 0) {
      await delay(attemptDelayMs);
    }
  }

  return null;
}

export async function getVsWithInvite(
  claimId: number,
  inviteKey: string
): Promise<VSData | null> {
  const claim = await getClaimWithAccess(claimId, inviteKey);
  if (!claim) {
    return null;
  }

  try {
    await persistIndexedClaim(claim);
  } catch {
    // Private claims should still load even if the read index is unavailable.
  }

  return mapClaimToVS(claim);
}

export async function reconcileVsIndex(): Promise<ReconcileResult> {
  const now = Date.now();
  const [lastClaimCountValue, totalClaimCount, activeRows] =
    await Promise.all([
      getSyncMeta("last_claim_count"),
      getClaimCount(),
      getClaimsByFilter({
        visibility: "public",
        states: ["open", "active"],
        orderBy: "id_desc",
      }),
    ]);

  const lastClaimCount = Number(lastClaimCountValue ?? "0");
  const nextSequentialEnd = Math.min(
    totalClaimCount,
    lastClaimCount + CLAIM_SYNC_PAGE_SIZE
  );
  const sequentialIds = rangeIds(lastClaimCount + 1, nextSequentialEnd);
  const latestIds = rangeIds(
    Math.max(1, totalClaimCount - CLAIM_SYNC_LATEST_WINDOW + 1),
    totalClaimCount
  );
  const activeIds = activeRows.map((row) => row.id);
  const claims = await fetchClaimsForIndex([
    ...sequentialIds,
    ...latestIds,
    ...activeIds,
  ]);
  const claimsById = new Map(claims.map((claim) => [claim.id, claim]));
  let synced = 0;
  let newClaims = 0;
  let stateChanges = 0;

  if (claims.length > 0) {
    const existingById = new Map(activeRows.map((row) => [row.id, row]));
    await persistIndexedClaims(claims);
    synced += claims.length;
    newClaims += claims.filter((claim) => claim.id > lastClaimCount).length;

    for (const claim of claims) {
      const existing = existingById.get(claim.id) as (typeof activeRows)[0] | undefined;
      if (
        !existing ||
        existing.state !== claim.state ||
        existing.total_challenger_stake !== claim.total_challenger_stake ||
        existing.challenger_count !== claim.challenger_count
      ) {
        stateChanges += 1;
      }
    }
  }

  let syncedThrough = lastClaimCount;
  while (claimsById.has(syncedThrough + 1)) {
    syncedThrough += 1;
  }

  await Promise.all([
    setSyncMeta("last_claim_count", String(Math.max(lastClaimCount, syncedThrough))),
    setSyncMeta("last_sync_at", String(now)),
  ]);

  return {
    synced,
    new: newClaims,
    stateChanges,
  };
}

export async function getVsFeedSnapshot(
  options: { forceRefresh?: boolean } = {}
): Promise<VSFeedSnapshot> {
  try {
    const rows = await getClaimsByFilter({
      visibility: "public",
      orderBy: "id_desc",
    });
    const lastSyncAt = Number((await getSyncMeta("last_sync_at")) ?? "0");
    const shouldRefresh =
      options.forceRefresh ||
      rows.length === 0 ||
      !lastSyncAt ||
      !isFresh(lastSyncAt, LIST_FRESHNESS_MS);

    if (options.forceRefresh || rows.length === 0) {
      try {
        await reconcileVsIndex();
      } catch {
        // Keep serving the contract-backed index if Mantle RPC is rate-limited.
      }
      const refreshedRows = await getClaimsByFilter({
        visibility: "public",
        orderBy: "id_desc",
      });
      return {
        items: refreshedRows.map((row) => claimRowToVSData(row)),
        cache: buildVSCacheFreshness({
          updatedAtMs: Date.now(),
          freshnessWindowMs: LIST_FRESHNESS_MS,
          source: "index",
        }),
      };
    }

    if (shouldRefresh) {
      refreshVsIndexInBackground();
    }

    return {
      items: rows.map((row) => claimRowToVSData(row)),
      cache: await buildListCacheFreshness(rows),
    };
  } catch {
    const contractItems = await getRecentContractVs().catch(() => []);
    return {
      items: contractItems,
      cache: contractItems.length > 0
        ? makeContractFreshness()
        : buildVSCacheFreshness({
            updatedAtMs: null,
            freshnessWindowMs: LIST_FRESHNESS_MS,
            source: "index",
          }),
    };
  }
}

export async function getVsFeed(options: { forceRefresh?: boolean } = {}) {
  return (await getVsFeedSnapshot(options)).items;
}

export async function getVsDetailSnapshot(vsId: number): Promise<VSDetailSnapshot> {
  try {
    const { row, challengerRows } = await loadStoredVsById(vsId);
    if (row?.visibility === "private") {
      return {
        item: null,
        cache: buildDetailCacheFreshness(row),
      };
    }

    const missingChallengerDetails =
      row != null &&
      row.challenger_count > 0 &&
      challengerRows.length < row.challenger_count;

    if (
      row &&
      row.is_final === 1 &&
      !missingChallengerDetails &&
      isFresh(row.updated_at, DETAIL_FRESHNESS_MS)
    ) {
      return {
        item: claimRowToVSData(row, challengerRows),
        cache: buildDetailCacheFreshness(row),
      };
    }

    const freshClaim = await refreshIndexedClaim({ claimId: vsId });
    if (freshClaim) {
      return {
        item: mapClaimToVS(freshClaim),
        cache: makeContractFreshness(),
      };
    }

    if (row) {
      return {
        item: claimRowToVSData(row, challengerRows),
        cache: buildDetailCacheFreshness(row),
      };
    }

    if (!row) {
      const [lastSyncAtValue, lastClaimCountValue] = await Promise.all([
        getSyncMeta("last_sync_at"),
        getSyncMeta("last_claim_count"),
      ]);

      const lastSyncAt = Number(lastSyncAtValue ?? "0");
      const lastClaimCount = Number(lastClaimCountValue ?? "0");
      const hasFreshIndex =
        lastSyncAt > 0 && isFresh(lastSyncAt, LIST_FRESHNESS_MS);

      if (hasFreshIndex && (lastClaimCount === 0 || vsId > lastClaimCount)) {
        return {
          item: null,
          cache: buildVSCacheFreshness({
            updatedAtMs: lastSyncAt > 0 ? lastSyncAt : null,
            freshnessWindowMs: LIST_FRESHNESS_MS,
            source: "index",
          }),
        };
      }
    }
  } catch {
    // Fall through to the existing cache-backed path below.
  }

  const fallbackItem = await getClaim(vsId).then((claim) =>
    claim ? mapClaimToVS(claim) : null
  ).catch(() => null);
  return {
    item: fallbackItem,
    cache: buildVSCacheFreshness({
      updatedAtMs: null,
      freshnessWindowMs: DETAIL_FRESHNESS_MS,
      source: "index",
    }),
  };
}

export async function getVsDetail(vsId: number) {
  return (await getVsDetailSnapshot(vsId)).item;
}

export async function getUserVsSnapshot(
  address: string,
  options: { forceRefresh?: boolean } = {}
): Promise<VSFeedSnapshot> {
  try {
    const storedEntries = await loadStoredUserVs(address);
    const storedItems = storedEntries.map((entry) => entry.vs);
    const storedRows = storedEntries.map((entry) => entry.row);
    const forceRefresh = options.forceRefresh === true;
    const shouldRefresh =
      forceRefresh ||
      storedEntries.length === 0 ||
      storedEntries.some(
        ({ row }) => row.is_final === 0 && !isFresh(row.updated_at, LIST_FRESHNESS_MS)
      );

    if (storedItems.length > 0 && !shouldRefresh) {
      return {
        items: storedItems,
        cache: buildVSCacheFreshness({
          updatedAtMs: getReferenceUpdatedAt(storedRows),
          freshnessWindowMs: LIST_FRESHNESS_MS,
          source: "index",
        }),
      };
    }

    if (storedItems.length > 0 && !forceRefresh) {
      if (shouldRefresh) {
        hydrateUserClaimsInBackground(address);
      }
      return {
        items: storedItems,
        cache: buildVSCacheFreshness({
          updatedAtMs: getReferenceUpdatedAt(storedRows),
          freshnessWindowMs: LIST_FRESHNESS_MS,
          source: "index",
        }),
      };
    }

    try {
      await reconcileVsIndex().catch(() => undefined);
      const refreshedEntries = await loadStoredUserVs(address);
      const refreshedItems = refreshedEntries.map((entry) => entry.vs);
      if (refreshedItems.length > 0) {
        return {
          items: refreshedItems,
          cache: buildVSCacheFreshness({
            updatedAtMs: getReferenceUpdatedAt(refreshedEntries.map((entry) => entry.row)),
            freshnessWindowMs: LIST_FRESHNESS_MS,
            source: "index",
          }),
        };
      }
    } catch {
      if (storedItems.length > 0) {
        return {
          items: storedItems,
          cache: buildVSCacheFreshness({
            updatedAtMs: getReferenceUpdatedAt(storedRows),
            freshnessWindowMs: LIST_FRESHNESS_MS,
            source: "index",
          }),
        };
      }
    }

    return {
      items: storedItems,
      cache: buildVSCacheFreshness({
        updatedAtMs: getReferenceUpdatedAt(storedRows),
        freshnessWindowMs: LIST_FRESHNESS_MS,
        source: "index",
      }),
    };
  } catch {
    const contractItems = await getRecentUserContractVs(address).catch(() => []);
    return {
      items: contractItems,
      cache: contractItems.length > 0
        ? makeContractFreshness()
        : buildVSCacheFreshness({
            updatedAtMs: null,
            freshnessWindowMs: LIST_FRESHNESS_MS,
            source: "index",
          }),
    };
  }
}

export async function getUserVs(address: string) {
  return (await getUserVsSnapshot(address)).items;
}

export async function triggerPostWriteRefresh(options: {
  claimId: number;
  inviteKey?: string | null;
}) {
  return refreshIndexedClaim({
    claimId: options.claimId,
    inviteKey: options.inviteKey,
    attempts: POST_WRITE_REFRESH_ATTEMPTS,
    attemptDelayMs: POST_WRITE_REFRESH_DELAY_MS,
  });
}
