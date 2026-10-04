#!/usr/bin/env bash
# A Claude-style selection menu for tests: arrows move, Enter picks.
options=("No, exit" "Yes, I trust this folder")
sel=0
draw() {
  clear
  echo " Quick safety check: Is this a project you created or one you trust?"
  echo
  for i in "${!options[@]}"; do
    if [ "$i" -eq "$sel" ]; then echo " ❯ ${options[$i]}"; else echo "   ${options[$i]}"; fi
  done
  echo
  echo " Enter to confirm · Esc to cancel"
}
draw
while IFS= read -rsn1 key; do
  if [ "$key" = $'\e' ]; then
    read -rsn2 -t 0.1 rest
    case "$rest" in "[A") sel=$(( sel > 0 ? sel - 1 : 0 ));; "[B") sel=$(( sel < ${#options[@]} - 1 ? sel + 1 : sel ));; esac
    draw
  elif [ -z "$key" ]; then
    clear
    echo "picked: ${options[$sel]}"
    [ "$sel" -eq 0 ] && exit 1
    exec bash --norc --noprofile
  fi
done
