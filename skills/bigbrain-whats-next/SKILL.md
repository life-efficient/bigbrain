---
name: bigbrain-whats-next
description: Use when the user wants a prioritized task snapshot across all registered BigBrain Brains or a user-requested subset such as their Personal Brain.
---

# BigBrain: What's Next

Build one read-only, decision-ready task snapshot across the requested registered Brains, then retrieve full context only for tasks the user selects.

## Contract Checklist

- Discover Brains from `bigbrain brains list --json`; never hardcode Personal, ICAIRE, Dealmaking, or another Brain list.
- Query every registered, verified Brain by default. If the user names a Brain, filter the registry before querying tasks.
- Treat the catalog as discovery only. Verify each Brain through its own live authenticated `about` response, exact Brain ID match, and read capability.
- Resolve every Brain through its registered `connection.handle`; never substitute Personal Brain for an unavailable Brain.
- Call `me` and paginated `tasks/summary` through each in-scope Brain.
- Preserve Brain ID, name, and handle on every normalized task. Rank across Brains without merging similarly titled tasks.
- Use compact task metadata only for discovery and ranking. Do not fetch bodies, timelines, sources, markdown, attachments, or exact open questions.
- Continue when one Brain fails, while reporting partial coverage and the concrete reason.
- Keep the snapshot read-only. Use the owning Brain's `tasks/get` only after the user selects a task for clarification or handoff.
- Query local TODO files or other non-Brain task sources only when the user explicitly asks.

## Scope And Filters

Use the machine catalog as the Brain registry:

```sh
bigbrain brains list --json
```

For a generic request such as “what's next”, “my tasks”, or “what should I do next”, query all verified registered Brains. For an explicit Brain scope such as “what's next in my personal brain”, “what's next in ICAIRE”, or “tasks in Dealmaking”, filter the catalog before live verification and task retrieval.

Match a requested Brain case-insensitively against the full Brain name and its natural short form, or exactly against `brain_id` or `connection.handle`. A phrase such as “personal brain” selects Personal Brain only. If a name matches no registered Brain or is materially ambiguous, show the registered names and ask for the intended scope rather than guessing.

Preserve user-requested task filters across every selected Brain:

- Default assignee: `me`.
- Default statuses: `in_progress` and `open`.
- Use a named assignee, status, priority, readiness, or execution mode when requested.
- Omit the assignee only when the user explicitly asks for all-team, everyone's, or unassigned work.
- Include waiting, done, or archived tasks only when explicitly requested.

## Workflow

1. Resolve scope from the live registry.
   - Run `bigbrain brains list --json` before querying a task endpoint.
   - Start with every catalog entry whose verification state is `verified`.
   - Apply any user-requested Brain filter before resolving MCP tools.
   - Record the names and count of selected registered Brains for exact coverage reporting.
   - Include non-Brain task sources only when explicitly requested.
   - Anti-patterns: hardcoding known Brains, discovering Brains from installed skills, querying the current Brain only, applying the Brain filter after task retrieval
2. Resolve and verify each Brain independently.
   - Use `connection.handle` to locate that Brain's `about`, `me`, `tasks/summary`, and later `tasks/get` tools.
   - If expected tools are hidden, use targeted tool discovery and `$find-missing-tools` before declaring the Brain unavailable.
   - Call authenticated `about` and require an exact `about.brain_id` match, usable authentication, a valid live profile or manifest, and `capabilities.read: true`.
   - Do not require write capability for this read-only workflow and do not treat stale catalog timestamps as live authority.
   - Run independent Brain checks concurrently when the runtime permits.
   - On a failure, mark only that Brain unavailable and continue.
   - Anti-patterns: guessing MCP aliases, trusting catalog health as current, accepting an identity mismatch, requiring write access, failing the whole snapshot because one Brain is unavailable
3. Resolve the authenticated member and task filters.
   - Call `me` separately through each verified Brain before using `assignee: me`; member slugs can differ between Brains.
   - Apply the same resolved task filters to every selected Brain.
   - If `me` fails for one Brain, report that Brain unavailable for personal-task filtering instead of listing everybody's tasks.
   - Anti-patterns: assuming one member slug works everywhere, silently dropping an assignee filter, changing filters between Brains, including closed work by default
