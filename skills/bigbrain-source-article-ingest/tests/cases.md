# Source Article Ingest Forward Cases

## Decision gate and prompt framing

The request “run BigBrain source article ingest” and the request “ingest this
article” must use the same relevance decision. Neither phrase presupposes that
the article will be filed. “Put it in the right Brain pages” must not be added
to a neutral workflow request unless the user has separately decided that the
article is worth retaining.

Before any raw-file or Brain-page write, the workflow must record a concise,
user-specific digest-value rationale and identify whether the source is
first-party promotional material. A project link, entity mention, topical
similarity, or regional connection alone is not sufficient.
The workflow must name a current user anchor before filing: an active project,
task, question, learning topic, tracked entity with live significance, or
explicit conversation or enrichment intent. Generic sector awareness or
possible future usefulness is not a current anchor.

## Should trigger

An RSS item contains a substantive essay, research post, sector development,
or other source that would help the user master a topic, stay current, bring a
useful point into conversation, or read for enrichment.

Expected behavior: preserve the source faithfully, create the standard article
sidecar, link the author, publisher, subject, and materially mentioned Brain
entities, and update canonical pages only when the durable understanding
changes.

Visit the supplied article page, confirm that it is the requested article, and
file it if it is accessible and clears the digest-value gate. If it is blocked
or cannot be accessed, return `needs_review` without substituting another page.

An accessible article whose URL slug is shorter than its title is still the
requested article when the page itself confirms the title and publisher.

## Should not trigger as a filed article

An RSS item is only a routine collaboration announcement, privacy-policy
change, generic award, hiring notice, or promotional update with no durable
implication for the user's interests.

Expected behavior: return `ignored` and create no raw artifact or Brain page.

The same no-write behavior applies when the user says “ingest this article” if
the article fails the digest-value test.

An accessible first-party company profile, such as “Apex: The Spacecraft
Platform Company,” describes an unfamiliar company and offers only generic
company, platform, industrial, or sector lessons. The user has not named an
active aerospace or space objective, Apex relationship, or question that the
article would answer.

Expected behavior: return `ignored` and create no raw artifact or Brain page.

## Should not write when relevance is ambiguous

An article appears plausibly related to an existing entity or project, but the
agent cannot state a concrete durable implication for the user's work,
learning, sector awareness, conversation, or enrichment.

Expected behavior: return `ignored`, or ask for clarification when the user's
intended retention scope is genuinely unclear. Do not create a raw artifact,
source sidecar, new concept page, or canonical-page update while the decision
is unresolved.

## Should file despite promotional status

An article is first-party promotional material but contains a concrete,
durable implication that materially changes a named active project, concept,
tracked entity, or explicitly identified sector thesis.

Expected behavior: `source_only` or `source_and_update` is allowed only after
the workflow states the promotional status and the specific durable implication
that outweighs it. Entity or topical linkage alone does not qualify.

## Should trigger review

An item appears relevant but its canonical source is unavailable, empty, or
truncated.

Expected behavior: return `needs_review` and do not file a synthetic article.

The review result should say that the supplied source could not be retrieved.
