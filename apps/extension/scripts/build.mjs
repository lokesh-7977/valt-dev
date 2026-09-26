// Bundles the ALT extension into dist/ (load it unpacked from chrome://extensions).
//   node scripts/build.mjs          one-off build
//   node scripts/build.mjs --watch  rebuild on change
import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { writeIcons } from "./icons.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "dist");
const watch = process.argv.includes("--watch");

const common = {
  bundle: true,
  target: "chrome116",
  logLevel: "info",
  sourcemap: "linked",
  legalComments: "none",
};

const entries = [
  { entryPoints: [join(root, "src/background/index.ts")], outfile: join(out, "background.js"), format: "esm" },
  { entryPoints: [join(root, "src/content/index.ts")], outfile: join(out, "content.js"), format: "iife" },
  { entryPoints: [join(root, "src/content/main-world.ts")], outfile: join(out, "main-world.js"), format: "iife", sourcemap: false },
  { entryPoints: [join(root, "src/sidepanel/panel.ts")], outfile: join(out, "sidepanel.js"), format: "iife" },
];

function copyStatic() {
  mkdirSync(out, { recursive: true });
  copyFileSync(join(root, "manifest.json"), join(out, "manifest.json"));
  copyFileSync(join(root, "src/sidepanel/index.html"), join(out, "sidepanel.html"));
  copyFileSync(join(root, "src/sidepanel/panel.css"), join(out, "sidepanel.css"));
  writeIcons(out);
}

// Re-copies static assets whenever a watched build finishes.
const staticPlugin = { name: "alt-static", setup: (b) => b.onEnd(() => copyStatic()) };

rmSync(out, { recursive: true, force: true });
copyStatic();

if (watch) {
  const contexts = await Promise.all(
    entries.map((e) => esbuild.context({ ...common, ...e, plugins: [staticPlugin] })),
  );
  await Promise.all(contexts.map((c) => c.watch()));
  console.log("ALT: watching for changes…");
} else {
  await Promise.all(entries.map((e) => esbuild.build({ ...common, ...e })));
  console.log(`ALT: built ${out}`);
}
