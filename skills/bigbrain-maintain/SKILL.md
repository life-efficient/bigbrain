---
name: bigbrain-maintain
description: Check a BigBrain for deterministic health issues and a small judgment-based sample of page quality. Use for maintenance, health checks, nightly checkups, or auditing whether pages and summaries remain reader-facing, standalone, and well-structured. Do not use for a full content rewrite, a one-off page edit, or exhaustive editorial review.
---

# BigBrain: Maintain

Use this skill when you want a quick BigBrain checkup. It runs the health
check, fixes straightforward issues when there is a safe built-in path, and
then tells you what still needs attention.

For recurring nightly maintenance, reporting unresolved items is not enough.
The agent must first attempt safe, bounded remediation for findings that have a
deterministic fix path, then report only what remains.

## Contract Checklist

This skill guarantees:
- Start with the live `bigbrain health --json` report
- Fix straightforward problems when the current runtime already has a safe way
  to do that
- Re-run health after any remediation attempt
- After content remediation, re-run sync so the database/index reflects the
  committed brain files
- Commit intentional remediation changes once verification passes, then push the
  branch when the repository is otherwise clean
- For nightly maintenance, attempt remediation before finalizing the
  "unresolved items" section
- Exit cleanly when no findings remain
- Stop clearly when the remaining issues need manual page edits or a product
  change
- On each maintenance pass, assess a random sample of up to ten canonical pages
  against qualitative reader-facing standards and record the sample and findings

## What it can fix

Use only these built-in repair paths unless the user asks for deeper edits:

1. Freshness or index drift:
   - Run `node ./bin/bigbrain.js sync --json`
   - Re-run `node ./bin/bigbrain.js health --json`

2. Template/install drift:
   - For `skill_template_mismatch`, inspect `skill_template_status.checks`
   - If the intended active install is missing and the template path exists,
     create or correct the active symlink with `ln -sfn`, then re-run health
   - For `automation_template_mismatch`, compare the template and active
     `automation.toml`; if the active install should track the template, copy
     the template to the active path while preserving machine-local `cwds` when
     present, then re-run health
   - Do not delete, pause, activate, or reschedule automations unless the user
     explicitly asked for that operational change

3. Obvious page-shape fixes:
   - If a finding points to a single page and the correction is obvious from the
     page shape rules, apply the smallest safe edit, then re-run health
   - Safe examples: restoring missing required meeting headings, adding missing
     frontmatter delimiters, adding the body separator required between current
     truth and timeline, creating an empty `## Timeline` section when the page
     type requires a timeline and no dated evidence is obvious, or fixing an
     obviously broken relative markdown link target
   - Treat `missing_separator` as deterministic when health points to concrete
     pages: insert the smallest valid `---` body separator after the current
     truth section or before an existing `## Timeline`, without rewriting the
     page content
   - Treat `missing_timeline` as deterministic for page types that require a
     timeline: add `## Timeline` after the separator; include an initial dated
     item only when the page already contains clear source evidence for it,
     otherwise leave the timeline empty if health accepts that shape
   - Treat `invalid_meeting_prep_heading` as deterministic when the only issue
     is an extra non-critical prep heading: remove the extra heading while
     preserving its bullets/content under the allowed prep structure
   - For `unresolved_link`, inspect the source page and filesystem context; fix
     the link when there is a single obvious target, such as a raw file whose
     name differs only by URL encoding/spacing, or convert an external local
     path citation into literal text when it is not an in-brain page link
   - For raw-file sidecar placement, distinguish canonical pages from sidecars:
     canonical meeting, report, source, deliverable, deal, and project pages may
     link to raw files from normal collection folders, but markdown pages whose
     main purpose is raw-file metadata should live next to the raw file under
     `<collection>/.raw/`. Move only unambiguous sidecars and list ambiguous
     pages for review.
   - After link edits, always run `sync` before re-running `health`, because
     unresolved-link checks use the indexed outgoing-link table

4. Page-schema compliance:
   - For `page_schema_registry_missing`, bootstrap the registry only through
     the owning Brain MCP `schemas/bootstrap` tool. Never replace an existing
     registry. Read the result back before proceeding.
   - For `schema_default_missing`, apply only the reported `default_value`, to
     at most 25 pages per run. Read the page first, preserve its current
     compiled truth, and record one precise timeline entry with provenance.
     Use `tasks/update` for pages under `tasks/`; for every other page, use
     `update_page` with a one-key `frontmatter` patch.
   - Treat `schema_field_type_mismatch` as deterministic only when the
     registered field type is `array` and the read-back value is exactly the
     empty string. Normalize that value to `[]`; never split, reinterpret, or
     replace a non-empty string. Count these pages within the same 25-page
     limit.
   - Verify each change through the same owning MCP, then run `sync` and
     health again. Stop if any verification fails.
   - Do not infer or overwrite values for `schema_required_field_missing`,
     non-deterministic `schema_field_type_mismatch`,
     `schema_field_invalid_enum`, `unknown_page_schema`, or
     `invalid_page_schema_registry`. Report the affected page, field, schema,
     and observed value for manual review.

5. Post-remediation persistence:
   - After any content or brain-file edit, run `node ./bin/bigbrain.js sync
     --json` so embeddings/index state catches up with the files
   - Run `git status --short --branch` and inspect the changed files before
     staging anything
   - Commit only the intentional remediation changes with a concise message
   - Re-run `node ./bin/bigbrain.js health --json` after the commit
   - If the repository is clean and the only remaining git status issue is being
     ahead of the remote, run `git push`

