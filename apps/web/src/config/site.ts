/**
 * Product identity and navigation — the first file to edit when the problem statement lands.
 * Keep nav to at most 5 items (MASTER §7).
 */
export const siteConfig = {
  name: "VALT",
  tagline: "Understand anything in seconds.",
  description:
    "Drop in text, documents, images, or a voice note. Get a clear analysis and the next step to take.",
  nav: [
    { href: "/analyze", label: "Analyze" },
    { href: "/dashboard", label: "Overview" },
    { href: "/kit", label: "UI kit", devOnly: true },
  ],
  primaryCta: { href: "/analyze", label: "Start an analysis" },
  home: {
    eyebrow: "AI analysis, powered by Gemini",
    capabilities: [
      { icon: "text", title: "Text", body: "Notes, emails, reports — paste anything." },
      { icon: "file", title: "Documents", body: "PDFs and text files, read end to end." },
      { icon: "image", title: "Images", body: "Photos, screenshots, and scans." },
      { icon: "audio", title: "Voice", body: "Record a note or upload audio." },
    ],
    steps: [
      { title: "Add your input", body: "Type, upload, snap a photo, or record." },
      { title: "AI analyzes it", body: "Gemini reads every format together." },
      { title: "Act on it", body: "A clear summary and the next step to take." },
    ],
  },
} as const;

export type NavItem = (typeof siteConfig.nav)[number];

export const navItems: readonly NavItem[] = siteConfig.nav.filter(
  (item) => !("devOnly" in item && item.devOnly) || process.env.NODE_ENV !== "production",
);
