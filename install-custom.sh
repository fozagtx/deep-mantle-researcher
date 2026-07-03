#!/usr/bin/env bash
set -euo pipefail

SKILL_NAME="deep-mantle-researcher"
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Choose install target:"
echo "1) ~/.agents/skills/${SKILL_NAME}"
echo "2) ~/.claude/skills/${SKILL_NAME}"
echo "3) ./skills/${SKILL_NAME}"
echo "4) Custom path"
printf "Selection [1]: "
read -r selection
selection="${selection:-1}"

case "$selection" in
  1) TARGET_DIR="${HOME}/.agents/skills/${SKILL_NAME}" ;;
  2) TARGET_DIR="${HOME}/.claude/skills/${SKILL_NAME}" ;;
  3) TARGET_DIR="$(pwd)/skills/${SKILL_NAME}" ;;
  4)
    printf "Custom target path: "
    read -r TARGET_DIR
    if [[ -z "$TARGET_DIR" ]]; then
      echo "Target path cannot be empty." >&2
      exit 1
    fi
    ;;
  *) echo "Unknown selection: $selection" >&2; exit 1 ;;
esac

mkdir -p "$TARGET_DIR"
cp -R "$SOURCE_DIR/skill/." "$TARGET_DIR/"

echo "Installed $SKILL_NAME to $TARGET_DIR"
