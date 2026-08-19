import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    testTimeout: 15_000,
    // Run unit tests (no DB) and integration tests separately
    // Unit: security.test.ts, queue.test.ts
    // Integration: projects.test.ts (requires DATABASE_URL)
    include: ["src/tests/**/*.test.ts"],
  },
});
