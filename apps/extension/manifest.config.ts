import { defineManifest } from "@crxjs/vite-plugin";
import pkg from "./package.json" with { type: "json" };

const localhost = ["http://localhost/*", "http://127.0.0.1/*"];

export default defineManifest({
  manifest_version: 3,
  name: "ALT",
  version: pkg.version,
  description: "Catches UI ↔ API mismatches in your localhost app.",
  minimum_chrome_version: "116",
  permissions: ["storage", "sidePanel", "alarms"],
  host_permissions: localhost,
  background: { service_worker: "src/background/index.ts", type: "module" },
  side_panel: { default_path: "src/panel/index.html" },
  action: { default_title: "ALT" },
  icons: { 16: "icons/icon-16.png", 48: "icons/icon-48.png", 128: "icons/icon-128.png" },
  content_scripts: [
    {
      js: ["src/hook/page-hook.iife.ts"],
      matches: localhost,
      run_at: "document_start",
      world: "MAIN",
    },
    {
      js: ["src/content/index.ts"],
      matches: localhost,
      run_at: "document_start",
    },
  ],
});
