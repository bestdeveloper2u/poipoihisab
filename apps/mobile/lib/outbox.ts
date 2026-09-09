/**
 * T31.1 — persistent OFFLINE expense OUTBOX (mobile twin of the web PWA's
 * lib/outbox.ts, ADR-0022).
 *
 * An expense created while offline (or whose transport dies mid-flight) is
 * queued on-device in a small JSON file and flushed FIFO when connectivity
 * returns. The visible pending row comes from lib/optimistic.ts: enqueue()
 * registers it there, so list/dashboard render it exactly like an online
 * optimistic create; flushAll() swaps it for the real server row via
 * resolveOptimistic().
 *
 * Flush triggers (wired in app/_layout.tsx, mirroring the web
 * <OutboxAutoFlush/>): authed boot (hydrate + one flush), the NetInfo
 * reconnect edge (disconnected → connected) and AppState "active".
 *
 * PURE module: no React, no react-native. The only native access —
 * expo-file-system — hides behind the injectable load/save adapters
 * (dynamic imports inside the default adapters, so node harnesses inject a
 * fake fs and never load native code; see scripts/t31_outbox_check.mjs).
 * Injectable clock/id keep tests deterministic (same pattern as
 * optimistic.ts).
 *
 * Semantics mirrored from the web twin where sensible:
 *   - FIFO drain, oldest first;
 *   - a failed send KEEPS the entry and STOPS the run (see flushAll);
 *   - single-flight flush (concurrent callers share one run);
 *   - cap 50 entries, drop the OLDEST beyond the cap.
 */
import type { Expense, ExpenseCreateInput } from "./api";
// Explicit .ts extension: this module is exercised directly by node
// (scripts/t31_outbox_check.mjs), whose ESM resolver — unlike Metro's —
// does not try extensions (allowed by allowImportingTsExtensions in
// apps/mobile/tsconfig.json).
import {
  beginOptimistic,
  failOptimistic,
  resolveOptimistic,
  takePending,
  type OptimisticBeginInput,
} from "./optimistic.ts";

/** One queued expense: the create payload + the temp row it renders as. */
export interface OutboxEntry {
  /** The optimistic temp row bound to this payload ("temp-<uuid>"). */
  tempId: string;
  /** Exact POST body for the eventual flush (plus user_id for temp rows). */
  input: OptimisticBeginInput;
  /** Epoch ms at enqueue — orders the bounded queue (drop oldest). */
  queuedAt: number;
}

/** The transport flushAll drains with — createExpense bound to a token. */
export type OutboxSender = (input: ExpenseCreateInput) => Promise<Expense>;

export interface OutboxFlushReport {
  /** Entries accepted by the server and removed from the queue. */
  flushed: number;
  /** Entries still queued after this run (send failed → kept for retry). */
  kept: number;
}

/**
 * Queue cap. Beyond this the OLDEST entry is dropped (its pending row goes
 * with it), so a long offline stretch can't grow the file unbounded. Larger
 * than the optimistic store's MAX_PENDING_CREATES on purpose: a queued
 * expense whose temp row aged out of the visible window still flushes —
 * resolveOptimistic() simply no-ops for the dropped row id and the real row
 * arrives through the normal focus refetch.
 */
export const MAX_OUTBOX_ENTRIES = 50;

/** On-disk file (under documentDirectory) holding the persisted queue. */
export const OUTBOX_FILENAME = "poipoihisab-outbox.json";

/** File format version, for future migrations (v1 = { version, entries }). */
const OUTBOX_FILE_VERSION = 1;

/** Coalesce enqueue bursts (e.g. a hydrate re-write) into one file write. */
const PERSIST_DEBOUNCE_MS = 150;

// --- Injectable id/clock/fs (tests) -------------------------------------------

