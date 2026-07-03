#!/usr/bin/env bash
set -euo pipefail

SKILL_NAME="deep-mantle-researcher"
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_DIR="${HOME}/.agents/skills/${SKILL_NAME}"
CONFIG_TARGET="${HOME}/.agents/AGENTS.md"
YES=0

for arg in "$@"; do
  case "$arg" in
    -y|--yes) YES=1 ;;
    *) echo "Unknown argument: $arg" >&2; exit 1 ;;
  esac
done

if [[ "$YES" -ne 1 ]]; then
  printf "Install %s to %s? [y/N] " "$SKILL_NAME" "$TARGET_DIR"
  read -r reply
  case "$reply" in
    y|Y|yes|YES) ;;
    *) echo "Cancelled."; exit 0 ;;
  esac
fi

mkdir -p "$TARGET_DIR"
cp -R "$SOURCE_DIR/skill/." "$TARGET_DIR/"

if [[ -f "$SOURCE_DIR/CLAUDE.md" ]]; then
  mkdir -p "$(dirname "$CONFIG_TARGET")"
  cp "$SOURCE_DIR/CLAUDE.md" "$CONFIG_TARGET"
fi

echo "Installed $SKILL_NAME to $TARGET_DIR"
