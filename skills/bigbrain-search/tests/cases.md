# Search behavior cases

1. Positive trigger: "What do we know about Alex Rivera's advisory work?"
   - Select bigbrain-search, resolve the Brain, search in balanced mode, and answer in the harness using retrieved content with source slugs.
2. Negative trigger: "Save these new notes about Alex Rivera."
   - Select the appropriate ingest or page-writing skill, not search as the owning workflow.
3. Adjacent ambiguous request: "How does BigBrain decide which search results come first?"
   - Explain the software from code or BigBrain: Understand, rather than searching personal knowledge.
4. Budget omission: the first ranked page exceeds the budget and context is empty.
   - Read the relevant returned slug directly; do not answer from its preview or claim no evidence exists.
5. Buried evidence: the answer appears after character 240 and a later timeline entry revises an earlier fact.
   - Read the whole payload, preserve the chronology, and cite the current supported conclusion.
6. Keyword fallback: embeddings are missing but a relevant page is returned.
   - Use the available complete evidence, explain any material limitation, and do not trigger a sync or embedding backfill.
7. Structured request: "Count active tasks assigned to me."
   - Use identity resolution and pages/query or the appropriate task tool for exact filtering. Do not call the deprecated natural-language query tool.
8. Legacy invocation: "Use $bigbrain-query to answer this question."
   - Follow the compatibility skill to bigbrain-search, with no internal answer-model call.

Apply the five synthetic [person identity regression cases](../../bigbrain-meeting-ingest/tests/cases.md#person-identity-regression-cases) to the indicated Granola, Meeting Ingest and Search stages.
