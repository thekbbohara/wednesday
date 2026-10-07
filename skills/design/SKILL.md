---
name: design
description: >
  Visual work for the owner: frontend builds, pages, UI, visual reports,
  dashboards, guides and review artifacts. Picks a named style from the
  project's need, customer and brand (never a silent default), writes it into
  DESIGN.md before building, builds exactly to it, and verifies pixel by pixel
  in a real browser before shipping.
  Use when: "design", "UI", "UX", "page", "landing", "dashboard", "redesign",
  "make it look", "style", "DESIGN.md", "visual report", "frontend".
  NOT for: video and motion (use the hyperframes skills), pure copywriting.
---

# Design

All visual work: frontend builds, pages, visual reports, dashboards, guides
and review artifacts. The output is judged by eye, so the job is done only when
it has been looked at in a real browser at every breakpoint.

## 1. Style selection (reason first)

- The design comes from the project's need, its customer and its brand. Ask:
  what does the project need, who is the customer, what does the brand stand
  for?
- Pick the named style from `references/styles.md` (curated 24) that serves
  that driver, and write the reason into DESIGN.md. Every choice is justified.
- No silent fallback. Dark premium is not a default; use it only when it serves
  the project: developer tools, premium brands, a dark brand identity.
- Starting points (still justify against the driver):

  | Deliverable              | Usual fit          | When it does not apply                     |
  |--------------------------|--------------------|--------------------------------------------|
  | Tech doc / guide         | Terminal brutalist | consumer product with a warmer brand       |
  | App / UI / web           | Dark premium       | the customer or brand calls for another    |
  | Visual report / dashboard| Dark premium       | report for a brand with its own identity   |
  | Review artifact          | Dark premium       | artifact previewing another product's style|

- Style rules: start every visual prompt with the style name; mix at most two
  styles in a hybrid; offer 3-4 style directions when the owner needs to
  choose; if a style name lands generic, spell out its core DNA instead.
- Guides and docs are never boring markdown. Terminal style reference:
  https://thekbbohara.github.io/arch-linux-guide/ - monospace type, terminal
  command blocks, numbered sections, uppercase micro-headings, blocky layout.

## 2. DESIGN.md first

- Check the project for DESIGN.md before anything else.
- It exists: it is the single source of truth. Follow it exactly.
- It is missing: create it FIRST, before building. Keep it a short contract:
  - **style**: the named style or starting point AND why it fits (need /
    customer / brand)
  - **tokens**: colors, type, spacing, radius, shadows
  - **components**: cards, buttons, nav, tables, forms
  - **motion**: durations, easings, what animates and what stays still
  - **responsive**: breakpoints and what changes at each
- Build exactly to DESIGN.md. A forced deviation updates DESIGN.md first, then
  the build.

## 3. Build, verify, review

- Build to the contract. Clean and minimal: every element earns its place.
- Verify in a real browser before calling it done (the `chrome-devtools-axi`
  skill when present, else any headless browser): screenshot at 375, 768, 1024
  and 1440 wide, check alignment, spacing rhythm, overflow, and hover / active
  / focus states. Fix what looks off, then screenshot again.
- When the `lavish` skill is present, open the deliverable in it
  (`lavish-axi <file>`, then `lavish-axi poll`) so the owner can annotate it,
  and apply their feedback.
- Report back with the screenshots' paths, the style chosen and why, and what
  is left open.

## Dark premium tokens (only when justified)

Dark premium, minimal, one accent.

| Token      | Value    | Use                                          |
|------------|----------|----------------------------------------------|
| --bg       | #09090b  | page background                              |
| --surface  | #111114  | cards, panels                                |
| --surface2 | #161619  | raised surfaces, hover                       |
| --text     | #eae7e2  | primary text                                 |
| --muted    | #5a5a5e  | secondary text, labels                       |
| --border   | #1e1e22  | hairlines, borders                           |
| --accent   | #e8793a  | single accent; partner #f5a623 for gradients |
| radius     | 16px/8px | cards / small elements                       |

- Type: Outfit 300-800 for UI and headings; system mono for code and data.
  Headings: tight tracking (-0.02em to -0.03em), fluid clamp() scale, 1.05-1.15
  line height. Micro-labels: uppercase, 11-13px, letter-spacing 0.1-0.18em,
  muted color.
- Motion: 0.2-0.3s, cubic-bezier(.16,1,.3,1), subtle and purpose-driven. No
  cinematic camera-style animation in data or report UI. Respect
  prefers-reduced-motion.
- One accent color, used with restraint. No idle decoration.

## Quality bar

- Pixel-perfect: alignment, spacing rhythm, every interactive state, no
  overflow at 375 / 768 / 1024 / 1440.
- Copy: plain, blunt, builder voice. Short. No filler. Never an em dash; use a
  plain dash "-".
- Fix lint or test failures and flakiness you notice, even unrelated ones.
- Quality, simplicity, robustness and scalability over development cost.
