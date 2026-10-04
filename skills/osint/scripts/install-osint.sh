#!/usr/bin/env bash
# Sets up the OSINT scraping engine (Scrapling) in a self-contained venv next to
# the scripts, and reports which optional system CLIs are present. No sudo; it
# never touches the workspace or system packages.
set -eu
here="$(cd "$(dirname "$0")" && pwd)"
venv="$here/.venv"
py="${PYTHON:-python3}"

echo "Setting up Scrapling in $venv ..."
if command -v uv >/dev/null 2>&1; then
  uv venv "$venv" >/dev/null
  VIRTUAL_ENV="$venv" uv pip install -q "scrapling[fetchers]"
else
  "$py" -m venv "$venv"
  "$venv/bin/pip" install -q --upgrade pip
  "$venv/bin/pip" install -q "scrapling[fetchers]"
fi

# Browser-based fetchers (StealthyFetcher) need the bundled browser.
echo "Installing Scrapling's browser dependencies (one time; may take a minute)..."
"$venv/bin/scrapling" install >/dev/null 2>&1 || "$venv/bin/python" -m scrapling install >/dev/null 2>&1 || \
  echo "  note: 'scrapling install' did not finish; the plain Fetcher still works, StealthyFetcher may not."

echo "Scrapling ready: $("$venv/bin/python" -c 'import scrapling; print(scrapling.__version__)' 2>/dev/null || echo installed)"
echo
echo "Optional system CLIs for deeper recon (install as you like; none required):"
echo "  arch:   sudo pacman -S whois bind exiftool nmap"
echo "  go:     go install github.com/projectdiscovery/subfinder/v2/cmd/subfinder@latest"
echo "  pipx:   pipx install theHarvester"
echo
# Make the skill loadable by Jarvis's worker agents (Claude Code loads ~/.claude/skills).
skill_root="$(cd "$here/.." && pwd)"
dest="$HOME/.claude/skills/osint"
mkdir -p "$HOME/.claude/skills"
if [ -e "$dest" ] && [ ! -L "$dest" ]; then
  echo "note: $dest exists and is not a symlink; leaving it. Point it at $skill_root yourself if you want the Jarvis version."
else
  ln -sfn "$skill_root" "$dest"
  echo "Linked skill into $dest (worker agents will load it)."
fi
echo
echo "Done. Verify with: bash $here/diagnose.sh"
