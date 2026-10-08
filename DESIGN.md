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
       +----------------+ +------------------------------------------+
 +--+  |  +--------+    | | Crew  6 agents . 2 working . 1 needs you  |
 |CC|  |  |  face  |    | | [a] [b] [c] [d] [e] [ ] [ ]              |
 |Sk|  |  +--------+    | | [f] [ ] [ ] [ ] [ ] [ ] [ ]               |
 |Tk|  |  Wednesday Lv 7   | +------------------------------------------+
 |Me|  |  ====---- exp  |
 |St|  +----------------+ +------------------------------------------+
 +--+  | <page title>                                                |
 nav   |   Command Center | Skills | Tasks | Memory | Settings       |
       |                                                             |
       +-------------------------------------------------------------+
```
- Page max width 1280, centered, padding 24. Nav pill 64 wide on the left,
  vertically centered (as in the sketch).
- Top band, 236px tall: portrait card 300 wide + roster card filling the rest,
  gap 16. Below, gap 16: the page card fills the remaining height. The page
  itself never scrolls on desktop; only the content inside the page card does.
- Pages: **Command Center** (default), **Skills**, **Tasks**, **Memory**,
  **Runtime usage and credits**, **Settings**. Runtime usage lives at `/usages`;
  other pages use the URL hash (`#/tasks`) so reloads and the back button keep it. The chat stays mounted while another page is
  open, so its scroll position and draft survive.
- Session rotation is invisible; the chat is the ledger.

## Tokens (from agent-hq)
| Token        | Value     | Use |
|--------------|-----------|-----|
| --bg         | #eceff5   | page |
| --panel      | #ffffff   | cards, captain bubbles, composer |
| --panel-2    | #f4f6fa   | chips, input fill, hover |
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
  areas: portrait, roster, page card, and the nav pill radius 999).
- **Portrait card**: Wednesday face 96px centered at the top, then name (Fredoka
  600 22) with a level badge ("Lv 7", Fredoka 600 13, --blue-deep on 14%
  tint, radius 999), then the overall EXP bar (6px, radius 999, --blue fill on
  --panel-2) with "1,240 / 1,500 exp" (12 --muted, mono digits), then one row:
  status pill + "Active 2m ago". The model tag sits in the card's top-right
  corner (mono 11 --muted).
  - Status pill: dot + label, background the state color at 14%: here (mint),
    thinking (blue-deep), couldn't reply (coral), offline (--sleep).
- **Roster card**: like agent-hq's roster. Head: "Crew" (Fredoka 600 18) and
  the stats line "6 agents . 2 working . 1 needs you" (counts colored mint,
  amber, coral). Grid of 72px-wide, 80px-tall tiles: 60px face + 11px name (two rows fill the card); columns fill the
  width; padded to two full rows with empty slots (--panel-2 rounded squares,
  radius 28% like a face). Past two rows the grid scrolls. Faces open the agent
  popover; an empty slot puts "Start an agent to " in the composer and focuses
  it. Hover a face: the tooltip (name + state).
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
  the card. Thread content max width 760, centered in the card.
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
- **Composer**: white pill, autosizing textarea (1 to 8 lines), Enter sends,
  Shift+Enter newline, round --blue-deep send button (disabled when empty).
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
- 760-1099: the nav becomes a horizontal pill above the top band (buttons in
  a row, same order); portrait 260 wide; same 236 band.
- < 760: single column, 12px gutters, page scrolls only inside the thread.
  The nav is a bottom tab bar (6 buttons, 56 tall, safe-area inset) instead
  of a pill. Compact portrait (face 52, name, level, EXP bar in one row), roster as one horizontally scrolling
  row of 44px faces with the stats line; the Command Center takes the rest
  of the height (100dvh). Bubbles max 88%; composer respects the safe-area
  inset and the on-screen keyboard.
- Verified at 375, 768, 1024, 1440.


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
