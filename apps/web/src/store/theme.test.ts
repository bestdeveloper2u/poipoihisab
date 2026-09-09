import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { THEME_KEY, isTheme, effectiveTheme } from "./theme";

/**
 * T27.1 — "system" theme option (ADR-0027). The theme store is a module
 * singleton whose DOM reflection and matchMedia subscription bind at import
 * time, so each test rebuilds the module with vi.resetModules + dynamic
 * imports after stubbing window.matchMedia (jsdom has no OS scheme to flip),
 * then drives the fake MediaQueryList exactly as the browser would deliver a
 * change event. Static imports of the pure helpers (effectiveTheme/isTheme)
 * are registry-independent and safe.
 */

type ThemeMod = typeof import("./theme");

interface FakeMql {
  media: string;
  readonly matches: boolean;
  onchange: null;
  addEventListener: (type: string, cb: (e: { matches: boolean }) => void) => void;
  removeEventListener: (type: string, cb: (e: { matches: boolean }) => void) => void;
  addListener: (cb: (e: { matches: boolean }) => void) => void;
  removeListener: (cb: (e: { matches: boolean }) => void) => void;
  /** Simulate the OS flipping the scheme (updates matches + fires change). */
  fire: (matches: boolean) => void;
  listenerCount: () => number;
}

/** MediaQueryList-like double: a real OS flip updates matches THEN fires. */
function makeFakeMql(initial: boolean): FakeMql {
  const listeners = new Set<(e: { matches: boolean }) => void>();
  let matches = initial;
  return {
    media: "(prefers-color-scheme: dark)",
    get matches() {
      return matches;
    },
    onchange: null,
    addEventListener: (_type, cb) => {
      listeners.add(cb);
    },
    removeEventListener: (_type, cb) => {
      listeners.delete(cb);
    },
    addListener: (cb) => {
      listeners.add(cb);
    },
    removeListener: (cb) => {
      listeners.delete(cb);
    },
    fire: (m) => {
      matches = m;
      for (const cb of [...listeners]) cb({ matches: m });
    },
    listenerCount: () => listeners.size,
  };
}

interface Setup {
  mod: ThemeMod;
  mql: FakeMql;
}

