import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/KV.ts",
    "src/D1.ts",
    "src/R2.ts",
    "src/Queue.ts",
    "src/DurableObject.ts",
    "src/Cache.ts",
    "src/AI.ts",
    "src/AIGateway.ts",
    "src/Vectorize.ts",
    "src/Hyperdrive.ts",
    "src/Worker.ts",
    "src/Browser.ts",
    "src/Pipeline.ts",
    "src/Errors.ts",
    "src/Testing.ts",
  ],
  format: ["esm"],
  target: "es2022",
  dts: true,
  external: ["effect"],
});
