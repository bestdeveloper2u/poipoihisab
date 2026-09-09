/**
 * Optimistic-create store (T27.2) — the pending-create twin for expenses.
 *
 * A manual add no longer holds the form for the POST /expenses round-trip:
 * app/add.tsx registers the row here, shows the success toast and navigates
 * back IMMEDIATELY, then settles the create in the background. List and
 * dashboard merge these pending rows into their fetched data at render time
 * (temps LAST so they sort naturally at the end of recents lists) and
 * re-render via subscribe().
 *
 * PURE module: no React, no react-native, no SecureStore — plain module
 * state + functions, fully testable from node (see
 * scripts/t27_optimistic_check.mjs). Injectable id/clock keep tests
 * deterministic.
 *
 * Lifecycle of one create:
 *   beginOptimistic(input)  → temp row (id "temp-<uuid>"), visible everywhere
 *   resolveOptimistic(...)  → payload replaced by the real row, marked
 *                             resolved; takePending() drops it, and the real
 *                             row arrives via the normal focus refetch
 *                             (mergeOptimisticRows dedupes so a temp and its
 *                             real twin are never rendered twice)
 *   failOptimistic(tempId)  → entry dropped; the caller toasts the error and
 *                             the add-form draft is intentionally KEPT so the
 *                             user can retry.
 *
 * The queue is bounded (MAX_PENDING_CREATES): a broken network can't grow it
 * unbounded — the OLDEST entry is dropped beyond the cap.
 */
import type { Expense, ExpenseCreateInput, PayMethod } from "./api";

/** A create payload plus the optional owner id (auth.user.id when known). */
export interface OptimisticBeginInput extends ExpenseCreateInput {
  /** "" (or omitted) when the caller can't know it — temp rows only. */
  user_id?: string;
}

/** One tracked create: pending (unresolved) or already resolved. */
interface PendingEntry {
  tempId: string;
  input: OptimisticBeginInput;
  /** Epoch ms at begin() — orders the bounded queue (drop oldest). */
  createdAt: number;
  resolved: boolean;
  real: Expense | null;
}

/**
 * Pending-create cap. Beyond this the OLDEST entry is dropped, so a broken
 * network loop can never grow the store unbounded.
 */
export const MAX_PENDING_CREATES = 20;

// --- Injectable id/clock (tests) ---------------------------------------------

interface OptimisticInternals {
  newId(): string;
  now(): number;
}

/** RFC 4122 v4-shaped id without Web Crypto (Hermes has no crypto.randomUUID). */
function fallbackUuid(): string {
  const hex = "0123456789abcdef";
  let out = "";
  for (let i = 0; i < 36; i += 1) {
    if (i === 8 || i === 13 || i === 18 || i === 23) {
      out += "-";
    } else if (i === 14) {
      out += "4"; // version
    } else if (i === 19) {
      out += hex[8 + ((Math.random() * 4) | 0)]; // variant 8/9/a/b
    } else {
      out += hex[(Math.random() * 16) | 0];
    }
  }
  return out;
}

let internals: OptimisticInternals = {
  newId: fallbackUuid,
  now: () => Date.now(),
};

/**
 * Swap the id generator / clock — test seams. Pass only what you override;
 * restore with resetOptimistic().
 */
export function configureOptimistic(overrides: Partial<OptimisticInternals>): void {
  internals = { ...internals, ...overrides };
}

/** Clear every tracked entry and restore default id/clock (test reset). */
export function resetOptimistic(): void {
  entries.length = 0;
  internals = { newId: fallbackUuid, now: () => Date.now() };
}

// --- Store --------------------------------------------------------------------

const entries: PendingEntry[] = [];
const subscribers = new Set<() => void>();
let version = 0;

function notify(): void {
  version += 1;
  for (const fn of subscribers) {
    try {
      fn();
    } catch {
      // One broken subscriber must not starve the others.
    }
  }
}

/** Render-time snapshot for useSyncExternalStore — bumps on every mutation. */
export function pendingVersion(): number {
  return version;
}

