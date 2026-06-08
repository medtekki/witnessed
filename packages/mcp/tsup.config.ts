import { defineConfig } from "tsup";

export default defineConfig([
  // Library entry (importable building blocks).
  { entry: { index: "src/server.ts" }, format: ["esm"], dts: true, clean: true, sourcemap: true },
  // Executable CLI entry (`npx @witnessed/mcp`) with a shebang. No .d.ts; clean:false to keep index.
  {
    entry: { bin: "src/bin.ts" },
    format: ["esm"],
    dts: false,
    clean: false,
    sourcemap: true,
    banner: { js: "#!/usr/bin/env node" },
  },
]);