5. Inbound event triage:
   - When health reports `inbound_event_failed` or
     `inbound_event_quarantined`, inspect the exact delivery with
     `bigbrain events inbox` before deciding what to do.
   - Classify each delivery as `retryable`, `needs_review`, or `legacy` and
     include the observed cause and one concrete proposed action in the final
     report.
   - Retry only when the cause is deterministic and the retry is idempotent or
     the underlying write has been read back. Discard only when the delivery
     is demonstrably obsolete, duplicated, or intentionally ignored. Otherwise
     leave it untouched and propose the exact follow-up.
   - After any retry or discard, run `bigbrain events drain` and re-run health.
   - A maintenance pass must never leave an aggregate event-failure message
     without the delivery ID, listener, exact error, and proposed resolution.

6. Qualitative page-quality sample:
   - Randomly select up to ten canonical pages after deterministic health checks.
     Exclude raw sidecars, system taxonomy, and pages already selected in the
     immediately preceding maintenance pass when that history is available.
   - Judge each page, rather than pretending these are mechanically verifiable:
     its Summary describes the substantive topic and takeaway rather than Brain
     mechanics; the body works as a standalone, Pareto-style one-pager; the
     explanation is internally structured, non-overlapping, and collectively
     covers the important ground for its stated scope; and it does not spend
     reader space explaining storage, transcripts, indexing, or rendering.
   - Record the sampled paths, pass or follow-up result, and one concise reason
     for every follow-up. Apply only obvious, narrow fixes during the pass;
     queue judgment-heavy rewrites rather than silently rewriting the sample.
   - Treat recurring patterns as a maintenance-rule or page-template issue and
     improve that upstream guidance after evidence from more than one page.

## When to stop

Do not keep digging once one of these is true:
- `health` is clean
- Remaining findings need judgment-heavy content edits
- Multiple candidate fixes exist and the right one is unclear
- BigBrain does not have a safe built-in fix path for the issue
- The issue points to unrelated repo work or new feature work rather than a
  maintenance fix

## Workflow

1. Run the health check:
   - `node ./bin/bigbrain.js health --json`
   - Anti-patterns: sampling pages before checking deterministic health, treating a stale index as a content-quality finding
2. Classify findings:
   - no findings -> exit cleanly
   - likely index freshness problem -> `sync`, then re-run health
   - missing active skill install -> repair the symlink, then re-run health
   - automation template mismatch -> reconcile the active file with the
     template when the intended state is clear, then re-run health
   - deterministic page-shape problem -> patch the affected page, then re-run
     health
   - missing page-schema registry -> bootstrap through the owning MCP, then
     re-run health
   - missing page-schema default -> apply only the declared default through
     the owning MCP, then re-run health
   - blank-string array schema mismatch -> normalize to an empty array through
     the owning MCP, then re-run health
   - after deterministic checks -> run the qualitative page-quality sample and
     record findings separately from health failures
   - Anti-patterns: treating editorial judgment as a deterministic failure, sampling raw sidecars or system taxonomy, silently rewriting ambiguous content
3. After a successful remediation:
   - run `node ./bin/bigbrain.js sync --json`
   - commit the intentional fix
   - re-run `node ./bin/bigbrain.js health --json`
   - push if the repository is clean and the branch has commits ahead of the
     remote
   - Anti-patterns: committing unrelated worktree changes, pushing before sync and final health
4. Stop after one bounded remediation loop unless the next action is still
   deterministic and lower risk than leaving the issue open
   - Anti-patterns: mass-rewriting pages, turning a maintenance pass into an exhaustive editorial project
5. Report:
   - initial findings
   - remediation attempted
   - final findings
   - sync, commit, and push status for remediation changes
   - whether the pass exited cleanly or stopped with explicit follow-up needed
   - qualitative sample size, sampled page paths, themes found, and any pages
     queued for editorial follow-up
   - Anti-patterns: reporting a qualitative pass as exhaustive, omitting the sampled paths or rationale

## Anti-Patterns

- Prefer the runtime commands over ad hoc filesystem walks when they answer the
  question directly
- Do not claim to fix citations, embeddings, backups, or automation drift
  unless there is a real command path or deterministic file/symlink repair for
  that in this repo
- Do not mass-rewrite pages during a maintenance pass
- If a manual page edit is required, keep it narrow and local to the reported
  finding
- Do not stage or commit unrelated user changes; if unrelated dirty files are
  present, leave them untouched and report that push was skipped or limited by
  the dirty worktree
- Do not push before the post-remediation sync and health checks complete
- Never report unresolved items as the final outcome until each remaining
  finding has been classified as either attempted, not safely fixable, or
  intentionally deferred
- Never leave inbound event failures as an unexplained backlog. Every failed or
  quarantined delivery must have an evidence-backed classification and
  proposed next action.
- Do not treat qualitative sampling as a health failure or claim it is
  exhaustive. Do not mass-rewrite sampled pages or infer that an individual
  editorial judgment applies to every page.

## Output

Report deterministic health findings and remediation separately from the
qualitative sample. Include the sampled page paths, each follow-up rationale,
recurring themes, and only the narrow remediation actually completed.
