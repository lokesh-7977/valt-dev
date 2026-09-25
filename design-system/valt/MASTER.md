# VALT Design System — MASTER

Global source of truth for how VALT looks, feels, and moves. Page-specific overrides live in
`design-system/valt/pages/<page>.md` and win over this file for that page only.

**Direction: Apple-grade calm.** Quiet surfaces, confident type, one blue, generous space, soft
depth, motion that feels physical and never showy. The product (an AI assistant) should feel like a
precise instrument, not a neon demo.

**Provenance.** Base from `ui-ux-pro-max` searches (2026-09-25): style *Minimalism & Swiss Style*
(`--domain style "apple minimal premium clean"`), palette *Monochrome + blue accent*
(`--domain color "monochrome neutral premium blue accent"`), typography *Inter, system-first*
(`--domain typography "system font apple clean"`). Adapted toward Apple's Human Interface
conventions: neutral grays, one blue, translucent materials, larger radii, and soft shadows. The
style's defaults (0 radius, no shadow) are replaced. Rejected from the tool's generated system: the
AI-purple palette and `back.out` overshoot motion.

---

## 1. Principles

1. **Content is the interface.** Chrome recedes: hairline dividers, translucent bars, no heavy
   borders or boxed-in everything.
2. **One accent.** Blue marks what you can act on. Everything else is grayscale. Never two competing
   accent colors on one screen.
3. **Type does the hierarchy.** Size and weight carry structure before color, borders, or icons do.
4. **Space is a feature.** When in doubt, add space, not a divider.
5. **Depth is subtle.** Layers separate by material (translucency, blur) and soft shadow, never hard
   outlines or dramatic drop shadows.
6. **Motion explains.** Every animation communicates cause and effect (where something came from,
   where it went). It's fast, eased, and interruptible, and it disappears under reduced motion.

## 2. Color tokens

shadcn/ui variable names, so components pick them up automatically. Values checked for WCAG AA
contrast (ratios below).

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--background` | `#FBFBFD` | `#000000` | page |
| `--foreground` | `#1D1D1F` | `#F5F5F7` | primary text (16.3 / 19.3) |
| `--card` | `#FFFFFF` | `#1C1C1E` | raised surfaces |
| `--card-foreground` | `#1D1D1F` | `#F5F5F7` | |
| `--popover` | `#FFFFFF` | `#2C2C2E` | menus, popovers |
| `--popover-foreground` | `#1D1D1F` | `#F5F5F7` | |
| `--primary` | `#0071E3` | `#0071E3` | primary buttons, key actions; white text 4.70 |
| `--primary-foreground` | `#FFFFFF` | `#FFFFFF` | |
| `--secondary` | `#F5F5F7` | `#2C2C2E` | secondary buttons, grouped backgrounds |
| `--secondary-foreground` | `#1D1D1F` | `#F5F5F7` | |
| `--muted` | `#F5F5F7` | `#1C1C1E` | subtle fills |
| `--muted-foreground` | `#6E6E73` | `#86868B` | secondary text (4.91 / 5.80) |
| `--accent` | `#F0F0F5` | `#2C2C2E` | hover/selected fills (shadcn "accent" = neutral highlight) |
| `--accent-foreground` | `#1D1D1F` | `#F5F5F7` | |
| `--link` | `#0071E3` | `#2997FF` | inline links (4.54 / 6.96) |
| `--destructive` | `#D70015` | `#FF453A` | errors, destructive actions (5.21 / 6.16) |
| `--success` | `#248A3D` | `#30D158` | success states |
| `--warning` | `#B25000` | `#FF9F0A` | warnings |
| `--border` | `#D2D2D7` | `#38383A` | hairline dividers (decorative) |
| `--input` | `#86868B` | `#6E6E73` | form control borders (3.62 / 3.36, meets 3:1) |
| `--ring` | `#0071E3` | `#2997FF` | focus ring |

Rules:
- No raw hex in components. Use tokens only (`bg-card`, `text-muted-foreground`).
- Status colors always come with an icon or text label.
- Dark mode is true black background with elevated grays for layers, not an inverted light theme.

## 3. Typography

- **Font stack:** `-apple-system, BlinkMacSystemFont, "SF Pro Text", var(--font-inter), system-ui, sans-serif`.
  Apple devices get SF, and everything else gets Inter (self-hosted via `next/font`, no external
  request). SF Pro is not licensed for web embedding, so never ship the font files.
- **Mono:** `ui-monospace, "SF Mono", var(--font-geist-mono), Menlo, monospace` for code and IDs.
- **Features:** `font-feature-settings: "cv11", "ss01"` for Inter, plus tabular numbers
  (`tabular-nums`) in tables and counters.

| Role | Size / line-height | Weight | Tracking | Tailwind |
| --- | --- | --- | --- | --- |
| Display | 56–80px / 1.05 | 600 | -0.025em | `text-display` |
| Title 1 | 40px / 1.1 | 600 | -0.022em | `text-title-1` |
| Title 2 | 28px / 1.15 | 600 | -0.018em | `text-title-2` |
| Title 3 | 21px / 1.25 | 600 | -0.012em | `text-title-3` |
| Body | 17px / 1.47 | 400 | -0.01em | `text-body` |
| Callout | 15px / 1.4 | 400 | -0.005em | `text-callout` |
| Footnote | 13px / 1.38 | 400 | 0 | `text-footnote` |

