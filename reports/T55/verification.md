# T55 verification

Implemented GET /api/agent-skills and Installed skills below the EXP tree.
Scans ~/.claude/skills, repository skills, and ~/.claude-work/skills read-only,
follows symlinks, deduplicates by frontmatter name, and retains all sources.
Missing roots and broken symlinks are skipped. Repository skills belong to
Wednesday; ~/.claude-work skills belong to ClipCrew. Descriptions normalize
frontmatter whitespace; cards show three lines with full text on hover.

Validation:
- pnpm typecheck: passed.
- pnpm test with inherited WEDNESDAY_*, MAJORDOMO_* and CLAUDE_CONFIG_DIR
  variables removed: 186 passed, 3 skipped (31 files passed, 1 skipped).
  Initial failures came from worker URL/tools environment overrides and running
  before dist existed. No unrelated source fixes were necessary.
- pnpm build: passed; dist generated locally and ignored by git.
- Real browser against http://127.0.0.1:4855/#/skills using preview.ts.
  Preview uses a temporary data directory and empty memory adapter; no SQLite,
  live database, captain inference, worker supervisor, or sleep scheduler.
- video-edit renders once with Wednesday and ClipCrew badges. Both paths resolve
  to /home/kb26/.jarvis/vendor/video-edit-skill/SKILL.md.
- Verified no horizontal overflow at 375, 768, 1024 and 1440px. Inspected desktop
  and mobile screenshots, with video-edit's source details expanded.
- Screenshots: installed-skills-desktop.png and installed-skills-mobile.png.

Deployment needs both a dist rebuild and server restart to load the new API.
No live server restart, push, merge, PR, or database/schema change performed.
