#!/usr/bin/env python3
"""Static contract checks for the BigBrain Substack Ingest skill."""

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SKILL = (ROOT / "SKILL.md").read_text(encoding="utf-8")
AGENT = (ROOT / "agents" / "openai.yaml").read_text(encoding="utf-8")
CASES = (ROOT / "tests" / "cases.md").read_text(encoding="utf-8")

assert "name: bigbrain-substack-ingest" in SKILL
assert "description: Save and reconcile Substack posts in BigBrain" in SKILL
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
assert "$bigbrain-manage-email" in SKILL
assert "`$bigbrain-source-article-ingest` is the sole relevance and filing gate" in SKILL
assert "Followed status proves delivery eligibility only" in SKILL
assert "`ignored` is terminal reviewed metadata without source artifacts" in SKILL
assert "$bigbrain-page" in SKILL
assert "source_only" in SKILL
assert "source_partial" in SKILL
assert "source_and_update" in SKILL
assert "verified_noop" in SKILL
assert "needs_review" in SKILL
assert "Subscription inventory" in SKILL
assert "high_watermark" in SKILL
assert "low_watermark" in SKILL
assert "backfill_page_cursor" in SKILL
assert "bounded to one archive page or five posts per run" in SKILL
assert "Keep provider IDs" in SKILL
assert "display_name: \"BigBrain: Substack Ingest\"" in AGENT
assert "$bigbrain-substack-ingest" in AGENT
assert "$bigbrain-source-article-ingest" in AGENT
assert "$bigbrain-page" in AGENT
assert "$bigbrain-manage-email" in AGENT
assert "Gmail handoff for a followed new-post alert" in CASES
assert "Explicit bounded archive backfill" in CASES
assert "Digest or recommendation email" in CASES
assert "Blocked or mismatched canonical page" in CASES
assert "Adjacent prompt that should not trigger" in CASES
assert "List-Id" in CASES
assert "source_type: substack" in CASES
assert "no synthetic source" in CASES
assert "Relevant substantive preview before a block" in CASES
assert "preview-only" in SKILL
assert "advance the publication watermarks" in SKILL
assert "articles/" in SKILL
assert "articles/.raw/" in SKILL
assert "published_date" in AGENT
assert "article_url" in AGENT
assert "without changing Gmail" in AGENT
assert "reading-copy-cleanup.md" in SKILL
assert "Enjoying this newsletter?" in SKILL
assert "sponsorship" in AGENT
assert "Promotional footer inside a substantive post" in CASES

print("bigbrain-substack-ingest contract checks passed")
