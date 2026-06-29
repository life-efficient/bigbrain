---
name: bigbrain-page-visibility
description: |
  Change or inspect BigBrain page visibility for public sharing. Use when the
  user asks to make a BigBrain page public, unpublish a page, make a page
  internal/private again, check whether a page is public, get a public link, or
  manage the explicit `visibility: internal | public` publishing state for a
  BigBrain page.
---

# BigBrain: Page Visibility

Use this skill to inspect or change one BigBrain page's public visibility. The
safe default is `internal`; public sharing must be explicit and revocable.

## Contract

This skill guarantees:
- Resolve exactly one target page before changing visibility
- Read current visibility before writing
- Use the dedicated visibility tool or endpoint, not ordinary page update
- Publish only the page body above the timeline separator
- Keep frontmatter, timeline entries, task metadata, raw files, graph data,
  search, dashboard state, and private linked pages private unless a raw file is
  explicitly allowlisted with `public_raw_files`
- Report the resulting visibility and public URL when one exists
- Stop if the request is ambiguous or no dedicated visibility capability is
  available

## Workflow

1. Confirm the intended action from the user request:
   - `public` for publish, share publicly, make public, or get a public link
   - `internal` for unpublish, make private, revoke public access, or make
     internal
   - inspect only when the user asks whether a page is public
2. Resolve the page slug:
   - use an explicit slug or path when provided
   - otherwise search/read/list BigBrain pages to find the canonical page
   - if more than one page matches, ask the user which page to use
3. Discover the visibility tools if they are not already loaded:
   - search for `mcp__bigbrain.get_page_visibility`
   - search for `mcp__bigbrain.set_page_visibility`
   - if slash-style names are not supported, look for aliases with the same
     `get_page_visibility` or `set_page_visibility` tool names
4. Read current visibility with `get_page_visibility`.
5. If the user only asked to inspect, report current visibility and public URL
   when available, then stop.
6. If the user asks to expose a raw artifact such as a PDF:
   - verify the raw path exists with `list_raw_files` or `read_raw_file`
   - include only the requested files in `public_raw_files`
   - prefer paths already linked from the page body, such as
     `ops/.raw/onboarding.pdf`
7. If changing visibility, call `set_page_visibility` with:
   - target page slug/path
   - `visibility: "public"` or `visibility: "internal"`
   - optional `public_raw_files: [...]` only when the user explicitly asked to
     expose raw artifacts
8. Read back or use the tool result to verify the final state.
9. Report:
   - page slug or title
   - previous visibility
   - final visibility
   - public URL if final visibility is `public`
   - whether the page is now unpublished if final visibility is `internal`

## Dashboard Fallback

If MCP visibility tools are genuinely unavailable but the hosted dashboard API
is reachable and authenticated, use the dedicated dashboard mutation endpoint:

```text
POST /api/page/visibility
```

Do not use generic page create/update APIs as a fallback. Visibility changes are
an explicit page-level action.

## Guardrails

- Do not publish a page from a vague request such as "share this" unless the
  target page and desired public visibility are clear.
- Do not infer a page slug from memory when a live search/read can verify it.
- Do not edit markdown frontmatter directly unless the dedicated tool and API
  are unavailable and the user explicitly approves a manual recovery path.
- Do not mark linked pages, raw files, or attachments public automatically.
- Do not expose raw files unless the user explicitly asks for raw artifact
  sharing and the file path is verified.
- Do not claim a public page is live without a public URL or a verified final
  visibility result.
- Do not hide the body-only publication boundary; tell the user when relevant
  that only the page body is exposed.
- Do not use ICAIRE visibility tools for a personal BigBrain page, or BigBrain
  visibility tools for an ICAIRE page.

## Forward Test Prompts

Use these prompts when validating the skill after edits:

- Should trigger: "Make `projects/example` public and give me the link."
- Should trigger: "Is `ops/example-onboarding` public?"
- Should trigger: "Unpublish the page I just shared."
- Should not trigger by itself: "Export this page as a PDF for now."
- Should not trigger by itself: "Update this page's summary."

## Output

Keep the response short. For a successful publish:

```text
Published `projects/example` publicly: https://.../public/projects/example
Only the page body is public; private linked pages and unlisted raw files remain
private.
```

For a successful unpublish:

```text
Set `projects/example` back to internal. The previous public URL now returns as
unpublished/private.
```

For an inspect-only request:

```text
`projects/example` is public: https://.../public/projects/example
```
