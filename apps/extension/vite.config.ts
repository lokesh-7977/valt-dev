import { crx } from "@crxjs/vite-plugin";
import preact from "@preact/preset-vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import manifest from "./manifest.config";

export default defineConfig({
  plugins: [preact(), tailwindcss(), crx({ manifest })],
  build: { emptyOutDir: true },
});
