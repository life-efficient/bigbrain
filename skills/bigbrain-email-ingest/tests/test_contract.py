#!/usr/bin/env python3
"""Static contract checks for the BigBrain Email Ingest worker."""

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SKILL = (ROOT / "SKILL.md").read_text(encoding="utf-8")
AGENT = (ROOT / "agents" / "openai.yaml").read_text(encoding="utf-8")

assert "name: bigbrain-email-ingest" in SKILL
assert "one human-authored email thread" in SKILL
assert "$bigbrain-manage-email" in SKILL
assert "Do not scan the mailbox" in SKILL
assert "Do not preserve whole messages" in SKILL
assert "Preserve every relevant substantive PDF" in SKILL
assert "byte length and SHA-256" in SKILL
assert "$bigbrain-action-review" in SKILL
assert "$bigbrain-page" in SKILL
assert "significance: patch | minor | major" in SKILL
assert "selected Brain's MCP" in SKILL
assert "Never run manual sync" in SKILL
assert "Gmail action: none" in SKILL
assert "Substack" in SKILL
assert "ineligible" in SKILL
assert SKILL.count("Anti-patterns:") >= 6
assert "## Contract Checklist" in SKILL
assert "## Workflow" in SKILL
assert "## Anti-Patterns" in SKILL
assert "## Output" in SKILL
assert "$bigbrain-email-ingest" in AGENT
assert "$bigbrain-manage-email" in AGENT
assert "—" not in SKILL
assert "—" not in AGENT

print("bigbrain-email-ingest worker contract checks passed")
