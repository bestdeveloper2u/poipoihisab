import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Excluded so a built copy of a spec can never run alongside its source
    // and pass on stale output. See scripts/audit-test-wiring.mjs.
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
