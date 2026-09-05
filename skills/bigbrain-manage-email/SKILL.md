---
name: bigbrain-manage-email
description: Scan and manage a bounded Gmail queue by delegating human correspondence and article notifications to the correct BigBrain ingest skills.
---

# BigBrain Manage Email

Scan recently unchecked Gmail, classify each message by source shape, delegate eligible content, apply narrowly authorized cleanup, and advance only verified cursors.

## Contract Checklist

- Use this skill for scheduled mailbox scans, bounded user-requested email review, and automation-owned Gmail cursor management.
- Capture `run_started_at` before discovery and process no message newer than that boundary.
- Use the named automation memory at `/Users/hq/.codex/automations/<automation-id>/memory.md` for scheduled runs.
- Keep one verified Gmail cursor per thread with stable message identity, source timestamp, classification, delegated outcome, destination, affected records, and verification state.
- On a first run, scan at most the prior 24 hours. On later runs, start before the oldest relevant cursor with a small overlap and deduplicate stable IDs.
- Classify before reading full content or mutating anything.
- Delegate durable identifiable human correspondence to `$bigbrain-email-ingest`.
- Treat automated single-post delivery as a transport exception, not as human correspondence. Delegate plausible Substack new-post notifications to `$bigbrain-substack-ingest`.
- Delegate a non-Substack article notification with one verified canonical article URL to `$bigbrain-source-article-ingest` when explicitly in scope.
- Never use the email body as the article. Article relevance and filing are owned exclusively by `$bigbrain-source-article-ingest`.
- Do not pre-judge article relevance from sender automation, newsletter labels, topic keywords, or followed status. Pass verified source identity and guidance to the article workflow.
- Exclude all other automated and system-generated messages from Brain ingestion, even when they contain action language.
- Gmail is read-only except for exact cleanup rules explicitly present in the active user request, automation prompt, or this skill's Authorized Cleanup section.
- Brain MCP writes propagate and back up automatically. Never run manual sync, maintenance, propagation, or backup operations.
- Advance a Gmail cursor only after a delegated terminal outcome is verified.
- A verified article `ignored` outcome advances the Gmail delivery cursor as reviewed, while leaving source artifacts and canonical pages unchanged.
- `needs_review`, partial retrieval, ambiguous identity, or failed read-back leaves the Gmail cursor unchanged.
- Never maintain an RSS cursor here. The RSS event system owns RSS cursors, and `$bigbrain-substack-ingest` owns Substack publication state.

## Message Classes

Classify every bounded candidate into exactly one class:

| Class | Eligibility | Owner |
| --- | --- | --- |
| `human_correspondence` | Identifiable real person and durable relationship, deal, project, commitment, decision, or evidence value | `$bigbrain-email-ingest` |
| `substack_post_notification` | Automated delivery that points to one plausible canonical Substack post | `$bigbrain-substack-ingest` |
| `article_notification` | Explicitly in-scope automated delivery that points to one canonical non-Substack article | `$bigbrain-source-article-ingest` |
| `cleanup_only` | Exact authorized automated notification class | This dispatcher |
| `excluded_automated` | Receipt, alert, reminder, newsletter without a single-post route, marketing, platform notice, no-reply mail, or other system output | No ingest |
| `ignored_human` | Human-authored but non-durable acknowledgement, filler, or duplicate | No ingest |
| `needs_review` | Authorship, source identity, confidentiality, routing, or cursor outcome is materially ambiguous | Hold |

Human-authorship eligibility applies only to `human_correspondence`. It must never suppress a valid `substack_post_notification` or `article_notification` before the canonical source reaches the shared relevance gate.

## Delegation Packets

For human correspondence, pass the bounded thread, authorship evidence, direction, chronology, newly authored summaries, attachment metadata, and stable Gmail delivery provenance to `$bigbrain-email-ingest`.

For a Substack post, pass:

- mailbox, Gmail message and thread IDs, internal date, sender and recipient headers, and subject;
- notification type, `List-Id`, `List-Post`, canonical post URL, title, author, publication, and publication date when available;
- canonical publication identity and stable delivery provenance;
- exact registered source guidance when a live RSS listener or source registry unambiguously matches the publication;
- otherwise, any explicit publication guidance or named current user anchor;
- the automation memory path for publication-state and delivery-state reconciliation.

Do not include full email bodies or MIME payloads in durable Brain artifacts.

## Cursor Contract

- The Gmail thread cursor answers which delivery messages were completely reviewed.
- The Substack publication state answers which canonical posts were reviewed and whether they were filed.
- The RSS event system answers which feed items were reviewed.
- Record terminal outcomes distinctly: `ignored_verified`, `source_only_verified`, `source_and_update_verified`, `verified_noop`, and `cleanup_verified`.
- Advance the Gmail cursor after a delegated `ignored` only when the subskill confirmed canonical identity, applied the shared relevance gate, recorded the reviewed outcome in automation memory, and returned a complete result.
- Preserve the previous cursor after `needs_review`, incomplete source retrieval, failed Brain verification, failed Gmail Trash read-back, or ambiguous delegation.
- Never infer publication or RSS cursor advancement from a Gmail cursor.

