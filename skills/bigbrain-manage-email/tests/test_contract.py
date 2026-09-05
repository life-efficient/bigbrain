#!/usr/bin/env python3
"""Static contract checks for BigBrain Manage Email."""

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SKILL = (ROOT / "SKILL.md").read_text(encoding="utf-8")
AGENT = (ROOT / "agents" / "openai.yaml").read_text(encoding="utf-8")
CASES = (ROOT / "tests" / "cases.md").read_text(encoding="utf-8")

assert "name: bigbrain-manage-email" in SKILL
assert "$bigbrain-email-ingest" in SKILL
assert "$bigbrain-substack-ingest" in SKILL
assert "$bigbrain-source-article-ingest" in SKILL
assert "Human-authorship eligibility applies only" in SKILL
assert "automated single-post delivery as a transport exception" in SKILL
assert "Article relevance and filing are owned exclusively" in SKILL
assert "ignored_verified" in SKILL
assert "leaving source artifacts and canonical pages unchanged" in SKILL
assert "Never run manual sync" in SKILL
assert "## Authorized Cleanup" in SKILL
assert "exact cleanup rules explicitly present" in SKILL
assert "with the `TRASH` label" in SKILL
assert SKILL.count("Anti-patterns:") >= 6
assert "Automation blanket exclusion" in CASES
assert "Verified irrelevant Substack post" in CASES
assert "$bigbrain-manage-email" in AGENT
assert "—" not in SKILL
assert "—" not in AGENT
assert "—" not in CASES

print("bigbrain-manage-email contract checks passed")
