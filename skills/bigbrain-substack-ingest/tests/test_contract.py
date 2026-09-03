#!/usr/bin/env python3
"""Static contract checks for the BigBrain Substack Ingest skill."""

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SKILL = (ROOT / "SKILL.md").read_text(encoding="utf-8")
AGENT = (ROOT / "agents" / "openai.yaml").read_text(encoding="utf-8")
CASES = (ROOT / "tests" / "cases.md").read_text(encoding="utf-8")

assert "name: bigbrain-substack-ingest" in SKILL
assert "description: Ingest a verified Substack post" in SKILL
assert "# BigBrain Substack Ingest" in SKILL
assert "## Contract Checklist" in SKILL
assert "## Workflow" in SKILL
assert "## Anti-Patterns" in SKILL
assert "## Output" in SKILL
assert SKILL.count("Anti-patterns:") >= 5
assert "does not search Gmail, change Gmail state, send email" in SKILL
assert "List-Id" in SKILL
assert "List-Post" in SKILL
assert "recommendations, digests, comments, likes" in SKILL
assert "publication_key" in SKILL
assert "post_key" in SKILL
assert "source_type: substack" in SKILL
assert "$bigbrain-source-article-ingest" in SKILL
assert "$bigbrain-page" in SKILL
assert "source_only" in SKILL
assert "source_and_update" in SKILL
assert "verified no-op" in SKILL
assert "needs_review" in SKILL
assert "substack_publications" in SKILL
assert "high_watermark" in SKILL
assert "low_watermark" in SKILL
assert "backfill_page_cursor" in SKILL
assert "explicitly requested bounded archive backfill" in SKILL
assert "Do not regress" not in SKILL
assert "Do not include provider IDs" in SKILL
assert "display_name: \"BigBrain: Substack Ingest\"" in AGENT
assert "$bigbrain-substack-ingest" in AGENT
assert "$bigbrain-source-article-ingest" in AGENT
assert "$bigbrain-page" in AGENT
assert "Gmail handoff for a followed new-post alert" in CASES
assert "Explicit bounded archive backfill" in CASES
assert "Digest or recommendation email" in CASES
assert "Blocked or mismatched canonical page" in CASES
assert "Adjacent prompt that should not trigger" in CASES
assert "List-Id" in CASES
assert "source_type: substack" in CASES
assert "no synthetic source" in CASES
assert "without changing Gmail" in AGENT

print("bigbrain-substack-ingest contract checks passed")