## Authorized Cleanup

Standing cleanup is a recoverable move to Gmail Trash, never permanent deletion:

- My Wellness Cloud notifications.
- GitHub Security Advisory notifications.
- Clearly automated Preply scheduling, reminder, rescheduling, or cancellation messages from verified official infrastructure.
- Calendar acceptance wrappers only after the correct Brain shows the accepted attendee and upcoming meeting and that state reads back successfully.

The active automation or user request may narrow this list or add named sender classes. Narrower active instructions win. Verify sender domain, authentication evidence when available, automated nature, and exact message type before Trash. Preserve human correspondence and mixed human/system threads.

## Workflow

1. Establish mode, scope, boundary, and memory:
   - Record scheduled or interactive mode, mailbox, requested query or date range, `run_started_at`, and automation memory path.
   - Read prior thread cursors and unresolved outcomes before discovery.
   - Build a bounded Gmail query with the overlap and exclude spam and Trash.
   - Anti-patterns: unbounded search, treating unread as the cursor, processing after the run boundary, ignoring prior partial outcomes.

2. Discover and classify candidates:
   - Search message-level summaries, paginate the complete bounded result, deduplicate stable IDs, and separate cleanup candidates.
   - Classify from sender, recipient, subject, labels, attachment metadata, and message shape before opening bodies.
   - Read enough headers and body only for shortlisted human threads, source notifications, cleanup candidates, or ambiguous cases.
   - Anti-patterns: opening every excluded personal message, using a display name as proof, treating every Substack delivery as a digest, treating every newsletter as a single-post alert.

3. Delegate human correspondence:
   - Batch-read relevant thread context, separate newly authored content from quotes, and preserve direction and chronology.
   - Pass one thread packet to `$bigbrain-email-ingest`.
   - Accept only a terminal verified result before updating the Gmail cursor.
   - Anti-patterns: doing canonical writes in the dispatcher, passing automated action language to action review, combining unrelated threads in one handoff.

4. Delegate article notifications:
   - For Substack, verify one plausible canonical post from headers and links, then call `$bigbrain-substack-ingest` even though the delivery is automated.
   - Resolve exact matching registered source guidance when available. Otherwise pass explicit source guidance or a named current user anchor without inventing one.
   - Require the Substack adapter to call `$bigbrain-source-article-ingest`, which makes the sole relevance and filing decision.
   - For a verified `ignored`, record `ignored_verified` and advance only the Gmail delivery cursor. For `source_only`, `source_and_update`, or `verified_noop`, require all relevant same-Brain reads before advancing.
   - Anti-patterns: excluding a post because the email is automated, filing the email body, treating followed status as sufficient relevance, advancing after `needs_review`.

5. Apply authorized cleanup:
   - Select only exact message IDs that match the active cleanup scope.
   - Verify domain, authentication evidence when available, automated authorship, and notification type.
   - Move matching messages to Trash and read back the exact message with the `TRASH` label.
   - Anti-patterns: permanent deletion, deleting by display name, cleaning outside active scope, trashing human-authored or mixed threads.

6. Reconcile memory and report:
   - Atomically update only verified Gmail cursors and delegated publication-state outcomes.
   - Retain unresolved and partial records without cursor advancement.
   - Report count first, then group human email outcomes by destination Brain, article outcomes by publication, and Gmail cleanup by authorized class.
   - Anti-patterns: storing bodies in memory, hiding ignored article decisions, exposing provider IDs, running sync or backup.

## Anti-Patterns

- Applying the human-author rule to article-delivery classification.
- Letting the automation prompt override a more specific Substack transport exception.
- Creating a second article relevance policy.
- Filing every followed publication post.
- Advancing Gmail, Substack, or RSS state after partial work.
- Performing Brain mutations in the dispatcher.
- Modifying Gmail outside exact cleanup authorization.

## Output

Start with a count-first summary:

```text
<human thread count> email threads ingested, <article count> articles reviewed, <cleanup count> notifications moved to Trash, <partial count> left partial

<Destination Brain>
- <Human email subject> - <outcome>
  - <Page category>:
    - Created: <page title> (<significance>)
    - Updated: <page title> (<significance>)

Articles
- <Publication> - <Post title>: <ignored | source_only | source_and_update | verified no-op | needs_review>
  - Relevance: <short rationale>
  - Brain: <destination>
  - Created: <sidecar or page>
  - Updated: <canonical page>
  - Read-back: <verified | partial>

Gmail cleanup
- Moved to Trash: <count and authorized class>

No email was sent. Gmail changes were limited to <count> authorized notification(s) moved to Trash.
```

If nothing changed, say `0 email threads ingested, 0 articles reviewed` and `No email was sent or modified.`
