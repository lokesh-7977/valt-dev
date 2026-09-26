/**
 * Route identity: many concrete URLs (`/invoices/12`, `/invoices/13`) are one logical page
 * (`/invoices/:id`). ALT visits each logical page once and dedupes tests by it.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX = /^[0-9a-f]{12,}$/i;
const DIGITS = /^\d+$/;
// Prefixed record numbers: INV-0042, inv_12, ord12, PO-2024-0007.
const PREFIXED_NUMBER = /^[a-z]{1,5}[-_]?\d{2,}(?:[-_]\d+)*$/i;

function isIdSegment(seg: string): boolean {
  return DIGITS.test(seg) || UUID.test(seg) || HEX.test(seg) || PREFIXED_NUMBER.test(seg);
}

export function routeKeyFromPath(pathname: string): string {
  const segments = pathname
    .split("/")
    .filter(Boolean)
    .map((seg) => {
      let decoded = seg;
      try {
        decoded = decodeURIComponent(seg);
      } catch {
        // keep raw segment
      }
      return isIdSegment(decoded) ? ":id" : decoded;
    });
  return "/" + segments.join("/");
}

/** Pathname-only logical route: query and hash dropped, trailing slash removed, ids → `:id`. */
export function routeKey(url: string): string {
  try {
    return routeKeyFromPath(new URL(url).pathname);
  } catch {
    return routeKeyFromPath(url.split(/[?#]/)[0] ?? "/");
  }
}

export function originOf(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.origin : null;
  } catch {
    return null;
  }
}

const FILE_EXT =
  /\.(pdf|zip|gz|tgz|rar|7z|csv|xlsx?|docx?|pptx?|png|jpe?g|gif|svg|webp|ico|mp3|mp4|mov|avi|webm|wav|dmg|exe|msi|apk|json|xml|txt)$/i;

export interface CrawlOptions {
  /** The anchor has a `download` attribute. */
  download?: boolean;
  /** The current page URL (hash-only links to it are not new pages). */
  currentUrl?: string;
}

/** Same-origin http(s) page links only — no mailto/tel/js, no downloads, no in-page anchors. */
export function isCrawlable(href: string, baseOrigin: string, opts: CrawlOptions = {}): boolean {
  if (!href || opts.download) return false;
  const trimmed = href.trim();
  if (/^(mailto|tel|javascript|data|blob|about|file|chrome|ftp):/i.test(trimmed)) return false;
  if (trimmed.startsWith("#")) return false;
  let u: URL;
  try {
    u = new URL(trimmed, opts.currentUrl ?? baseOrigin + "/");
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  if (u.origin !== baseOrigin) return false;
  if (FILE_EXT.test(u.pathname)) return false;
  if (opts.currentUrl) {
    try {
      const cur = new URL(opts.currentUrl);
      if (u.hash && cur.pathname === u.pathname && cur.search === u.search) return false;
    } catch {
      // ignore
    }
  }
  return true;
}

/** Absolute URL without hash (what the worker tab navigates to). */
export function normalizeUrl(href: string, base: string): string | null {
  try {
    const u = new URL(href, base);
    u.hash = "";
    return u.toString();
  } catch {
    return null;
  }
}
