# Codex MCP Lazy Tool Discovery

Codex can expose MCP tools lazily. A server may be registered and healthy while
known tools are absent from the current visible tool list until targeted
discovery runs for their exact names. Do not treat a sparse initial tool list as
proof that the server lacks the capability.

## Failure Mode

Observed pattern:

1. A BigBrain-style MCP server is configured.
2. Broad tools such as `search`, `query`, or `list` appear.
3. Specific tools such as `tasks/list`, `create_page`, `read_raw_file`, or
   `board_snapshot` appear unavailable.
4. Targeted discovery for exact names, for example
   `mcp__icaire.tasks/list` or `mcp__icaire_board.board_snapshot`, exposes the
   missing tools.

This is a Codex tool-surface loading issue, not necessarily a server issue.

## Resolver Checklist

Use this order before falling back to local files, manual markdown edits, or
claiming an MCP workflow is blocked:

1. Confirm the intended server namespace: `bigbrain`, `icaire`, `granola`, or
   `icaire_board`.
2. Check whether the server is disabled or absent from Codex MCP registration.
   If it is disabled, report `server_disabled` and the config/server name.
3. Check whether the server requires login. If OAuth or bearer credentials are
   missing or stale, report `not_logged_in` and the login/config action.
4. If any tools from the server are visible, treat the server as partially
   exposed and run targeted discovery for every expected tool in the workflow.
5. Search by exact Codex-style name first, for example
   `mcp__icaire.create_page`; for slash tools also try the slashless alias, for
   example `mcp__icaire.tasks_list`.
6. If targeted discovery exposes the tools, continue through MCP and note that
   the workflow was `resolved_after_discovery`.
7. If targeted discovery does not expose a required tool, report the exact
   missing tool names and do not substitute a weaker workflow silently.

## Expected Tool Groups

BigBrain page and task tools:

```text
mcp__bigbrain.me
mcp__bigbrain.search
mcp__bigbrain.query
mcp__bigbrain.list
mcp__bigbrain.read
mcp__bigbrain.filing_rules
mcp__bigbrain.create_page
mcp__bigbrain.update_page
mcp__bigbrain.get_page_visibility
mcp__bigbrain.set_page_visibility
mcp__bigbrain.tasks/list
mcp__bigbrain.tasks/create
mcp__bigbrain.tasks/update
mcp__bigbrain.list_raw_files
mcp__bigbrain.read_raw_file
mcp__bigbrain.create_raw_file
mcp__bigbrain.create_raw_file_with_page
mcp__bigbrain.update_raw_file
mcp__bigbrain.delete_raw_file
```

ICAIRE read, write, task, and raw-file tools:

```text
mcp__icaire.me
mcp__icaire.search
mcp__icaire.query
mcp__icaire.list
mcp__icaire.read
mcp__icaire.filing_rules
mcp__icaire.create_page
mcp__icaire.update_page
mcp__icaire.tasks/list
mcp__icaire.tasks/create
mcp__icaire.tasks/update
mcp__icaire.list_raw_files
mcp__icaire.read_raw_file
mcp__icaire.create_raw_file
mcp__icaire.create_raw_file_with_page
mcp__icaire.update_raw_file
mcp__icaire.delete_raw_file
```

Granola folder-aware meeting tools:

```text
mcp__granola.get_account_info
mcp__granola.list_meeting_folders
mcp__granola.list_meetings
mcp__granola.get_meetings
mcp__granola.get_meeting_transcript
```

ICAIRE Board read and update tools:

```text
mcp__icaire_board.board_snapshot
mcp__icaire_board.initiative_list
mcp__icaire_board.initiative_update
mcp__icaire_board.milestone_list
mcp__icaire_board.milestone_update
mcp__icaire_board.task_list
mcp__icaire_board.task_update
mcp__icaire_board.step_list
mcp__icaire_board.step_update
```

## Status Meanings

- `resolved`: every expected tool was already visible.
- `resolved_after_discovery`: at least one expected tool required targeted
  discovery and all expected tools are now available.
- `partial`: some expected tools resolved, but targeted discovery still left
  required tools missing.
- `missing`: no expected tools resolved after targeted discovery.
- `server_disabled`: Codex registration or configuration has the server
  disabled or absent.
- `not_logged_in`: the server exists but credentials, OAuth login, or bearer
  token state is missing or stale.

## Implementation Hook

The reusable manifest and resolver live in:

```text
src/bigbrain/codex-mcp-tool-discovery.js
```

The test suite verifies the expected tool groups and the partial-exposure,
disabled-server, missing-tool, and not-logged-in branches:

```text
test/bigbrain/codex-mcp-tool-discovery.test.mjs
```
