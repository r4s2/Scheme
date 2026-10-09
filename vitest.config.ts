import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/engine/**/*.ts", "src/lib/**/*.ts"],
      exclude: ["src/**/__tests__/**", "src/engine/index.ts", "src/engine/types.ts", "src/lib/supabase/**"],
    },
  },
});
