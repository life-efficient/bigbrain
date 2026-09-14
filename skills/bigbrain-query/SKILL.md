---
name: bigbrain-query
description: Compatibility redirect only when the user explicitly invokes the retired bigbrain-query skill. Use bigbrain-search for ordinary Brain lookups and knowledge questions. This skill does not call the deprecated query tool or generate an answer inside BigBrain.
---

# BigBrain: Query (Deprecated)

Redirect explicit legacy skill invocations to BigBrain: Search.

## Contract Checklist

- Use the search workflow and synthesize in the calling harness.
- Never invoke the deprecated natural-language query tool.

## Workflow

1. Follow the replacement skill:
   - Read [BigBrain: Search](../bigbrain-search/SKILL.md), then execute its search, coverage-check, direct-read, and cited-answer workflow.
   - Anti-patterns: calling query, treating search snippets as complete evidence, generating an answer through a BigBrain internal model.

## Anti-Patterns

- Selecting this compatibility redirect for ordinary knowledge questions.

## Output

Return the evidence-grounded answer produced by the search workflow.
