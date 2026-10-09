#!/usr/bin/env bash
# Move the legacy data folder ~/.jarvis to ~/.wednesday, leaving the symlink
# ~/.jarvis -> ~/.wednesday so absolute paths keep working: agent worktrees, git
# worktree metadata, systemd units and paths stored in memory.db.
#
#   scripts/migrate-data-dir.sh           dry run: checks and reports, changes nothing
#   scripts/migrate-data-dir.sh --apply   move and symlink (only when nothing blocks)
#
# Blockers: wednesday-captain.service (or any other wednesday-*/majordomo-* user
# unit) active, or a node/claude process whose cwd, binary or arguments are inside
# ~/.jarvis. Stop them first. Files elsewhere that mention ~/.jarvis are listed,
# never edited.
set -euo pipefail

apply=0
case "${1:-}" in
  '') ;;
  --apply) apply=1 ;;
  -h|--help) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
  *) echo "unknown argument: $1 (use --apply or --help)" >&2; exit 2 ;;
esac

src="$HOME/.jarvis"
dst="$HOME/.wednesday"
blockers=0
block() { echo "  BLOCK  $*"; blockers=$((blockers + 1)); }
warn() { echo "  warn   $*"; }
inside() { case "$1" in "$src"|"$src"/*) return 0 ;; *) return 1 ;; esac; }

echo "Data folder migration: $src -> $dst ($([ $apply = 1 ] && echo apply || echo dry run))"

# --- State -------------------------------------------------------------------
if [ -L "$src" ]; then
  target=$(readlink -f "$src" || true)
  if [ "$target" = "$(readlink -f "$dst" 2>/dev/null || true)" ] && [ -d "$dst" ]; then
    echo "Already migrated: $src is a symlink to $dst. Nothing to do."
    exit 0
  fi
  echo "$src is a symlink to $target, not the expected $dst. Fix it by hand." >&2
  exit 1
fi
if [ ! -d "$src" ]; then
  echo "No $src folder. Nothing to migrate."
  exit 0
fi
if [ -e "$dst" ] || [ -L "$dst" ]; then
  echo "$dst already exists. Merge or remove it by hand; this script never merges." >&2
  exit 1
fi
if [ "$(stat -c %d "$src")" != "$(stat -c %d "$(dirname "$dst")")" ]; then
  echo "$src and $(dirname "$dst") are on different filesystems; mv would copy. Aborting." >&2
  exit 1
fi
echo "Size: $(du -sh "$src" 2>/dev/null | cut -f1)"

# --- Blockers ----------------------------------------------------------------
echo
echo "Checks:"
if command -v systemctl >/dev/null 2>&1; then
  active=$(systemctl --user list-units --state=active --plain --no-legend 'wednesday-*' 'majordomo-*' 2>/dev/null | awk '{print $1}' || true)
  for u in $(printf '%s\n' wednesday-captain.service $active | sort -u); do
    if systemctl --user is-active --quiet "$u" 2>/dev/null; then block "unit $u is active (systemctl --user stop $u)"; fi
  done
fi

others=0
for p in /proc/[0-9]*; do
  pid=${p#/proc/}
  [ "$pid" = "$$" ] && continue
  [ -O "$p" ] || continue
  cwd=$(readlink "$p/cwd" 2>/dev/null) || continue
  exe=$(readlink "$p/exe" 2>/dev/null || true)
  comm=$(cat "$p/comm" 2>/dev/null || true)
  args=$(tr '\0\n' '  ' < "$p/cmdline" 2>/dev/null || true)
  hit=0
  if inside "$cwd" || inside "$exe"; then hit=1; fi
  case " $args " in *" $src/"*|*"=$src/"*|*" $src "*) hit=1 ;; esac
  [ $hit = 1 ] || continue
  short=$(printf '%s' "$args" | cut -c1-120)
  case "$comm" in
    node|claude|MainThread) block "pid $pid $comm (cwd $cwd): $short" ;;
    *) case "$exe" in
         */node|*/claude|*/claude-*) block "pid $pid $comm (cwd $cwd): $short" ;;
         *) warn "pid $pid $comm (cwd $cwd): $short"; others=$((others + 1)) ;;
       esac ;;
  esac
done
if [ $blockers = 0 ]; then echo "  ok     no active Wednesday units and no node/claude process inside $src"; fi
if [ $others -gt 0 ]; then echo "         ($others other process(es) inside $src keep working through the rename; restart them after.)"; fi

# --- External references (read only) -----------------------------------------
echo
echo "Files outside $src that mention it (kept working by the symlink; update when convenient):"
refs=$(
  {
    for f in "$HOME"/.config/systemd/user/*.service "$HOME"/.config/systemd/user/*.timer "$HOME"/.config/systemd/user/*.d/*.conf \
             "$HOME"/.bashrc "$HOME"/.zshrc "$HOME"/.profile "$HOME"/.zprofile "$HOME"/.config/fish/config.fish \
             "$HOME"/.claude/settings.json "$HOME"/.claude.json "$HOME"/kb/jarvis/.env; do
      [ -f "$f" ] && [ ! -L "$f" ] && grep -qsF -e "$src" -e '~/.jarvis' "$f" && echo "  $f"
    done
    for f in "$HOME"/.config/systemd/user/*; do
      [ -L "$f" ] && inside "$(readlink "$f")" && echo "  $f -> $(readlink "$f") (symlink)"
    done
    if command -v crontab >/dev/null 2>&1 && crontab -l 2>/dev/null | grep -qF -e "$src" -e '~/.jarvis'; then echo "  crontab -l"; fi
    for g in "$src"/worktrees/*/.git; do
      [ -f "$g" ] || continue
      meta=$(sed -n 's/^gitdir: //p' "$g")
      [ -n "$meta" ] && [ -f "$meta/gitdir" ] && ! inside "$meta" && echo "  $meta/gitdir (git worktree metadata)"
    done | sort -u
  } 2>/dev/null
)
if [ -n "$refs" ]; then echo "$refs"; else echo "  none found"; fi
n=0
if [ -d "$HOME/.claude/projects" ]; then
  n=$(find "$HOME/.claude/projects" -maxdepth 1 -name "$(printf '%s' "$src" | tr '/.' '--')*" | wc -l)
fi
if [ "$n" -gt 0 ]; then echo "  $HOME/.claude/projects: $n session folder(s) keyed by $src paths (Claude Code history per folder)"; fi

# --- Act ---------------------------------------------------------------------
echo
if [ $blockers -gt 0 ]; then
  echo "Refusing: $blockers blocker(s). Stop them and run again."
  exit 1
fi
if [ $apply = 0 ]; then
  echo "Dry run: would run"
  echo "  mv $src $dst"
  echo "  ln -s $dst $src"
  echo "Run with --apply to do it."
  exit 0
fi
mv "$src" "$dst"
if ! ln -s "$dst" "$src"; then
  echo "Symlink failed; moving the folder back." >&2
  mv "$dst" "$src"
  exit 1
fi
echo "Moved. $src -> $dst"
echo "Unset WEDNESDAY_DATA_DIR / MAJORDOMO_DATA_DIR if they point at $src, or point them at $dst."
