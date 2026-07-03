#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

required_files=(
  ".gitignore"
  "ARTICLE.md"
  "README.md"
  "LICENSE"
  "CLAUDE.md"
  "SUBMISSION.md"
  "install.sh"
  "install-custom.sh"
  "skill/SKILL.md"
  "skill/research-workflow.md"
  "skill/source-map.md"
  "skill/evidence-grid.md"
  "skill/article-synthesis.md"
  "skill/hackathon-submission.md"
  "skill/resources.md"
  "agents/research-analyst.md"
  "agents/source-verifier.md"
  "agents/article-synthesizer.md"
  "agents/skill-demo-coach.md"
  "commands/research-sprint.md"
  "commands/verify-claim.md"
  "commands/article-brief.md"
  "commands/skill-demo.md"
  "rules/evidence-integrity.md"
  "tests/validate_structure.sh"
)

for file in "${required_files[@]}"; do
  if [[ ! -f "$ROOT_DIR/$file" ]]; then
    echo "Missing required file: $file" >&2
    exit 1
  fi
done

if ! grep -q '^name: deep-mantle-researcher$' "$ROOT_DIR/skill/SKILL.md"; then
  echo "Missing skill name frontmatter." >&2
  exit 1
fi

if ! grep -q '^description: .*Use when ' "$ROOT_DIR/skill/SKILL.md"; then
  echo "Missing actionable description frontmatter." >&2
  exit 1
fi

for linked in research-workflow.md source-map.md evidence-grid.md article-synthesis.md hackathon-submission.md resources.md; do
  if ! grep -q "$linked" "$ROOT_DIR/skill/SKILL.md"; then
    echo "SKILL.md does not link $linked" >&2
    exit 1
  fi
done

bash -n "$ROOT_DIR/install.sh"
bash -n "$ROOT_DIR/install-custom.sh"
bash -n "$ROOT_DIR/tests/validate_structure.sh"

blocked_terms=(
  "$(printf "%s%s" "Co" "dex")"
  "$(printf "%s%s" "Anth" "ropic")"
  "$(printf "%s%s%s" "Co-Authored-" "By:" " ")"
  "$(printf "%s%s" "noreply@" "anthropic.com")"
)

for term in "${blocked_terms[@]}"; do
  if grep -R -n --exclude-dir=.git -- "$term" "$ROOT_DIR" >/tmp/deep_mantle_researcher_hygiene.txt; then
    cat /tmp/deep_mantle_researcher_hygiene.txt >&2
    echo "Attribution hygiene check failed." >&2
    exit 1
  fi
done

echo "Structure validation passed."