4. Retrieve every compact summary page.
   - Call each owning Brain's `tasks/summary` with the resolved filters, `limit: 100`, and the initial cursor accepted by that tool.
   - Follow `next_cursor` with identical filters until it is null.
   - Capture only the stable task slug or ID, title, Brain attribution, status, priority, due date, assignee match, readiness, execution mode, `open_questions_state`, open-question count, waiting or blocked state, and update time.
   - Do not call `tasks/get` during discovery or ranking.
   - Anti-patterns: stopping after the first page, using full task listings by default, retrieving exact questions before selection, losing Brain attribution
5. Normalize and rank globally.
   - Use Brain ID plus task slug as the deduplication key and deterministic tie-breaker.
   - Prefer `in_progress` work, then higher priority, explicit due dates, and current-user assignment.
   - Ready work requires `readiness: ready`, `execution_mode: agent` or `interactive`, and `open_questions_state: none`.
   - Put `open_questions_state: present`, underspecified work, and other input-dependent tasks under `I also need your input on a few tasks:`.
   - Treat `open_questions_state: missing` as unknown and keep it out of autonomous ready work.
   - Put `execution_mode: user` under `There are a few things I can't physically help with:`.
   - Anti-patterns: merging tasks by title across Brains, ranking body prose, treating missing metadata as ready, placing user-only work in the agent-ready list
6. Report a concise snapshot with exact coverage.
   - Start with `What's Next` and state `X/Y registered Brains queried` for the selected scope.
   - Label every task with its owning Brain name, including when only one Brain was requested.
   - Cap the default ready list at eight items unless the user asks for more.
   - Omit empty user-action and input-needed sections.
   - Add `Unavailable Brains` whenever an in-scope registered Brain could not be queried, with the reason and recovery step.
   - Never claim an all-Brain view when coverage was partial.
   - Anti-patterns: omitting coverage, hiding unavailable Brains, exposing slugs or technical IDs by default, presenting partial results as complete
7. Fetch full context only after selection.
   - Resolve the selected task from its preserved Brain ID, handle, and task slug.
   - Call `tasks/get` through that exact owning Brain and recheck current status, body, timeline, sources, readiness, execution mode, and exact open questions.
   - If the user supplies missing context, enrich the owning task through the appropriate BigBrain workflow. Do not treat their answer as permission to execute the task.
   - For fanout, preserve the selected task's Brain identity through the handoff. Use a compatible Brain-specific fanout workflow when available, or create the handoff directly from the owning Brain's full record.
   - Never move or duplicate the task into another Brain.
   - Anti-patterns: prefetching unselected tasks, calling `tasks/get` through the wrong Brain, losing Brain identity during fanout, starting task execution without an explicit request

## Anti-Patterns

- Maintaining a fixed list of Brains.
- Treating the current Brain or installed `*-whats-next` skills as the Brain registry.
- Defaulting a failed specialized Brain query to Personal Brain.
- Querying all Brains after the user explicitly requested one Brain.
- Trusting stale catalog authentication or health instead of live `about`.
- Fetching full task content before selection.
- Mutating tasks while building the snapshot.
- Using local TODO discovery by default.
- Showing task slugs, Brain IDs, handles, or cursors unless requested.
- Starting work in the snapshot task without explicit execution authorization.

## Output

For the default all-Brain scope:

```text
What's Next
3/3 registered Brains queried

1. Run the Batic BD two-week pilot (Personal Brain) - P0, in progress
2. Prepare the programme standup (ICAIRE Brain) - P1
3. Review the investor outreach queue (Dealmaking Brain) - P1

I also need your input on a few tasks:
1. Decide the company ownership structure (Personal Brain) - 3 open questions

Would you like Codex tasks launched for any of the ready items?
```

For “what's next in my personal brain”:

```text
What's Next
1/1 registered Brains queried: Personal Brain

1. Run the Batic BD two-week pilot (Personal Brain) - P0, in progress
```

Only when matching user-only tasks exist, add exactly:

```text
There are a few things I can't physically help with:
```

Only when input-dependent tasks exist, add exactly:

```text
I also need your input on a few tasks:
```

Use compact reason or question-count metadata in the snapshot. Retrieve and show exact questions only after the user selects that task.

If coverage is partial, add:

```text
Unavailable Brains
- Dealmaking Brain: authentication failed. Reconnect the registered Dealmaking MCP and rerun.
```

Do not show task slugs, Brain IDs, MCP handles, cursors, or exact open-question text by default. If no actionable tasks match, say so directly and offer `BigBrain: Roadmap Tasks` only if the user wants new tasks proposed from current Brain evidence.
