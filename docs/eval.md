# Long-run eval results

## Run 1 - 2026-10-04

520 scripted turns against the real captain (haiku), seed 7, default rotation
(40 turns or 40% of context), nightly sleep every 100 turns. Command:
`node src/eval/run.ts --data <dir> --turns 520 --sleep-every 100 --model haiku`.

**Did not degrade.** 13 captain sessions; probes were answered 3 to 9 (avg
9.1) sessions after the fact was said. No turn errors.

| probe | n | accuracy | correct | stale | "don't have" | wrong | invented |
|---|---|---|---|---|---|---|---|
| recall/direct | 17 | **100%** | 17 | 0 | 0 | 0 | 0 |
| recall/paraphrase | 17 | **82.4%** | 14 | 0 | 3 | 0 | 0 |
| updated/direct | 3 | **100%** | 3 | 0 | 0 | 0 | 0 |
| updated/paraphrase | 3 | **33.3%** | 1 | 1 | 1 | 0 | 0 |
| never-said | 8 | **100%** | 8 | 0 | 0 | 0 | 0 |

- **No invented answers**: all 8 questions about things never said got "I
  don't have that"; every miss on a real fact was an honest "I don't have
  that", except one stale answer (below).
- **Citations**: all 35 correct answers cited an id; 100% of cited ids exist
  and 100% point at a record that holds the answer.
- Context per turn: avg 19k, p95 26k, max 30k tokens. Rotation always came
  from the 40-turn cap; the 40%-of-window trigger (80k for haiku) never fired.
- 4.7s per turn, 40 min total; captain cost $37 at list prices (on a
  subscription login it counts against usage, it is not billed).
- The nightly sleep changed nothing in all 5 runs: the captain had already
  saved every fact as it went. Its value is the digest and cleanup over
  weeks, which a one-hour run cannot show.

### Findings

1. **Stale history (fixed).** Asked "Which provider runs the inventory app for
   the shop customer?" after hosting moved from Hetzner to DigitalOcean, the
   captain answered Hetzner, citing L19, its own old reply. Memory was right
   (F2 superseded by F23), but ledger entries are history and nothing tied
   them to the facts that replaced them; worse, that wrong answer became a
   new ledger entry for later turns to find. Fix: `Memory.outdated()` links a
   ledger entry to facts saved from its turn, facts it cites and entries it
   cites; recall, `memory_search` and `memory_get` now mark such entries
   `[outdated: F2 was replaced by F23: ...]`, and the prompt says facts win.
   Re-asked 3 times on a copy of the run's memory: 3/3 DigitalOcean, citing F23.
2. **Paraphrase gap (open).** Direct questions 100%, paraphrased 82%: the 4
   misses are retrieval misses ("who handles my taxes" never reaches "my
   accountant is Bikash"). Keyword recall is the bottleneck, which is the
   brief's condition for adding embeddings.
