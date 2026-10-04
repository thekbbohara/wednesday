#!/usr/bin/env bash
# A stand-in for an agent TUI in tests: reads a line, looks busy for a second, answers.
clear
echo "fake agent ready"
echo "> "
while IFS= read -r line; do
  [ -z "$line" ] && continue
  clear
  echo "thinking about: ${line:0:60}"
  echo "esc to interrupt"
  sleep 1
  clear
  echo "done: ${line:0:60}"
  echo "> "
done
