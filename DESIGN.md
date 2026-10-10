# Wednesday design contract

## Style
**Game studio, light** (agent-hq's roster screen), with the chat as its
command center.

Why: the owner talks to one PA all day and runs a crew of agents through it.
The owner's sketch (2026-10-04) asks for agent-hq's character-select layout:
a nav pill on the left, Wednesday as the hero portrait, the crew as a roster of
faces, and one big panel whose first page is the Command Center chat. Wednesday's
skills are gamified (levels and EXP). The faces, body colors and palette are
agent-hq's, so nothing is new to learn. Light and soft because it stays open
all day next to dark terminals.

## Layout
```
 +--+  +---------------------------------------------------------------+
 |CC|  | (face) Wednesday Lv 6 . here | [faces] Crew is resting  Roster | usage meters
 |Sk|  +---------------------------------------------------------------+
 |Tk|  | Command Center                        [Needs you 10] [Crew live 0]
 |Me|  | Needs you  |           thread (centered)          | Crew live  |
 |St|  | rows, Now  |           composer                   | (if busy)  |
 +--+  +---------------------------------------------------------------+
```
- Fullscreen shell (2026-10-09): no max-width letterbox; the app owns the
  viewport edge-to-edge. Padding 16 (20 at >=1600), grid `56px + 12px gap`
  (`64/16` at >=1600). Nav pill 56 wide, vertically centered on the left. The
  page background is a barely-there vertical tint shift (--bg to --bg-deep).
- **HUD** (Command Center redesign "Bridge", 2026-10-09): one 72px card on top
  of every page replaces the old 236px portrait / roster / usage band. Below
  it the page card fills the remaining height. The page itself never scrolls
  on desktop; only the content inside the page card does.
- Pages: **Command Center** (default), **Skills**, **Tasks**, **Memory**,
  **Runtime usage and credits**, **Settings**. Runtime usage lives at `/usages`;
  other pages use the URL hash (`#/tasks`) so reloads and the back button keep it. The chat stays mounted while another page is
  open, so its scroll position and draft survive.
- Session rotation is invisible; the chat is the ledger.

## Tokens (from agent-hq)
| Token        | Value     | Use |
|--------------|-----------|-----|
| --bg         | #eceff5   | page (top of the fullscreen tint shift) |
| --bg-deep    | #e6eaf3   | page bottom of the tint shift |
| --panel      | #ffffff   | cards, captain bubbles, composer |
| --panel-2    | #f4f6fa   | chips, input fill, hover |
| --panel-3    | #edf0f6   | inset wells: pending shimmer, empty EXP track |
| --line       | #e1e5ee   | hairlines |
| --ink        | #1a2130   | primary text, owner bubble fill |
| --muted      | #6c7588   | secondary text, receipts, day labels |
| --faint      | #a3aabb   | placeholders, disabled |
| --blue       | #5cbdf4   | Wednesday body color |
| --blue-deep  | #2b8fd8   | focus ring, send button, citation chip text |
| --mint       | #4fd1a5   | working |
| --amber      | #ffb547   | needs you |
| --coral      | #ff6b6b   | error notice |
| --sleep      | #c6ccd8   | offline |

Agent body colors by runtime, as agent-hq: claude-code #5cbdf4, codex #7c8cf8,
pi #b28cf5, opencode #4fd1a5, kimi #f78fb3, other #8fb3c9.

- Type: **Fredoka** 600 for the name "Wednesday" and day labels; **Inter** 400-600
  for everything else; **JetBrains Mono** for ids (F3, T1, L42) and code.
- Scale: 12 / 13 / 15 / 17. Message text 15/1.55. Micro-labels 11px uppercase,
  0.12em tracking, --muted.
- Spacing: 4px base. Gap between messages 16; between a reply and its
  receipts 6; between turns from the same side 4.
- Radius: bubble 18 (the corner toward the speaker 6), chip 999, composer 22,
  button 999.
- Shadow: cards and composer `0 1px 0 rgba(20,30,60,.04), 0 8px 24px -12px rgba(20,30,60,.12)`.
  Bubbles are flat (captain bubble 1px --line border).

## Components
- **Card**: white, radius 22, the panel shadow, padding 20 (all four main
  areas: HUD, roster sheet, page card, and the nav pill radius 999).
- **HUD** (72 tall, card radius 22, padding 0 18 0 14, gap 20, 1px x 36
  --line separators). Three zones:
  - **Me**: Wednesday face 44, name (Fredoka 600 19) + "Lv 6" pill + status
    dot and label ("here", "thinking...", coral "couldn't reply") + model
    (mono 11); under it the EXP bar (132 x 5) and "3,520 / 4,050" (mono 11).
  - **Crew** (flexes): a stack of 34px faces overlapping by 9px inside a 2px
    white ring - busy agents first, needs-you leading (max 4); when nobody is
    busy, three resting faces with only the last one's "z". Then the title
    (Fredoka 600 15: "eagleeye needs you" / "3 agents at work" / "Crew is
    resting") over the stats line (12 --muted, counts mint / amber / coral).
    A "Roster 71" ghost pill on the right opens the roster sheet. Faces open
    the agent popover.
  - **Usage** (>=1100): four meters, 112 wide (CPU/RAM 76, hidden <1280):
    engine in use, next account, CPU, RAM. 11px label + mono percentage over
    a 5px bar; blue-deep for allowances, --blue for system load, #c84949 and
    a slow pulse at <=10%. Polls /api/credits and /api/system every 60s
    while the tab is visible; click opens /usages.
- **Roster sheet**: the agent-hq roster card (grid of 72x80 tiles, empty
  slots, scroll fade) dropped under the HUD's crew zone, 760 max wide, 420
  tall (60dvh max), lifted shadow + hairline. Closes on Esc, outside click or
  the Roster pill; clicks inside the agent popover it opened keep it open.
- **Nav rail**: a vertical pill (64 wide, padding 12 0, radius 999), centered
  on the left. One 44px button per page (radius 14): a 22px line icon in
  --muted; hover --panel-2; the active page is --blue-deep on a 14% tint of
  it. Tooltip with the page name to the right on hover/focus. Tasks shows a
  small amber count badge when tasks wait on the owner; Command Center shows
  a blue dot when a reply arrived while another page was open.
- **Page card**: white card; head row with the page title (Fredoka 600 18) on
  the left and the page's controls on the right (filter pills, search box);
  content scrolls under the head with the same soft top edge as the thread.
- **Skills page**: responsive grid of skill cards (min 220 wide, gap 16).
  Card: --panel-2 fill, radius 18, padding 16; badge (40px, skill color at
  16%) + name (Fredoka 600 17) + "Lv 3" pill in the skill color; EXP bar
  (8px, skill color); "65 / 200 exp to Lv 4" (mono 11 --muted); what it
  covers (13 --muted, 2 lines); last 3 EXP events (+30 finished T12 ...).
  Clicking a card opens the skill popover with the full recent list.
- **Skill popover**: icon + name + level badge, EXP bar with numbers, "Earns
  EXP from" line (task created +5, task finished +30, done by an agent +20),
  then the last 8 EXP events: "+30 finished T12 Fix login" with task chips.
  Empty: "No EXP yet. Tasks tagged Coding earn it."
- **Tasks page**: filter pills in the head (Open, Waiting on you, Done, All;
  counts in each). Rows (min 52 tall, hairline between): task chip, title
  (15/500), skill badge (20px), status pill, agent face (20px) when an agent
  works on it, updated time (12 --muted, right). Click a row to expand: goal,
  plan, result (13, pre-wrap), citations clickable.
- **Memory page**: search box in the head (searches facts and the ledger,
  with the same engine Wednesday uses). Sections with micro-labels: **Now** (the
  note, in a --panel-2 block), **Facts** (rows: F chip, kind tag, subject
  600 14, body 14, source chip, updated date; "show outdated" toggle reveals
  stale facts struck through with their replacement chip), **Digests** (one
  row per day: date + summary line, expands to the digest). With a query:
  results grouped Facts / Tasks / Ledger, outdated ledger hits marked.
- **Settings page**: one column, max 640, groups with micro-labels:
  **Captain** (model select, web access toggle), **Sessions** (rotate at %
  of context, max turns), **Nightly sleep** (time or off, model), and
  **About** (read-only: data folder, token on/off, agent runtimes, skills
  file). Controls save on change with a small "Saved" confirmation next to
  the control; invalid values show the reason in coral under the field.
  Toggle: 40x24 pill, --blue-deep when on.
- **Skill colors**: coding #5cbdf4, design #f78fb3, marketing #ffb547, hacking
  #4fd1a5, research #7c8cf8, writing #b28cf5, ops #8fb3c9. Custom skills from
  skills.json bring their own color and a monogram instead of an icon.
- **Level-up row** (in the chat): like the agent row, with the skill badge
  (20px) instead of a face; clicking the badge opens the Skills page: "**Coding** reached level 3" in --ink 13, the
  level in the skill color.
- **Command Center card**: title "Command Center" (Fredoka 600 18) at the top
  left, then the thread (scrolls), then the composer pinned at the bottom of
  the card. Thread and composer share one centered column, max width 820
  (bubbles hug their content; prose paragraphs cap at 72ch).
- **Agent popover**: the popover component, 360 max. Head: face 28 + name
  (600 14) + status pill. Rows (12/13): task chip + title, runtime, branch or
  folder (mono), why it needs you (amber) when it does, then its last report
  (max 8 lines, scroll), then "Copy attach command" (ghost button).
- **Agent row** (in the chat): a 13px --muted line at captain indent, with the
  agent's 20px face: "scraper finished a turn" / "scraper needs you:
  permission prompt" (amber text) / "scraper stopped" / "scraper exited with
  code 1" (coral), followed by its ledger chip (opens the full report).
- **Face**: agent-hq `Face` (rounded square, body = runtime color, expression
  = state, badge for needs/error/offline).
- **Captain message**: face 28px at the top-left, white bubble, markdown
  (paragraphs, lists, code, tables, links). Ids like [F3], [T1], [L42] render
  as mono chips; clicking one opens a small popover with the record (what it
  says, when, its source). Citations are how the owner checks memory.
- **Receipts**: under a captain message, one 12px --muted line of what the
  captain wrote to memory during that turn: "saved F3 . updated T1 . updated
  now". Each id is a chip. Omitted when nothing was written.
- **Overnight row**: after the nightly sleep, one row at captain indent like
  the agent row: Wednesday's face asleep (closed eyes, 20px), 13px --muted text
  "Overnight I tidied memory: 3 new facts, 1 updated, 2 outdated" and the
  digest's ledger chip (opens the day's digest). The sleep's own fact
  receipts are never shown; nothing else about the sleep is.
- **Owner message**: right-aligned, --ink fill, white text, max 80% width,
  plain text with line breaks kept.
- **Pending**: while the captain works, a captain row with the working face
  and three dots. Owner messages sent meanwhile appear at once and are
  answered together in the next turn.
- **Error notice**: centered 13px coral text in a coral-tinted pill
  ("Wednesday couldn't reply: <reason>") with a **Retry** button.
- **Day separator**: centered micro-label "Today" / "Yesterday" / "Mon 3 Oct".
- **Time**: 12px --muted 24h time on hover of a message (title attribute on
  desktop, shown under the bubble on tap on touch).
- **Composer**: white pill, the engine chip at its start (--panel-2 pill,
  32 tall, --blue square dot, chevron; changing it sends `/engine <id>`),
  autosizing textarea (1 to 8 lines), Enter sends, Shift+Enter newline, round
  --blue-deep send button (disabled when empty).
  Focus: 2px --blue-deep ring. Draft survives reloads (localStorage).
- **Popover**: white panel 360 max wide, radius 14, shadow, closes on Esc or
  outside click. Opens under what was clicked (left-aligned), from the right
  edge for roster faces.

## Motion
- 0.2s cubic-bezier(.16,1,.3,1) for new messages (fade + 6px rise), popover,
  focus.
- Working face mouth bob 1.2s; pending dots 1.2s stagger; blink every ~5s.
- New messages only auto-scroll when the owner is already at the bottom;
  otherwise a "new messages" pill appears above the composer.
- Everything off under prefers-reduced-motion.

## Responsive
- >= 1100: layout above.
- 760-1099: the nav becomes a horizontal pill above the HUD (buttons in a
  row, same order); the HUD drops its usage meters.
- < 760: single column, 12px gutters, page scrolls only inside the thread.
  The nav is a bottom tab bar (6 buttons, 56 tall, safe-area inset) instead
  of a pill. HUD 60 tall: face 36, name, level, EXP bar, the crew stack and a
  count-only Roster pill; the Command Center takes the rest of the height
  (100dvh). Bubbles max 88%; composer respects the safe-area
  inset and the on-screen keyboard.
- Verified at 390, 900, 1180, 1440, 1600.


## Runtime usage and credits (T48)

Reason: the owner needs to choose among authenticated runtimes using account
allowances, so usage gets the dedicated /usages page, a prominent link at the top of
Settings, and a nav item between Memory and Settings.
The existing light roster system remains the design source: white page card,
--panel-2 account cards, --line dividers, 18px radius and 16px grid gaps.

- Account grid: columns at least 320px, collapsing to one column on phones.
  Use the existing page__body so all providers remain reachable by scrolling
  inside the page card. Keep the title and Refresh control pinned in PageHead.
- Card: runtime name at 17px, status pill at 11px, local credential source path
  and non-secret account id at 11px mono. Long ids wrap instead of overflowing.
- Allowance rows: independent provider windows, 13px label and bold remaining
  percentage. An 8px rounded bar shows remaining allowance, blue-deep normally
  and #c84949 at 10% or less. Unknown remaining values never get a bar.
- Provider-specific allowances retain their reported scope. Opaque provider
  names remain visible without guessing their meaning. Credit balances and
  spending caps get separate rows; no cap never implies unlimited funds.
- Status: Reported uses #d9f3e9 / #17684d; Stale uses #fff0d7 / #845000;
  Unavailable uses the existing neutral line color. Reasons are readable
  #a33939 text, with no credential values or raw provider error bodies.
- Show source, fetched time and last check time on every card. Dates include
  the browser timezone. Missing reset times say "Reset time not reported".
  Stale data keeps its original fetched time and an explicit warning.
- Refresh is at least 44px tall. Explain the 60-second cache beside the grid;
  polling happens only while this page is mounted. Never substitute session
  context, local token usage, model prices or a spending cap for account funds.
- Mobile nav has six equal controls, each at least 44px wide at 375px. The
  chat stays mounted and its composer draft survives navigation as before.

The Settings entry is a --panel-2 inset card with a 44px minimum-height link
labelled "View all runtime usage and credits". Its real href is /usages; normal
clicks use history navigation so the mounted chat and draft survive. Direct
navigation, reload, back/forward and the older #/credits link resolve correctly.
/usages and /usage chat commands share these collectors, record a concise
provider report, and never invoke an inference turn. Chat reset times are
explicit UTC; the page shows browser-local times with timezone abbreviations.

## Known gaps

The existing design contract is prose-only and has no YAML token front matter.
The design.md linter reports this as one warning and zero errors. T48 preserves
that established format rather than rewriting the unrelated design contract.

## Plan canvas (T53)

Plan lives at `#/plan`, between usage and Settings, in the existing white page
card. It follows the Game studio, light tokens, Inter body and Fredoka heading.
The mobile nav now has seven controls, each at least 44px wide.
Board controls and editing tools wrap above a clipped, dotted --panel-2 canvas.
Notes use the existing amber, blue, mint and skill pink tints; idea cards are
white with 18px radius. Frames use a soft blue tint and dashed --line border.
Selection and arrows use --blue-deep. A compact inspector edits selection;
on phones it narrows to 132px. Zoom controls stay in the footer. Canvas motion
is direct manipulation, without transitions. Long source text scrolls inside
items, while canvas pan and zoom stay independent of the page shell.

## Installed agent skills (T55)

Below the EXP tree, Installed skills lists actual agent capabilities in the same
responsive grid, --panel-2 cards, 18px radius and 16px gaps. Fredoka names,
13px descriptions and blue place pills distinguish Wednesday and ClipCrew.
Descriptions wrap to readable text; expandable sources show every original
SKILL.md path and resolved symlink target in wrapping monospace. Refresh reads
current installations, and loading, empty and error states stay in this section.

## Premium detailing (2026-10-09)

Direction: dqnamo-kitchen-level finish and an intelligent, alive product feel -
premium over animation. The world above is unchanged; this section records the
elevation layer. All motion stays inside the existing 0.2s system ease and the
global prefers-reduced-motion kill switch; new JS effects (scramble) detect
reduced-motion and resolve instantly.

- **Fullscreen shell** - see Layout: the app owns the viewport; background is a
  2% vertical tint shift (--bg to --bg-deep), fixed attachment.
- **New tokens** - --bg-deep (background tint), --panel-3 (inset wells: pending
  shimmer track, empty EXP track), --shadow-lift (hover elevation), --ring
  (focus glow recipe; composer uses a 2px solid ring per component spec).
- **Elevation once** - cards and composer carry the panel shadow only; credit
  cards keep border-only elevation and gain hover lift; skill cards lift 2px
  on hover; nothing stacks 1px border under a wide shadow except the composer
  (shadow + inset hairline, a deliberate well).
- **Intelligence signifiers** - changing numbers decrypt: HUD EXP, crew
  stats counts and /usages remaining percentages scramble through random
  digits for ~320ms before settling (`web/useScramble.ts`). Captain bubbles
  materialize on arrival (0.25s blur-in). The pending state is a 72px shimmer
  bar sweeping a --panel-3 track inside the captain bubble, next to the
  working face. Status dots (working blue, needs-you amber) pulse at their own
  tempos; allowance bars at <=10% pulse coral.
- **Tactile press** - nav, segment, roster tile, plan toolbar/footer/inspector,
  pill and ghost buttons scale to 0.96 on :active; the send button is a
  gradient disc with an inset top highlight that compresses on press; the
  toggle knob squeezes while held. Nav active item carries a 3px blue-deep
  accent bar inside the button.
- **Chips** - citation/ledger chips are sharp 6px-radius squares, mono 11px,
  blue-deep on a 10% tint, deepening to 18% on hover with a 0.94 press scale.
- **Numbers** - tabular numerals on EXP readouts, level pills, segment counts,
  skill card nums, credit percentages and clock times so ticking values
  don't jitter.
- **Browser surfaces** - themed scrollbars (8px, --line thumb on transparent
  track, --faint on hover) on thread, page bodies and row lists; text
  selection is a blue-deep 22% tint; carets are blue-deep.
- **Component finishes** - day separators are flanked by 1px --line rules;
  owner bubbles carry a soft top inner highlight; the error notice is a
  coral-tinted pill with a leading dot, hairline ring and Retry; Settings
  "Saved" is a mint chip with a drawn check glyph; Settings errors lead with
  a coral dot; task rows indent 4px when open; allowance bars have rounded
  caps; the roster tile hover lifts the face 2px.

## Live status rails (2026-10-09, reworked as "Bridge")

The Command Center shows what needs the owner without a click, and spends no
space on empty panels.

- **Rails follow content.** Left "Needs you" shows while any task is
  waiting_owner or blocked; right "Crew live" while any agent is working,
  needs the owner, errored or holds a task. The head pills ("Needs you 10"
  amber count, "Crew live 3" blue count, grey 0) pin a rail open or shut, and
  the pin persists in localStorage (`majordomo:rails:v2`, null = auto).
- **Inline at >=1400**: a 3-column grid (rails 300 / 280 default, drag the
  inner edge to resize 220-420, persisted). Rails sit inside the page card,
  separated from the thread by a 1px --line.
- **Needs you** rows: amber 9% wash with a 30% amber hairline, radius 14: T
  chip, title (13/600, 2 lines), meta line (skill dot + skill name + age, or
  "blocked") and a "Reply" text button that prefills "About T8 (title): ".
  The row opens Tasks. Tasks of one project (first word before a colon,
  "ClipCrew: ..." / "ClipCrew premium edit: ...") collapse into a --panel-2
  group row "ClipCrew · 7 waiting" that expands in place; children drop the
  project name. Newest first. The Now note (5 lines, --panel-2) and the
  "N open tasks" link sit at the rail's foot.
- **Crew live** cards: face 24, name, state pill, T chip + task title, reason
  (2 lines). Needs-you and errored cards carry tinted rings. Footnote "N
  resting". When pinned open with nobody busy: a centered resting face, "The
  crew is resting", and "Start an agent".
- **Below 1400** there are no side rails and nothing overlays the chat: a
  40px banner above the thread names what waits ("10 need you · T22 ..., +8",
  amber wash) and who is busy (faces + "3 busy"); it opens a drop panel
  inside the page card with both rails side by side (stacked on phones).
  Esc, outside click or the banner closes it. No banner when nothing waits
  and nobody is busy. The head pills open the same panel.
- Rail data (tasks + memory) refreshes every 60s and on every server event.

## Files in the chat (T84)

The owner attaches files three ways: the paperclip button (36px, --muted
line icon, left of the textarea; hover --line circle), dropping files anywhere
on the Command Center (a dashed 2px --blue-deep frame, radius 18, over the
card with a "Drop to attach" pill in Fredoka 600 17), and pasting (a pasted
screenshot is named screenshot.png). Each file uploads at once.

- **Tray**: a row inside the composer pill, above the textarea. Images and
  videos are 64px tiles (radius 14, cover-cropped; video gets a centered play
  glyph and its size); other files are 64px tall chips (36px --blue-deep 12%
  tint square with the extension in mono 10, name 13/600, size 12 --muted).
  Every item has a 20px dark round remove (x) at the top-right; removing one
  deletes its upload. While uploading, the tile dims, the badge shows the
  percent and a 4px --blue-deep bar fills along the bottom. A failed upload
  gets a --coral ring. Send waits until every upload is done.
- **In messages**: files sit beside the bubble, outside it: right-aligned
  above the owner's text, under the captain's bubble at captain indent, at most
  420 wide. One image shows whole (max 320 tall, radius 18, 1px --line); two or
  more make a 2-column grid of square crops (radius 12, gap 4). Videos keep
  their own shape (max 360 tall, radius 18, --ink behind) with native
  controls; audio is a white card with the name and a player; other files are
  the file chip (radius 14, white, 1px --line). A markdown image in a captain
  reply renders in place inside the bubble. A file the browser cannot show
  falls back to the chip.
- **Full size**: clicking an image opens a lightbox (--ink at 86%, image
  contained, name 13/600 white, "Open original" and close as translucent
  white pills); Esc, the close button or a click outside closes it.
- The owner's own "(Web: I attached ...)" notes are for the captain; the chat
  shows the files instead.