/** Fresh module instance per test (the store + watcher are import-time state). */
async function setup(
  opts: { stored?: string | null; dark?: boolean; withMatchMedia?: boolean } = {},
): Promise<Setup> {
  vi.resetModules();
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
  if (opts.stored != null) window.localStorage.setItem(THEME_KEY, opts.stored);
  const mql = makeFakeMql(opts.dark ?? false);
  if (opts.withMatchMedia !== false) {
    vi.stubGlobal("matchMedia", vi.fn(() => mql));
  } else {
    vi.stubGlobal("matchMedia", undefined);
  }
  const mod = (await import("./theme")) as ThemeMod;
  return { mod, mql };
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("effectiveTheme (pure mapping)", () => {
  it("system resolves through the OS dark-scheme flag", () => {
    expect(effectiveTheme("system", true)).toBe("dark");
    expect(effectiveTheme("system", false)).toBe("light");
  });

  it("explicit light/dark pass through regardless of the OS scheme", () => {
    expect(effectiveTheme("light", true)).toBe("light");
    expect(effectiveTheme("light", false)).toBe("light");
    expect(effectiveTheme("dark", false)).toBe("dark");
    expect(effectiveTheme("dark", true)).toBe("dark");
  });

  it("isTheme accepts exactly light/dark/system", () => {
    expect(isTheme("system")).toBe(true);
    expect(isTheme("light")).toBe(true);
    expect(isTheme("dark")).toBe(true);
    expect(isTheme("banana")).toBe(false);
    expect(isTheme(null)).toBe(false);
  });
});

describe("setTheme(\"system\") — pref vs DOM contract", () => {
  it("persists the pref verbatim but data-theme carries the resolved value", async () => {
    const { mod } = await setup({ dark: false });
    mod.useThemeStore.getState().setTheme("system");

    expect(window.localStorage.getItem(THEME_KEY)).toBe("system");
    expect(document.documentElement.dataset.theme).toBe("light"); // resolved
    expect(mod.useThemeStore.getState().theme).toBe("system"); // pref kept
  });

  it("an explicit pref persists and reflects unchanged", async () => {
    const { mod } = await setup({ dark: true });
    mod.useThemeStore.getState().setTheme("dark");

    expect(window.localStorage.getItem(THEME_KEY)).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});

describe("OS scheme flips (MediaQueryList change event)", () => {
  it("flips data-theme while pref=system, storage still holding 'system'", async () => {
    const { mql } = await setup({ stored: "system", dark: false });
    expect(document.documentElement.dataset.theme).toBe("light");

    mql.fire(true); // OS switches to dark
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(window.localStorage.getItem(THEME_KEY)).toBe("system");

    mql.fire(false); // and back to light
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("does NOT flip while pref=light", async () => {
    const { mql } = await setup({ dark: false });
    mql.fire(true);
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("does NOT flip while pref=dark", async () => {
    const { mql } = await setup({ stored: "dark", dark: true });
    mql.fire(false); // OS goes light — explicit dark pref must win
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});

describe("listener lifecycle", () => {
  it("detachSystemThemeWatcher unsubscribes the app-lifetime listener", async () => {
    const { mod, mql } = await setup({ stored: "system", dark: false });
    expect(mql.listenerCount()).toBe(1);

    mod.detachSystemThemeWatcher();
    expect(mql.listenerCount()).toBe(0);

    mql.fire(true); // nobody home — dataset must not move
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("watchSystemTheme re-subscribes and its unsubscribe stops updates", async () => {
    const { mod, mql } = await setup({ stored: "system", dark: false });
    mod.detachSystemThemeWatcher();

    const un = mod.watchSystemTheme();
    expect(mql.listenerCount()).toBe(1);

    mql.fire(true);
    expect(document.documentElement.dataset.theme).toBe("dark");

    un();
    expect(mql.listenerCount()).toBe(0);
    mql.fire(false);
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("watchSystemTheme falls back to addListener-style MQLs (old Safari)", async () => {
    vi.resetModules();
    window.localStorage.clear();
    delete document.documentElement.dataset.theme;
    // MQL with ONLY the deprecated listener pair.
    const listeners = new Set<(e: { matches: boolean }) => void>();
    let matches = false;
    const legacy = {
      media: "(prefers-color-scheme: dark)",
      get matches() {
        return matches;
      },
      addEventListener: undefined,
      addListener: (cb: (e: { matches: boolean }) => void) => {
        listeners.add(cb);
      },
      removeListener: (cb: (e: { matches: boolean }) => void) => {
        listeners.delete(cb);
      },
    };
    vi.stubGlobal("matchMedia", vi.fn(() => legacy));
    const mod = (await import("./theme")) as ThemeMod;
    window.localStorage.setItem(THEME_KEY, "system");
    mod.useThemeStore.getState().setTheme("system");
    expect(document.documentElement.dataset.theme).toBe("light");

    matches = true;
    for (const cb of [...listeners]) cb({ matches: true });
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});

describe("degraded environments", () => {
  it("corrupt stored value (\"banana\") falls back to light everywhere", async () => {
    const { mod } = await setup({ stored: "banana", dark: true });
    expect(mod.useThemeStore.getState().theme).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    // …and stays out of storage until the user actively picks a theme.
    expect(window.localStorage.getItem(THEME_KEY)).toBe("banana");
  });

  it("matchMedia missing: system resolves light, setTheme/watch never crash", async () => {
    const { mod } = await setup({ stored: "system", withMatchMedia: false });

    // Init reflected the stored pref through the light fallback.
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(mod.useThemeStore.getState().theme).toBe("system");

    mod.useThemeStore.getState().setTheme("system"); // re-apply, no crash
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(window.localStorage.getItem(THEME_KEY)).toBe("system");

    mod.useThemeStore.getState().setTheme("dark"); // explicit pref still works
    expect(document.documentElement.dataset.theme).toBe("dark");

    expect(() => mod.watchSystemTheme()).not.toThrow();
    expect(mod.watchSystemTheme()).toBeTypeOf("function");
  });
});

describe("i18n", () => {
  it("themeSystem exists in both dictionaries", async () => {
    const { W } = (await import("../lib/web-i18n")) as typeof import("../lib/web-i18n");
    expect(W.bn.themeSystem).toBe("সিস্টেম");
    expect(W.en.themeSystem).toBe("System");
    expect(Object.keys(W.en).sort()).toEqual(Object.keys(W.bn).sort());
  });
});
