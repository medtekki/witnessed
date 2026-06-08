import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/verify.ts" },
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
});
