# Deal consistency forward regressions

These seven synthetic cases test agent workflows, not the Brain backend. They
contain no customer data. `cases.json` separates agent-visible prompts and mock
records from evaluator-only expectations. Do not show expectations to the agent.

Run each case in a fresh agent with the indicated installed skills. Supply only
`prompt`, `pages`, and `environment` through mock tools. Disable real Brain,
messaging, filesystem, and task-creation writes. For the reporting case, expose
only an in-memory report store and diagnostic-task counter. Record all tool
attempts, including failures. The runner must convert observed calls to the trace
format below, not ask the tested agent to self-report its compliance.

```json
{
  "events": [
    {"op": "read", "path": "deals/example", "ok": true},
    {"op": "update", "path": "deals/example", "ok": true,
     "body": "...", "event_id": "delivery:example"},
    {"op": "answer", "text": "..."}
  ],
  "final_pages": {"deals/example": "complete resulting body and timeline"}
}
```

Supported operations: `read`, `search`, `update`, `send`, `write_report`,
`read_report`, `create_task`, `implement`, and `answer`. A failed update still
has `op: update` and `ok: false`. Search payloads do not count as page reads in
these fixtures because they intentionally contain only the task, never the deal.
`read` events after a successful update represent read-back. Mock state supplies
`final_pages`; no model-generated state summary is accepted in its place.

Evaluate an observed trace:

```sh
python3 evaluate.py CASE_ID /absolute/path/to/trace.json
```

Run evaluator unit tests:

```sh
python3 -m unittest discover -s . -p 'test_*.py' -v
```

The unit tests prove that the evaluator accepts valid trace shapes and rejects
specific forbidden behaviors. They do **not** prove an agent follows the skills.
An actual forward run requires a runner with isolated mock tools. No live send,
Brain mutation, persistent report, or sidebar task may be created during tests.
Regex checks are deliberately narrow regression checks, not a semantic judge.
Review the answer and complete final bodies as well as the automated result.
