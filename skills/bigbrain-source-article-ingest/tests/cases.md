# Source Article Ingest Forward Cases

## Should trigger

An RSS item contains a substantive essay, research post, sector development,
or other source that would help the user master a topic, stay current, bring a
useful point into conversation, or read for enrichment.

Expected behavior: preserve the source faithfully, create the standard article
sidecar, link the author, publisher, subject, and materially mentioned Brain
entities, and update canonical pages only when the durable understanding
changes.

## Should not trigger as a filed article

An RSS item is only a routine collaboration announcement, privacy-policy
change, generic award, hiring notice, or promotional update with no durable
implication for the user's interests.

Expected behavior: return `ignored` and create no raw artifact or Brain page.

## Should trigger review

An item appears relevant but its canonical source is unavailable, empty, or
truncated.

Expected behavior: return `needs_review` and do not file a synthetic article.
