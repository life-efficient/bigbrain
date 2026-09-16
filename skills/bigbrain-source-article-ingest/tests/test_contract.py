#!/usr/bin/env python3
"""Static contract checks for the BigBrain Source Article Ingest skill."""

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SKILL = (ROOT / "SKILL.md").read_text(encoding="utf-8")
AGENT = (ROOT / "agents" / "openai.yaml").read_text(encoding="utf-8")
CASES = (ROOT / "tests" / "cases.md").read_text(encoding="utf-8")

assert "name: bigbrain-source-article-ingest" in SKILL
assert "# BigBrain Source Article Ingest" in SKILL
assert all(h in SKILL for h in ("## Contract Checklist", "## Workflow", "## Anti-Patterns", "## Output"))
assert SKILL.count("Anti-patterns:") >= 5
assert "$bigbrain-substack-ingest" in SKILL
assert "$bigbrain-page" in SKILL
assert "shared relevance gate" in SKILL
assert "substantive, identity-confirmed partial preview" in SKILL
assert "preview-only" in SKILL
assert "use `needs_review`" in SKILL
assert "do not advance any RSS, Substack, or Gmail completeness watermark" in SKILL
assert "email preview, search snippet, or notification body" in SKILL
assert "filing a partial preview as a full capture" in SKILL
assert "articles/" in SKILL
assert "articles/.raw/" in SKILL
assert "published_date" in SKILL
assert "article_url" in SKILL
assert "Should retain a substantive partial preview" in CASES
assert "without content writes" in CASES
assert "display_name: \"BigBrain: Source Article Ingest\"" in AGENT
assert "$bigbrain-source-article-ingest" in AGENT
assert "articles/" in AGENT

print("bigbrain-source-article-ingest contract checks passed")
