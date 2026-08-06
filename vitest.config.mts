import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // External scanner integration can legitimately cross 15s on cold Python/
    // Semgrep startup. Unit fixtures still opt out unless testing that path.
    testTimeout: 60000
  }
});
