#!/usr/bin/env bash
# Makes the design skill loadable by Wednesday's worker agents (Claude Code
# loads ~/.claude/skills). No sudo; it only adds a symlink.
set -eu
here="$(cd "$(dirname "$0")" && pwd)"
skill_root="$(cd "$here/.." && pwd)"
dest="$HOME/.claude/skills/design"
mkdir -p "$HOME/.claude/skills"
if [ -e "$dest" ] && [ ! -L "$dest" ]; then
  echo "note: $dest exists and is not a symlink; leaving it. Point it at $skill_root yourself if you want the Wednesday version."
else
  ln -sfn "$skill_root" "$dest"
  echo "Linked skill into $dest (worker agents will load it)."
fi
