// ALT MAIN-world page hook. Declared in the manifest with world: "MAIN" at document_start, so it
// runs before page scripts and is exempt from the page's CSP. Bundled as a standalone IIFE.
import { installHook } from "./hook-core";

try {
  const w = window as Window & typeof globalThis & { __altHook?: boolean };
  if (!w.__altHook) {
    Object.defineProperty(w, "__altHook", { value: true });
    installHook(w);
  }
} catch {
  /* never break the page */
}