Tailwind classes set size, line-height, and tracking. Add the weight explicitly (`font-semibold` on
titles and display). Rules: minimum 13px for any readable text, sentence case everywhere (no ALL-CAPS labels except tiny
eyebrow text at 12px/600/+0.04em), max line length ~70ch, use `text-balance` on headings.

## 4. Space, layout, shape

- **Spacing scale:** 4, 8, 12, 16, 20, 24, 32, 40, 56, 80, 120px. Sections breathe at 80–120px on
  desktop and 56px on mobile.
- **Containers:** `max-w-[980px]` for reading and marketing, `max-w-[1200px]` for app workspaces,
  side gutters of 16px (mobile), 24px (tablet), and 40px (desktop).
- **Radius:** `--radius: 0.875rem` (14px). Buttons and inputs 10–12px, cards 18px, sheets and dialogs
  22px, pills fully rounded. Nested radius = outer radius − padding.
- **Grid:** 12 columns, gap 24px. Keep layouts centered and symmetric (variance 2/10).
- **Touch targets:** ≥ 44×44px.

## 5. Depth and materials

| Layer | Treatment |
| --- | --- |
| Base | `--background`, no shadow |
| Card | `--card`, `shadow-soft`: `0 1px 2px rgb(0 0 0 / .04), 0 4px 16px rgb(0 0 0 / .04)`, no border in light mode; `1px --border` in dark |
| Floating (popover, menu) | `shadow-float`: `0 4px 12px rgb(0 0 0 / .08), 0 16px 48px rgb(0 0 0 / .12)` |
| Bars (nav, toolbars, composer) | material: `bg-background/72 backdrop-blur-xl backdrop-saturate-150` + bottom hairline |
| Modal scrim | `bg-black/30` light, `bg-black/50` dark, 200ms fade |

Always provide a solid fallback when `backdrop-filter` is unsupported (`@supports`).

## 6. Motion

| Token | Value | Use |
| --- | --- | --- |
| `--ease-standard` | `cubic-bezier(0.25, 0.1, 0.25, 1)` | most transitions |
| `--ease-out-expo` | `cubic-bezier(0.16, 1, 0.3, 1)` | entrances, reveals |
| `--ease-sheet` | `cubic-bezier(0.32, 0.72, 0, 1)` | sheets, drawers, dialogs (iOS-like) |
| `--dur-fast` | 150ms | hover, press |
| `--dur-base` | 250ms | state changes, popovers |
| `--dur-slow` | 400ms | page-level reveals, sheets |

Rules:
- Animate only `transform` and `opacity` (plus `filter: blur` sparingly for materials).
- Press feedback: `active:scale-[0.98]` at 150ms on buttons and cards.
- Exits are faster than entrances (about 70% of the duration).
- No overshoot and bounce on informational UI. Staggers are ≤ 40ms per item, at most 8 items.
- Streaming AI text doesn't animate per token. Show a soft pulsing caret or a shimmer skeleton only
  until the first token arrives.
- `prefers-reduced-motion: reduce` means no transforms, and opacity fades only at ≤ 150ms.
- CSS transitions first. Add a motion library only for layout/shared-element transitions, loaded
  lazily. GSAP is not used.

## 7. Components (shadcn/ui variants)

- **Button:** default = filled `--primary`, 44px tall (`h-11`), 12px radius, weight 500, 15–17px.
  `secondary` = `--secondary` fill. `ghost` for toolbars. `link` uses `--link`. Pill (`rounded-full`)
  for the single hero CTA.
- **Input / Textarea:** `bg-card`, `border-input`, 12px radius, 44px min height, focus =
  `ring-4 ring-ring/25 border-ring` with no glow.
- **Card:** 18px radius, `shadow-soft`, 24–32px padding, no header dividers.
- **Navigation:** sticky translucent bar, 52px tall, centered content, and at most 5 top-level items.
- **Lists:** inset grouped style (iOS Settings), meaning rounded group container, hairline separators
  inset from the leading edge, and chevrons for drill-in.
- **Dialogs:** use sheet motion (`--ease-sheet`), 22px radius, and a max width of 560px.
- **Icons:** Lucide at 1.5px stroke, 18–20px, `currentColor`. No emoji as icons.
- **Chat (AI):**
  - User messages are right-aligned `--secondary` bubbles, and assistant text sits unboxed on the
    background with a full reading width.
  - Composer is a floating material bar with 22px radius and 17px text.
  - Approval prompts (LangGraph interrupts) are cards with clear Approve (primary) and Reject
    (secondary) buttons.

## 8. Anti-patterns (don't)

- Gradients on text, neon glows, purple-to-blue "AI" gradients, glassmorphism on everything.
- More than one accent color, colored section backgrounds, or heavy borders around every card.
- Center-aligned body paragraphs longer than two lines.
- Placeholder-only labels, icon-only buttons without `aria-label`.
- Skeleton shimmer longer than about 1.5s without a status message.
- Fixed pixel widths that cause horizontal scroll.

## 9. Pre-delivery checklist

- [ ] Only tokens used; light and dark both checked
- [ ] Text contrast ≥ 4.5:1, control boundaries ≥ 3:1, focus ring visible
- [ ] Type roles from §3 only; headings balanced; nothing below 13px
- [ ] One accent per screen; status colors paired with icon or label
- [ ] Touch targets ≥ 44px; keyboard reachable; `aria-live` on streamed text
- [ ] Motion uses the §6 tokens, only transform/opacity, reduced-motion respected
- [ ] Responsive at 375, 768, 1024, 1440; no horizontal scroll
- [ ] Translucent bars have a solid fallback