interface OutboxInternals {
  newId(): string;
  now(): number;
  /** Raw file content, or null when missing/unreadable. */
  load(): Promise<string | null>;
  /** Persist raw file content (whole-file replace). */
  save(raw: string): Promise<void>;
  debounceMs: number;
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

/* Production fs adapters — the ONLY native touchpoints. Dynamic imports so
 * node harnesses (which inject fakes) never resolve expo-file-system. */

async function defaultLoad(): Promise<string | null> {
  try {
    const fs = await import("expo-file-system/legacy");
    const dir = fs.documentDirectory;
    if (dir === null) return null; // no document directory → no persistence
    // A missing file throws → caught below → treated as an empty queue.
    return await fs.readAsStringAsync(`${dir}${OUTBOX_FILENAME}`);
  } catch {
    return null;
  }
}

async function defaultSave(raw: string): Promise<void> {
  const fs = await import("expo-file-system/legacy");
  const dir = fs.documentDirectory;
  if (dir === null) return;
  await fs.writeAsStringAsync(`${dir}${OUTBOX_FILENAME}`, raw);
}

const defaultInternals: OutboxInternals = {
  newId: fallbackUuid,
  now: () => Date.now(),
  load: defaultLoad,
  save: defaultSave,
  debounceMs: PERSIST_DEBOUNCE_MS,
};

let internals: OutboxInternals = { ...defaultInternals };

/**
 * Swap the id generator / clock / fs adapters — test (and future alternate
 * storage) seams. Pass only what you override; restore with resetOutbox().
 */
export function configureOutbox(overrides: Partial<OutboxInternals>): void {
  internals = { ...internals, ...overrides };
}

/** Clear all queue state and restore the default seams (test reset). */
export function resetOutbox(): void {
  queue.length = 0;
  hydrated = false;
  inFlightFlush = null;
  if (writeTimer !== null) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  writeChain = Promise.resolve();
  internals = { ...defaultInternals };
}

// --- Store --------------------------------------------------------------------

const queue: OutboxEntry[] = []; // FIFO: index 0 = oldest
const subscribers = new Set<() => void>();
let version = 0;
/** One hydrate per process — a second call can't double-register rows. */
let hydrated = false;

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

/**
 * Number of queued offline expenses. Mirrors optimistic.ts conventions:
 * plain module state, no async, safe during render.
 */
export function count(): number {
  return queue.length;
}

/** Render-time snapshot for useSyncExternalStore — bumps on every mutation. */
export function outboxVersion(): number {
  return version;
}

/**
 * Notify subscribers (e.g. a queue-depth badge) on every queue mutation.
 * Returns the unsubscribe function.
 */
export function subscribe(fn: () => void): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

// --- Persistence (debounced + serialized writes) -------------------------------

let writeChain: Promise<void> = Promise.resolve();
let writeTimer: ReturnType<typeof setTimeout> | null = null;

/** Serialize writes (never interleave partial files); failures are silent. */
function persistNow(): Promise<void> {
  const snapshot = serializeQueue();
  const run = writeChain
    .then(() => internals.save(snapshot))
    .catch(() => {
      // Best-effort persistence: the in-memory queue (and its pending rows)
      // stay authoritative; the next mutation retries the write. A lost
      // write only means the entry doesn't survive an app kill — the same
      // tradeoff the web twin accepts for quota/private-mode failures.
    });
  writeChain = run;
  return run;
}

/** Debounced persist — coalesces bursts; debounceMs 0 writes immediately. */
function schedulePersist(): void {
  if (internals.debounceMs <= 0) {
    void persistNow();
    return;
  }
  if (writeTimer !== null) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    writeTimer = null;
    void persistNow();
  }, internals.debounceMs);
}

/**
 * Force any pending debounced write NOW and resolve when the file matches
 * memory. Test/app seam (the app relies on the 150ms debounce; a forced
 * drain could hook AppState "background" later).
 */
export function pendingPersist(): Promise<void> {
  if (writeTimer !== null) {
    clearTimeout(writeTimer);
    writeTimer = null;
    persistNow();
  }
  return writeChain;
}

function serializeQueue(): string {
  return JSON.stringify({
    version: OUTBOX_FILE_VERSION,
    entries: queue.map((entry) => ({
      tempId: entry.tempId,
      input: {
        cat: entry.input.cat,
        grp: entry.input.grp,
        amt: entry.input.amt,
        iso: entry.input.iso,
        pay: entry.input.pay,
        desc: entry.input.desc ?? null,
        user_id: entry.input.user_id ?? "",
      },
      queuedAt: entry.queuedAt,
    })),
  });
}

/**
 * Robust parse: anything unexpected (corrupt JSON, wrong shapes, garbage
 * entries) degrades to fewer/zero entries — boot must never crash on the
 * queue file.
 */
function parseOutboxFile(raw: string | null): OutboxEntry[] {
  if (raw === null || raw.length === 0) return [];
  try {
    const data = JSON.parse(raw) as { version?: unknown; entries?: unknown };
    if (data === null || typeof data !== "object" || !Array.isArray(data.entries)) {
      return [];
    }
    const out: OutboxEntry[] = [];
    for (const rawEntry of data.entries) {
      if (rawEntry === null || typeof rawEntry !== "object") continue;
      const e = rawEntry as Partial<OutboxEntry>;
      const input = e.input as Partial<OptimisticBeginInput> | undefined;
      if (typeof e.tempId !== "string" || !e.tempId.startsWith("temp-")) continue;
      if (input === undefined || input === null || typeof input !== "object") continue;
      if (typeof input.cat !== "string" || input.cat.length === 0) continue;
      if (typeof input.amt !== "string" || input.amt.length === 0) continue;
      if (typeof input.iso !== "string" || input.iso.length === 0) continue;
      if (typeof input.grp !== "string") continue;
      out.push({
        tempId: e.tempId,
        input: {
          cat: input.cat,
          grp: input.grp as OptimisticBeginInput["grp"],
          amt: input.amt,
          iso: input.iso,
          pay: input.pay,
          desc: input.desc ?? null,
          user_id: typeof input.user_id === "string" ? input.user_id : "",
        },
        queuedAt: typeof e.queuedAt === "number" ? e.queuedAt : 0,
      });
    }
    return out;
  } catch {
    return [];
  }
}

