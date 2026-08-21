#!/bin/sh
set -eu

skill_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
skill_file="$skill_dir/SKILL.md"
agent_file="$skill_dir/agents/openai.yaml"
test_file="$skill_dir/tests/cases.md"

test -f "$skill_file"
test -f "$agent_file"
test -f "$test_file"

first_block=$(awk 'NR == 1 { next } /^---$/ { exit } { print }' "$skill_file")
test "$(printf '%s\n' "$first_block" | sed -n '/^[a-zA-Z0-9_-]*:/p' | wc -l | tr -d ' ')" -eq 2
printf '%s\n' "$first_block" | grep -q '^name: bigbrain-media-ingest$'
printf '%s\n' "$first_block" | grep -q '^description:'

for heading in '## Contract Checklist' '## Workflow' '## Anti-Patterns' '## Output'; do
  grep -q "^$heading$" "$skill_file"
done

workflow_steps=$(sed -n '/^## Workflow$/,/^## Anti-Patterns$/p' "$skill_file" | grep -c '^[0-9][0-9]*\. ')
workflow_antipatterns=$(sed -n '/^## Workflow$/,/^## Anti-Patterns$/p' "$skill_file" | grep -c '^   - Anti-patterns:')
test "$workflow_steps" -eq "$workflow_antipatterns"

grep -q '\$bigbrain-media-ingest' "$agent_file"
grep -q '^## Should trigger$' "$test_file"
grep -q '^## Should not trigger$' "$test_file"

printf 'bigbrain-media-ingest skill validation passed\n'
