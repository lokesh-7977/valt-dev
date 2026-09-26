import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { mockApi } from "./server/mock-api";

export default defineConfig({
  plugins: [react(), mockApi()],
  build: {
    rollupOptions: {
      input: { main: "index.html", csp: "csp-strict.html" },
    },
  },
  server: { port: 5180, strictPort: true },
  preview: { port: 5180, strictPort: true },
});
