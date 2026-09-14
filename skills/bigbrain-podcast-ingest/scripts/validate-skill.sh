#!/bin/sh
set -eu

skill_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
test -f "$skill_dir/SKILL.md"
test -f "$skill_dir/agents/openai.yaml"
test -f "$skill_dir/tests/cases.md"
grep -q '^name: bigbrain-podcast-ingest$' "$skill_dir/SKILL.md"
grep -q '^description:' "$skill_dir/SKILL.md"
for heading in '## Contract Checklist' '## Workflow' '## Anti-Patterns' '## Output'; do grep -q "^$heading$" "$skill_dir/SKILL.md"; done
test "$(sed -n '/^## Workflow$/,/^## Anti-Patterns$/p' "$skill_dir/SKILL.md" | grep -c '^[0-9][0-9]*\. ')" -eq "$(sed -n '/^## Workflow$/,/^## Anti-Patterns$/p' "$skill_dir/SKILL.md" | grep -c '^   - Anti-patterns:')"
grep -q '\$bigbrain-podcast-ingest' "$skill_dir/agents/openai.yaml"
grep -q '^## Should trigger$' "$skill_dir/tests/cases.md"
grep -q '^## Should not trigger$' "$skill_dir/tests/cases.md"
printf 'bigbrain-podcast-ingest skill validation passed\n'