/**
 * Register a pending create; returns the temp row shaped exactly like an
 * Expense (id = "temp-<uuid>", created_at from the injectable clock). The
 * row fields mirror the POST body (pay defaults to "cash", desc to null —
 * the same server-side defaults apply to the eventual real row).
 *
 * T31.1: `opts.tempId` lets lib/outbox.ts re-register a PERSISTED entry
 * after an app restart under its original id (so a queued offline expense
 * keeps resolving the same temp row). Omitted → generated id, exactly as
 * before — the online flow's semantics are untouched.
 */
export function beginOptimistic(
  input: OptimisticBeginInput,
  opts: { tempId?: string } = {},
): Expense {
  const entry: PendingEntry = {
    tempId: opts.tempId ?? `temp-${internals.newId()}`,
    input,
    createdAt: internals.now(),
    resolved: false,
    real: null,
  };
  entries.push(entry);
  if (entries.length > MAX_PENDING_CREATES) {
    // Drop the OLDEST entries beyond the cap (they are the least likely to
    // still be on screen).
    entries.splice(0, entries.length - MAX_PENDING_CREATES);
  }
  notify();
  return tempRow(entry);
}

/** The Expense-shaped view of a tracked entry. */
function tempRow(entry: PendingEntry): Expense {
  return {
    id: entry.tempId,
    user_id: entry.input.user_id ?? "",
    cat: entry.input.cat,
    grp: entry.input.grp,
    amt: entry.input.amt,
    pay: (entry.input.pay ?? "cash") as PayMethod,
    desc: entry.input.desc ?? null,
    iso: entry.input.iso,
    created_at: new Date(entry.createdAt).toISOString(),
  };
}

/**
 * The create succeeded: swap the payload for the real server row and mark
 * resolved. Resolved entries leave takePending() immediately (their temp
 * twin disappears); the real row reaches the screens through the normal
 * focus refetch, and mergeOptimisticRows() bridges + dedupes in between.
 * Unknown tempId → no-op.
 */
export function resolveOptimistic(tempId: string, real: Expense): void {
  const entry = entries.find((e) => e.tempId === tempId);
  if (entry === undefined || entry.resolved) return;
  entry.resolved = true;
  entry.real = real;
  notify();
}

/**
 * The create failed: drop the entry (screens drop the temp row on the next
 * render). The caller owns the error surfacing (describeApiError + toast)
 * and must KEEP the add-form draft so the user can retry. Unknown tempId or
 * already-resolved → no-op.
 */
export function failOptimistic(tempId: string): void {
  const idx = entries.findIndex((e) => e.tempId === tempId);
  if (idx === -1) return;
  entries.splice(idx, 1);
  notify();
}

/**
 * Current UNRESOLVED entries as Expense-like rows, oldest first — callers
 * append them AFTER fetched items so temps sit at the end of recents lists.
 */
export function takePending(): Expense[] {
  return entries.filter((e) => !e.resolved).map(tempRow);
}

/**
 * Notify subscribers (list/dashboard re-render) on every store mutation.
 * Returns the unsubscribe function.
 */
export function subscribe(fn: () => void): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

/**
 * Render-time merge for list/dashboard: fetched rows first, then any
 * resolved-but-not-yet-refetched real rows (seamless bridge until the focus
 * refetch lands — no row blink), then unresolved temps LAST.
 *
 * Also garbage-collects resolved entries whose real row has arrived via a
 * refetch — the dedupe guarantee: a temp and its real twin are never
 * rendered twice. Idempotent, no notifications (safe during render).
 */
export function mergeOptimisticRows<T extends Expense>(
  fetched: readonly T[],
): Expense[] {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (
      entry.resolved &&
      entry.real !== null &&
      fetched.some((row) => row.id === entry.real?.id)
    ) {
      entries.splice(i, 1);
    }
  }
  const bridging: Expense[] = [];
  for (const entry of entries) {
    if (
      entry.resolved &&
      entry.real !== null &&
      !fetched.some((row) => row.id === entry.real?.id)
    ) {
      bridging.push(entry.real);
    }
  }
  return [...fetched, ...bridging, ...takePending()];
}
