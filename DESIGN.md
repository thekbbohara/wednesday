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
things: the conversation and a thin strip of faces.

## Layout
```
+--------------------------------------------------------------+
| [J] Jarvis  thinking...                  [a][b][c] agents     |  strip, 56px
+--------------------------------------------------------------+
|              ------------ Today ------------                  |
|  [J] reply (markdown, [F3] citation chips)                    |
|      saved F3 . updated T1                       receipts     |
|                               owner message bubble  [right]   |
|                                                               |
+--------------------------------------------------------------+
|  [ message Jarvis...                                ] [send]  |  composer
+--------------------------------------------------------------+
```
- One column, max 760px wide, centered. The page never scrolls; only the
  conversation does. It opens scrolled to the newest message and loads older
  ones when scrolled to the top.
- Nothing else: no sidebar, no settings, no tabs, no session or memory views.
  Session rotation is invisible; the chat is the ledger.

## Tokens (from agent-hq)
| Token        | Value     | Use |
|--------------|-----------|-----|
| --bg         | #eceff5   | page |
| --panel      | #ffffff   | strip, captain bubbles, composer |
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
- Shadow: strip and composer `0 1px 0 rgba(20,30,60,.04), 0 8px 24px -12px rgba(20,30,60,.12)`.
  Bubbles are flat (captain bubble 1px --line border).

## Components
- **Strip**: white bar, 56px, full width, content aligned to the 760 column.
  Left: Jarvis face (36px) + name (Fredoka 17) + state text (13 --muted):
  "here", "thinking..." (with the working face), "couldn't reply" (coral).
  Right: agent faces (28px) with their name on hover/focus as a tooltip.
  No agents: the right side is empty, no placeholder.
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
- < 760: column is full width with 12px gutters; strip 52px, agent faces
  scroll horizontally; bubbles max 88%; composer sticks to the bottom and
  respects the safe-area inset and the on-screen keyboard (100dvh).
- Verified at 375, 768, 1024, 1440.
