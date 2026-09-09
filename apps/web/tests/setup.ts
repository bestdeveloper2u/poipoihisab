import "@testing-library/jest-dom/vitest";
import { transferableAbortController } from "node:util";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

// jsdom's AbortSignal passes browser checks but Node's native Request rejects
// it before fetch runs. Keep the abort classes in the same realm as Request;
// obtain Node's originals from its native controller factory.
const nativeController = transferableAbortController();
globalThis.AbortController = nativeController.constructor as typeof AbortController;
globalThis.AbortSignal = nativeController.signal.constructor as typeof AbortSignal;

// The api-client reads VITE_API_URL once at module init. In the jsdom
// environment Node's undici Request cannot be constructed from a relative
// URL, so give tests an absolute base (mirrors the vite dev origin).
vi.stubEnv("VITE_API_URL", "http://127.0.0.1:5173");

// vitest runs with globals:false, so @testing-library/react's automatic
// cleanup does not register itself — do it explicitly.
afterEach(() => {
  cleanup();
});
