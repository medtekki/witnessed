import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// The publishable packages point `main`/`exports` at built `dist/` for consumers; in-repo
// tests resolve them to source so no build is needed to run the suite.
const src = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@witnessed\/core$/, replacement: src("./packages/core/src/index.ts") },
      { find: /^@witnessed\/verifier$/, replacement: src("./packages/verifier/src/verify.ts") },
      { find: /^@witnessed\/sdk$/, replacement: src("./packages/sdk/src/client.ts") },
    ],
  },
  test: { include: ["packages/**/test/**/*.test.ts", "test/**/*.test.ts"] },
});
