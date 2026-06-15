/**
 * In-memory transaction lock.
 *
 * Browser wallet writes should be serialized per wallet address in the active
 * tab so duplicate clicks do not submit overlapping transactions. This is not a
 * source of truth and does not persist anything in browser storage.
 */

/**
 * Maximum time a lock is considered alive. After this, any tab may steal it.
 * 30 s covers the MetaMask prompt + EVM confirmation window with headroom.
 */
const LOCK_TTL_MS = 30_000;
const LOCK_REFRESH_MS = 5_000;

interface LockEntry {
  /** Random identifier for this tab session. */
  tabId: string;
  /** Lower-cased wallet address for this lock. */
  scope: string;
  /** Epoch ms when the lock was acquired or last refreshed. */
  ts: number;
}

const activeLocks = new Map<string, LockEntry>();

/** Per-tab stable identifier (unique per tab, survives re-renders). */
let _tabId: string | null = null;
function getTabId(): string {
  if (!_tabId) {
    _tabId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }
  return _tabId;
}

function normalizeScope(scope: string) {
  return scope.trim().toLowerCase();
}

function readLock(scope: string): LockEntry | null {
  return activeLocks.get(normalizeScope(scope)) ?? null;
}

function writeLock(scope: string, entry: LockEntry) {
  activeLocks.set(normalizeScope(scope), entry);
}

function clearLock(scope: string, tabId: string) {
  const normalizedScope = normalizeScope(scope);
  const current = activeLocks.get(normalizedScope);
  if (current?.tabId === tabId) {
    activeLocks.delete(normalizedScope);
  }
}

/**
 * Attempt to acquire the current-tab transaction lock for a wallet.
 *
 * @returns A `release` function that MUST be called after the transaction
 *          completes (success or failure).
 * @throws  If another tab currently holds the lock and the TTL hasn't expired.
 */
export function acquireTxLock(scope: string): () => void {
  if (typeof window === "undefined") {
    // SSR - no locking needed, return a no-op release.
    return () => {};
  }

  const normalizedScope = normalizeScope(scope);
  if (!normalizedScope) {
    return () => {};
  }

  const tabId = getTabId();
  const now = Date.now();
  const existing = readLock(normalizedScope);

  if (existing && existing.tabId !== tabId && now - existing.ts < LOCK_TTL_MS) {
    throw new Error(
      "Another transaction is already in progress for this wallet. " +
      "Please wait for it to complete before submitting a new one."
    );
  }

  writeLock(normalizedScope, {
    tabId,
    scope: normalizedScope,
    ts: now,
  });

  const verify = readLock(normalizedScope);
  if (verify && verify.tabId !== tabId) {
    throw new Error(
      "Another transaction is already in progress for this wallet. " +
      "Please wait for it to complete before submitting a new one."
    );
  }

  const refreshTimer = window.setInterval(() => {
    const current = readLock(normalizedScope);
    if (current?.tabId === tabId) {
      writeLock(normalizedScope, {
        tabId,
        scope: normalizedScope,
        ts: Date.now(),
      });
    }
  }, LOCK_REFRESH_MS);

  let released = false;
  return () => {
    if (!released) {
      released = true;
      window.clearInterval(refreshTimer);
      clearLock(normalizedScope, tabId);
    }
  };
}