/** Strip the temp-row-only field before the network POST. */
function toCreateInput(input: OptimisticBeginInput): ExpenseCreateInput {
  return {
    cat: input.cat,
    grp: input.grp,
    amt: input.amt,
    iso: input.iso,
    pay: input.pay,
    desc: input.desc ?? null,
  };
}

// --- Queue primitive API -------------------------------------------------------

/**
 * Queue an expense for the outbox. Returns the temp row id the entry is
 * bound to. Default path ALSO registers the pending row via
 * beginOptimistic (list/dashboard show it immediately, like an online
 * optimistic create). FIFO append; beyond MAX_OUTBOX_ENTRIES the OLDEST
 * entries are dropped — their pending rows disappear with them
 * (failOptimistic), so nothing renders that can never resolve.
 *
 * `opts.bindTempId` — the add-screen's TEMP HANDOFF (T31.1): when an online
 * create fails network-shaped, the temp row already exists; bind the queue
 * entry to THAT id instead of registering a second row, so exactly one row
 * renders and flushAll() resolves the original.
 */
export function enqueue(
  input: OptimisticBeginInput,
  opts: { bindTempId?: string } = {},
): string {
  const tempId = opts.bindTempId ?? `temp-${internals.newId()}`;
  if (opts.bindTempId === undefined) {
    beginOptimistic(input, { tempId });
  }
  queue.push({ tempId, input: { ...input }, queuedAt: internals.now() });
  if (queue.length > MAX_OUTBOX_ENTRIES) {
    // Drop the OLDEST entries beyond the cap (they are the least likely to
    // still be relevant) and take their pending rows down with them.
    const dropped = queue.splice(0, queue.length - MAX_OUTBOX_ENTRIES);
    for (const entry of dropped) {
      failOptimistic(entry.tempId);
    }
  }
  notify();
  schedulePersist();
  return tempId;
}

let inFlightFlush: Promise<OutboxFlushReport> | null = null;

/**
 * Drain the queue FIFO, oldest first. Per-entry success → resolveOptimistic
 * (the temp row becomes the real row) + immediate file rewrite (the smallest
 * kill-window for a duplicate POST on next boot — re-sending is the safer
 * failure direction, same as the web twin). Per-entry failure → KEEP the
 * entry and STOP the run: over one broken transport every later send would
 * fail too, and strict FIFO order is preserved for when connectivity
 * returns. (Deliberate deviation from the web twin's "drop definite 4xx
 * rejects": the mobile add-screen never queues HTTP-status failures, so a
 * permanently-bad entry here would require schema drift — and cap-50
 * drop-oldest still evicts a stuck head within 50 new enqueues.)
 *
 * Single-flight: concurrent callers share the in-flight run (first sender
 * wins) — the _layout triggers (reconnect + foreground + boot) can pile up
 * safely.
 */
export function flushAll(sender: OutboxSender): Promise<OutboxFlushReport> {
  if (inFlightFlush !== null) return inFlightFlush;
  inFlightFlush = runFlush(sender).finally(() => {
    inFlightFlush = null;
  });
  return inFlightFlush;
}

async function runFlush(sender: OutboxSender): Promise<OutboxFlushReport> {
  let flushed = 0;
  while (queue.length > 0) {
    const entry = queue[0]; // FIFO — oldest first
    let created: Expense;
    try {
      created = await sender(toCreateInput(entry.input));
    } catch {
      // Transport/server failure → keep for the next trigger, stop the run.
      break;
    }
    queue.shift();
    flushed += 1;
    resolveOptimistic(entry.tempId, created);
    notify();
    await persistNow(); // durable removal BEFORE the next send
  }
  return { flushed, kept: queue.length };
}

/**
 * Boot hook: re-register persisted entries as pending optimistic rows so an
 * app restart doesn't lose (or un-show) offline expenses. Idempotent:
 *   - one hydrate per process (a second call is a no-op — no double-registers);
 *   - entries already queued in THIS process (same tempId, from enqueue's
 *     write racing the boot read) are skipped.
 * Persisted tempIds are restored verbatim (beginOptimistic's opts.tempId),
 * so the file never needs a rewrite after hydrate and a queued expense keeps
 * resolving the same row it showed before the restart.
 */
export async function hydrate(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  let parsed: OutboxEntry[];
  try {
    parsed = parseOutboxFile(await internals.load());
  } catch {
    parsed = []; // unreadable storage must never break boot
  }
  let changed = false;
  for (const entry of parsed) {
    // Already queued in this process (enqueue's persist raced this read) —
    // its optimistic row is already live; never register twice.
    if (queue.some((q) => q.tempId === entry.tempId)) continue;
    // Belt-and-braces: skip if the optimistic store already tracks the id.
    if (takePending().some((row) => row.id === entry.tempId)) continue;
    beginOptimistic(entry.input, { tempId: entry.tempId });
    queue.push(entry);
    changed = true;
  }
  if (queue.length > MAX_OUTBOX_ENTRIES) {
    const dropped = queue.splice(0, queue.length - MAX_OUTBOX_ENTRIES);
    for (const entry of dropped) {
      failOptimistic(entry.tempId);
    }
    changed = true;
  }
  if (changed) {
    notify();
    schedulePersist();
  }
}
