---
name: bigbrain-comprehension
description: Run an evidence-based Comprehension session over BigBrain pages using user guidance and durable iterative summaries.
---

Run a focused, evidence-based Comprehension session over important BigBrain pages and persist the evolving summary in the Comprehension playbook overlay.

## Contract Checklist

- Read the user-scoped Comprehension guidance before choosing what to study.
- Use existing BigBrain search, query, and read tools to select and inspect source pages.
- Treat the selected page and its linked source evidence as the curriculum authority.
- Teach, test, remediate, and retest rather than accepting self-certification.
- Persist one complete written summary after every meaningful interaction, especially during voice or realtime sessions.
- Keep all Comprehension state in the playbook overlay. Do not create or edit task pages or add page frontmatter.
- Leave an honest next resume step when the session is interrupted, indefinite, or not yet secure.

## Workflow

1. Load the Comprehension setup and establish the current learning context.
   - Read `playbooks/comprehension` for the authenticated user, including the single guidance prompt and available prior session summaries across pages.
   - Resolve the selected Brain identity before reading pages. Keep Brain-local ownership and source boundaries intact.
   - If guidance is empty or too broad to make a useful choice, use a bounded query and state the assumption in the summary; do not invent a curriculum.
   - Anti-patterns: ignoring the saved guidance, treating a generic topic framework as the source, silently crossing Brain ownership boundaries.

2. Select and read the source page or pages.
   - Consider prior session summaries across pages before ranking candidates. Then use existing `search`, `query`, or `pages/query` tools to find candidates and `list` or `read` to inspect them.
   - Rank candidates using judgement grounded in the saved guidance, page importance, current content, meaningful updates, unresolved gaps or next-resume steps, prerequisites, and fairness across eligible pages. Explain why the selected page is the best starting point.
   - If a page has linked raw transcript or source evidence, read it when needed for a faithful curriculum.
   - A page is eligible again when its current page update is later than the latest persisted summary for that page. Do not repeatedly review an unchanged page merely because it is visible in search results.
   - Keep the session bounded to the most useful page or small set of pages for the current turn. Do not create a task page or comprehension-specific page metadata.
   - Anti-patterns: relying on search snippets as curriculum, rereading an unchanged recently summarized page without a reason, writing source content into the overlay.

3. Start or resume the summary.
   - For a new page, create a session identifier locally and write an initial summary with `playbooks/comprehension/session` before or immediately after the first meaningful teaching turn.
   - For an existing page, read its full history with `playbooks/comprehension` and `page_slug`, then continue from the latest summary and its next resume step.
   - The summary is the complete durable state: current understanding, strengths, gaps, tutor notes, and next resume step. Rewrite it as the current truth, not as an append-only event log.
   - Anti-patterns: creating a second session for the same ongoing learning thread, waiting until the end to persist, storing separate status or outcome fields, storing a task-page transcript.

4. Teach, grill, remediate, and retest one primary question at a time.
   - Diagnose from the source, then explain only what is needed before asking the next question.
   - Test all five dimensions when applicable: facts and figures; vocabulary and definitions; narrative and source structure; interpretation and integration; transfer and analogy.
   - After a miss, remediate from the source, ask the learner to restate or apply the idea, and retest the changed understanding later.
   - Keep the original source exposition authoritative. Distinguish source claims from interpretation and mark uncertainty rather than smoothing it over.
   - After each meaningful answer, correction, teaching milestone, misunderstanding, conflict, strong question, or clear evidence of understanding, update the same session through `playbooks/comprehension/session` with a full replacement summary.
   - In voice or realtime sessions, perform that overlay write during the session. Do not defer it until the conversation ends. If interruption is likely or the user stops, persist the latest honest summary before closing the turn.
   - Anti-patterns: asking a batch of questions, accepting “I understand” as evidence, testing only recall, teaching from an unrelated framework, postponing the summary update.

5. Close this turn without pretending the learning is finished.
   - Use a closed-book final gate when the evidence is sufficient. Do not claim secure comprehension if a material gap remains.
   - Persist the latest summary even when the user stops abruptly. Include what is secure, what remains weak, tutor observations, and the exact next resume step.
   - If the page changed since its summary, treat the changed page as eligible for a new or resumed review. Avoid duplicate sessions by resuming the same session when it is clearly the same learning thread.
   - Report the source page, what was tested, current understanding, open gaps, and the persisted overlay update.
   - Anti-patterns: premature completion, self-certification, deleting an incomplete summary, claiming a page is mastered forever, silently discarding an interrupted turn.

## Anti-Patterns

- Do not create `tasks/*.md` pages, task records, page frontmatter, or a second page-level schema for Comprehension.
- Do not store transcript text by default. The written summary is the durable artifact; retain only additional evidence explicitly required by a later product decision.
- Do not let recency alone override the user’s guidance or the evidence of a gap.
- Do not confuse page visibility in the dashboard with eligibility for review.
- Do not claim a successful session from exposure, agreement, or a polished explanation without evidence from testing and transfer.

## Output

Return a concise session report containing:

- selected Brain page or pages and the evidence read;
- the current written summary, including strengths, gaps, tutor notes, and next resume step;
- whether the session was newly started, resumed, interrupted, or passed its current evidence gate;
- confirmation that the latest complete summary was persisted through `playbooks/comprehension/session` and can be resumed later.
