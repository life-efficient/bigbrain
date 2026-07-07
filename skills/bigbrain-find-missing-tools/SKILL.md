---
name: "BigBrain: Find Missing Tools"
version: 1.0.0
description: |
  Resolve missing or partially visible MCP tools in Codex before falling back
  to local files, manual edits, or weaker workflows. Use when a known MCP tool
  should exist but is not currently visible, when only part of a server's tool
  surface appears, or when an agent is about to conclude that an MCP capability
  is unavailable.
triggers:
  - "find missing tools"
  - "missing MCP tool"
  - "MCP tool unavailable"
  - "tool is not visible"
  - "lazy loaded tools"
  - "targeted tool discovery"
tools:
  - tool_search
  - mcp
mutating: false
---

# BigBrain: Find Missing Tools

Use this skill when Codex appears to be missing an MCP tool that the current
workflow expects. Codex can expose MCP tools lazily: a server may be configured
and partially visible while specific tools remain unavailable until targeted
discovery is run for their names.

This skill is a discovery workflow. It does not call the target tool, mutate
brain pages, update tasks, or repair MCP configuration by itself. Its job is to
determine whether the tool is loaded, discoverable, blocked by configuration or
login, or genuinely absent.

When the MCP server name is known, prefer deterministic config-backed discovery
before relying on the visible lazy-loaded tool surface:

```sh
node scripts/discover-codex-mcp-tools.mjs --name <mcp-server-name> --tool <expected-tool> --names-only
```

That helper reads Codex config files, resolves the named MCP server, and runs a
direct MCP `initialize` plus `tools/list` probe where possible. It supports both
HTTP and stdio MCP entries. When `--tool` is provided, it reports whether the
expected tool appears in the direct `tools/list` result.

## Inputs To Collect

Before concluding anything, identify:

- the intended MCP server namespace, if known
- the exact tool name or capability the workflow expects
- any aliases or slash-style variants the tool may use
- the currently visible tools from that server, if any
- whether the server is registered, disabled, unauthenticated, or returning an
  error

If the current task or skill already names the expected tool, use that name
instead of inventing a broader search.

## Workflow

1. Normalize the expected tool names.
   - Keep the original name exactly as written.
   - If the name contains `/`, also try an underscore variant.
   - If the current harness uses fully qualified names, include the namespace
     prefix form.
   - If only a capability is known, search for the smallest concrete verb/noun
     phrase first, such as `tasks/list`, `read`, `create_page`, or
     `filing_rules`.
2. Run deterministic config discovery when the server name is known.
   - Use `node scripts/discover-codex-mcp-tools.mjs --name <mcp-server-name> --tool <expected-tool> --names-only`.
   - If it returns `resolved`, compare the expected tool against `tool_names`.
   - If it returns `server_disabled`, `not_configured`, or `not_logged_in`,
     report that blocker instead of guessing from the lazy-loaded surface.
   - If it returns `tool_error`, keep the error text and continue with targeted
     discovery only when that could still expose a client-side lazy-load issue.
3. Check for partial exposure.
   - If any tool from the same server is visible, treat the server as partially
     exposed, not broken.
   - Do not fall back just because one specific tool is absent from the first
     visible tool list.
4. Run targeted discovery.
   - Search for the fully qualified exact tool name.
   - Search for the bare tool name.
   - Search for slash and underscore variants when applicable.
   - Search for the related capability only after exact-name discovery fails.
5. Classify the result:
   - `resolved`: the expected tool is visible now.
   - `resolved_by_config`: deterministic config probing found the expected tool
     through direct `tools/list`.
   - `resolved_after_discovery`: targeted discovery exposed the expected tool.
   - `partial`: some server tools are visible, but the expected tool is still
     absent after targeted discovery.
   - `missing`: no matching tool or server surface can be found after targeted
     discovery.
   - `server_disabled`: the server is registered but disabled, or the expected
     server registration is absent.
   - `not_logged_in`: the server exists but requires OAuth, bearer-token setup,
     or a fresh authenticated session.
   - `tool_error`: the tool is visible but the discovery or harmless read probe
     returns a server-side error.
6. Continue or stop based on the classification.
   - For `resolved`, `resolved_by_config`, and `resolved_after_discovery`,
     return to the original workflow and use the discovered tool.
   - For `partial`, report the exact missing tool names and the discovery
     searches already attempted.
   - For `server_disabled` or `not_logged_in`, report the setup action needed
     instead of claiming the tool does not exist.
   - For `missing`, state that targeted discovery was exhausted before using a
     fallback.

## Search Pattern

Use this pattern, replacing placeholders with the actual server and tool names
from the current task:

```text
<fully-qualified-tool-name>
<server namespace> <tool name>
<bare tool name>
<slash-or-underscore-alias>
<capability phrase>
```

Examples of acceptable placeholder-derived searches:

```text
mcp__<server>.<tool>
<server> <tool>
<tool>
<tool_with_slashes_replaced_by_underscores>
```

Do not broaden to unrelated servers or unrelated products unless the user
explicitly changes the target workflow.

## Output

If this skill was invoked during a task, mention `BigBrain: Find Missing Tools`
in the final response and include the discovery classification, even when the
original workflow continues successfully.

Return a short status report:

```text
Tool discovery: resolved_by_config
Server: <server>
Expected tool: <tool>
Discovery attempted: <queries>
Next step: use <tool> in the original workflow.
```

For blockers:

```text
Tool discovery: not_logged_in
Server: <server>
Expected tool: <tool>
Discovery attempted: <queries>
Next step: authenticate or refresh the MCP session, then rerun targeted
discovery.
```

## Guardrails

- Do not edit files as a workaround until targeted discovery has been tried.
- Do not treat a sparse initial tool list as proof that the capability is
  absent.
- Do not call destructive or mutating tools merely to prove discovery worked.
- Do not switch to a different MCP server because the expected one is partially
  visible.
- Do not invent tool names. Use names from the active task, skill, connector
  docs, or live discovery output.
- Do not report "unavailable" without naming the exact discovery searches that
  failed.
