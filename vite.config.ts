import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";

// Standard TanStack Start / Nitro build for Vercel. No Lovable wrapper.
// The existing src/server.ts is retained as a minimal standard server entry.
export default defineConfig({
  plugins: [
    tsconfigPaths(),
    tanstackStart({ server: { entry: "./server.ts" } }),
    nitro(),
    viteReact(),
    tailwindcss(),
  ],
});
