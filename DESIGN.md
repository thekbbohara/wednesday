# Jarvis design contract

## Style
**Game studio, light, reduced to a messenger** (Anthropomorphic faces on a
calm chat surface).

Why: the owner talks to one PA all day, in one chat that never ends. The
screen should feel like a messenger with a person, not a dashboard. The
characters are the same ones agent-hq uses (step 3 drives the same agents), so
the faces, body colors and palette carry over and the owner reads them without
learning anything new. Light and soft because it stays open all day next to
dark terminals. agent-hq grew too many panels; Jarvis keeps exactly two
things: the conversation and a hero card with the faces of the agents.

## Layout
```
+--------------------------------------------------------------+
| +------+ Jarvis                       [a] [b] [c]            |  hero card
| | face | [captain] [opus]             3 agents . 1 working   |  (floating,
| +------+ (o) here   Active 2m ago     . 1 needs you          |   radius 22)
+--------------------------------------------------------------+
|              ------------ Today ------------                  |
|  [J] reply (markdown, [F3] citation chips)                    |
|      saved F3 . updated T1                       receipts     |
|  [a] scraper finished a turn  L42                agent row    |
|                               owner message bubble  [right]   |
+--------------------------------------------------------------+
|  [ message Jarvis...                                ] [send]  |  composer
+--------------------------------------------------------------+
```
- One column, max 760px wide, centered. The page never scrolls; only the
  conversation does. It opens scrolled to the newest message and loads older
  ones when scrolled to the top.
- The header is agent-hq's hero card (the owner picked it): a floating white
  card, not a full-bleed bar, so the page reads like agent-hq.
- Nothing else: no sidebar, no settings, no tabs, no session or memory views.
  Session rotation is invisible; the chat is the ledger.

## Tokens (from agent-hq)
| Token        | Value     | Use |
|--------------|-----------|-----|
| --bg         | #eceff5   | page |
| --panel      | #ffffff   | hero card, captain bubbles, composer |
| --panel-2    | #f4f6fa   | chips, input fill, hover |
| --line       | #e1e5ee   | hairlines |
| --ink        | #1a2130   | primary text, owner bubble fill |
| --muted      | #6c7588   | secondary text, receipts, day labels |
| --faint      | #a3aabb   | placeholders, disabled |
| --blue       | #5cbdf4   | Jarvis body color |
| --blue-deep  | #2b8fd8   | focus ring, send button, citation chip text |
| --mint       | #4fd1a5   | working |
| --amber      | #ffb547   | needs you |
| --coral      | #ff6b6b   | error notice |
| --sleep      | #c6ccd8   | offline |

Agent body colors by runtime, as agent-hq: claude-code #5cbdf4, codex #7c8cf8,
pi #b28cf5, opencode #4fd1a5, kimi #f78fb3, other #8fb3c9.

- Type: **Fredoka** 600 for the name "Jarvis" and day labels; **Inter** 400-600
  for everything else; **JetBrains Mono** for ids (F3, T1, L42) and code.
- Scale: 12 / 13 / 15 / 17. Message text 15/1.55. Micro-labels 11px uppercase,
  0.12em tracking, --muted.
- Spacing: 4px base. Gap between messages 16; between a reply and its
  receipts 6; between turns from the same side 4.
- Radius: bubble 18 (the corner toward the speaker 6), chip 999, composer 22,
  button 999.
- Shadow: hero card and composer `0 1px 0 rgba(20,30,60,.04), 0 8px 24px -12px rgba(20,30,60,.12)`.
  Bubbles are flat (captain bubble 1px --line border).

## Components
- **Hero card** (header): white card, radius 22, the panel shadow, 16px from
  the page top, padding 16 20, aligned to the 760 column.
  - Left: Jarvis face 64px (radius 28% of size, as agent-hq), then name
    (Fredoka 600 22), a row of pills (`captain` on --panel-2 mono 12, model
    name the same), then a row with the status pill and "Active 2m ago"
    (12 --muted, time of the last reply).
  - Status pill: dot + label, background the state color at 14%: here (mint),
    thinking (blue-deep), couldn't reply (coral), offline (--sleep).
  - Right: agent faces (32px) in a row that wraps to at most two lines, then
    a stats line under them like agent-hq's roster head: "3 agents . 1 working
    . 1 needs you" with the counts colored (mint, amber, coral for errors).
    No agents: the right side says "No agents yet" in --faint.
  - Faces are buttons: hover shows the tooltip (name + state); click opens the
    agent popover.
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
- **Owner message**: right-aligned, --ink fill, white text, max 80% width,
  plain text with line breaks kept.
- **Pending**: while the captain works, a captain row with the working face
  and three dots. Owner messages sent meanwhile appear at once and are
  answered together in the next turn.
- **Error notice**: centered 13px coral text in a coral-tinted pill
  ("Jarvis couldn't reply: <reason>") with a **Retry** button.
- **Day separator**: centered micro-label "Today" / "Yesterday" / "Mon 3 Oct".
- **Time**: 12px --muted 24h time on hover of a message (title attribute on
  desktop, shown under the bubble on tap on touch).
- **Composer**: white pill, autosizing textarea (1 to 8 lines), Enter sends,
  Shift+Enter newline, round --blue-deep send button (disabled when empty).
  Focus: 2px --blue-deep ring. Draft survives reloads (localStorage).
- **Popover**: white panel 360 max wide, radius 14, shadow, closes on Esc or
  outside click.

## Motion
- 0.2s cubic-bezier(.16,1,.3,1) for new messages (fade + 6px rise), popover,
  focus.
- Working face mouth bob 1.2s; pending dots 1.2s stagger; blink every ~5s.
- New messages only auto-scroll when the owner is already at the bottom;
  otherwise a "new messages" pill appears above the composer.
- Everything off under prefers-reduced-motion.

## Responsive
- >= 760: layout above.
- < 760: column is full width with 12px gutters; the hero card is compact:
  face 44, pills and "Active" on one line, margin 8 from the top; agent faces
  (28) scroll horizontally in a row under it with the stats line beside them.
  Bubbles max 88%; composer sticks to the bottom and respects the safe-area
  inset and the on-screen keyboard (100dvh).
- Verified at 375, 768, 1024, 1440.
