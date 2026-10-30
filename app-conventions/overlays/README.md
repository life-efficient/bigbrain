# Overlays

Overlays are optional workflows layered on top of the Big Brain platform. The
platform owns shared page, graph, identity, database, audit, and dashboard
infrastructure. An overlay owns its workflow, overlay records, API contract,
skill, and dashboard experience.

## Boundary

- Keep overlay domain logic and overlay storage under `src/bigbrain/overlays/`.
- Keep overlay dashboard code under `src/dashboard-client/overlays/`.
- Keep each overlay's panel in its own module. The shared overlay shell may
  compose panels, but it must not move their workflow state into the platform
  dashboard.
- Keep overlay records scoped by Brain and keyed by overlay. Never add
  overlay fields to canonical page Markdown merely to make a workflow visible.
- Route overlay API requests through `/api/overlays/<id>/...` and keep the
  overlay implementation responsible for its payload and mutations. The
  dashboard server should only provide the platform routing boundary.

## Navigation

- Graph and Explorer are platform navigation and may appear in the primary
  header.
- Overlays are secondary workflows. Their only primary-shell entry point is
  the `Overlays` button and its menu.
- Do not append enabled overlays to the header `views` array, add overlay
  chips, or expose an overlay shortcut as a platform navigation tab.
- An overlay shortcut may open an enabled overlay panel, but it must be
  registered and handled inside the overlay shell.

## Adding an overlay

1. Add the domain and storage implementation under `src/bigbrain/overlays/`.
2. Add the dashboard panel under `src/dashboard-client/overlays/`.
3. Register only metadata and overlay-owned endpoints in the overlay
   registry.
4. Add the panel and enablement behavior to the shared overlay shell.
5. Add a boundary test proving the platform dashboard does not import the
   panel, own its storage, or add its label to primary navigation.

## Deals

The Deals overlay is available at `/overlays/deals` and has two views:

- **Deals** shows the enrolled canonical deal pages, their progress, next actions,
  and editable anonymised information.
- **Deal introductions** shows a flat list of canonical `deal_introductions/`
  pages, with parent deal, participating parties, commercial purpose, stage,
  evidence date, and linked follow-up tasks. Include introductions even when their
  parent is not enrolled in the Deals view. Each row opens the ordinary Brain page.

The Deals view includes `deal_involvement` values `active`, `network_actionable`,
and `network_observed`. Exclude public transactions, unclassified research,
and source attachments. Follow pagination to retrieve the complete collection.
Search and filters apply to the active view; introduction-stage filtering uses
its own stage rather than its parent's stage.

### Status and stage

`deal_status` and `introduction_status` each distinguish `active` from `archived`.
Both views default to Active and offer Archived and All status filters. Archive
and Restore are explicit independent actions. Neither cascades to related pages
or tasks, and neither changes the last commercial stage or its evidence date.

Qualifying is a deal stage. Arrangement is an independent three-option
pill on deal introductions: No arrangement (`none`), Establishing arrangement
(`establishing`), and Arrangement agreed (`agreed`). It records facilitation
scope, fees, authority or permissions for that route without replacing its stage.
Unset defaults to No arrangement, meaning no arrangement is recorded.
Counterparty-specific investment or supply terms remain discussion/negotiation.
Paused and Dropped are not deal stages; use Archived status. Declined remains a
valid introduction outcome. Archived cards retain their stage but cannot be
dragged until restored. Stage saves check status as well as stage and evidence
date to prevent edits racing an archive action.

### Deal layouts

Deals and Deal introductions default to kanban and each have an icon toggle
for list and kanban layouts, with accessible names, keyboard navigation and a
visible selected state. Retain each view's layout independently within the session.
Both layouts use the same search and filters.

Introduction kanban groups by introduction stage, independent of the parent deal
and arrangement option. Cards show parties, parent deal, purpose, arrangement
pill and next-action context; Archive / Restore stays in the card menu. Dragging
an active introduction updates only its stage and evidence date with concurrency
checks. Preserve its arrangement option and parent deal.

A shared Regular / Anonymised toggle switches deal titles and descriptions in
both layouts, including drag previews and action labels. Retain the selection
within the session. Missing anonymised text gets an explicit empty state, never
an internal-title or summary fallback. The PDF and copy actions remain anonymised.

Kanban groups deals by their recorded deal stage in lifecycle order, with counts
and compact cards that open the ordinary deal page. Missing or unrecognised
stages appear under Stage not established. Keep valid stage columns stable, including
empty destinations; show Stage not established only when it contains records, and horizontal scrolling inside the board. Changing layouts does not change deal
stages or the complete anonymised PDF export.

Drag a deal by its dedicated handle to change its stage. Use an accessible
drag-and-drop primitive with pointer, touch, and keyboard support, a lifted card
preview, clear drop targets, cancellation, and horizontal autoscroll. Empty
stages must be reachable destinations. Keep page links independently clickable.

Stage moves write the canonical deal page and record the explicit manual change
with an evidence timestamp. Check the previously read stage and timestamp to
prevent overwriting newer edits. Show immediate movement and saving feedback;
restore the previous position on failure and refresh stale data. A cancelled or
same-stage drop does not write. Verify real persistence using synthetic fixtures
rather than changing actual deal facts during UI testing.

### Anonymised information

Canonical deal fields are `anonymised_title`, `anonymised_description`, `anonymised_asks`, and `anonymised_stage_comment`. Each ask is a complete, evidence-backed contribution sought
from a potential new participant. Documents, approvals, or replies owed by an
existing party belong in linked tasks. An empty ask list is valid.

The stage comment explains current progress, the next dependency and the party role that needs to act, using shareable wording rather than internal task text. A real stage move clears the previous comment; edit it for the new stage. Comment writes include the current stage and evidence-date snapshot so a stale editor cannot restore old progress.

Copy and export actions use only the anonymised fields and an allowlisted stage label. Never substitute internal
titles, summaries, page paths, parties, tasks, relationship history, or private
commercial details. Authors prepare the anonymised wording; export does not
attempt automatic anonymisation of internal text.

Anonymisation removes company, project and person names, not the deal's substance.
Keep evidenced technology, capacity, scale, geography, traction, economics and
commercial requirements. Preserve authorised differentiators, including family
pedigree and government relationships, without naming the parties. Do not erase
useful facts merely because they are distinctive or potentially recognisable.
Keep specific material uncertainty, but avoid generic defensive caveats. Private
sourcing routes, contact details and strategy remain excluded unless explicitly
authorised for the audience. Zod is the description authority for both ordinary
page schemas and the Deals MCP editing fields.

### PDF overview

**Download PDF** exports all active enrolled deals, regardless of the current search,
filters, or pagination. Archived deals and records explicitly marked `shareable: false` are excluded. Explicit selections containing either are rejected. It downloads an actual PDF containing each anonymised
title, description, stage, stage comment and ask list. Legacy blank comments are permitted; do not invent a fallback from internal notes. Do not use the browser print dialog or export
the internal screen. Keep typography black, with readable wrapping, pagination,
and page numbers. Missing required anonymised information must produce a useful
error rather than silently omit a deal or fall back to internal fields.

The export remains behind the existing authenticated Brain read boundary and
must not publish pages, change visibility, or upload the document elsewhere.

### Editing

Add/edit actions use dialogs with explicit Save and Cancel. Failed saves retain
the draft. Writes update canonical frontmatter and refresh the record. Optimistic
concurrency checks reject stale edits instead of overwriting newer values. Kanban editing includes internal title and description plus anonymised title, description and asks for deals; introductions expose title, purpose and arrangement. Preserve page content and unrelated stage/status fields.

Per-deal copy, edit, add, delete, archive and restore controls use compact icon
buttons with specific accessible labels and tooltips. Keep explicit labels on
dialog confirmations and the primary PDF export. Kanban Archive / Restore lives
in a Radix action menu in the card footer, alongside deal selection. The menu also opens the editing dialog. Keep the drag handle in the header.

## Deals toolbar

- Use the Deals and Deal introductions tabs as the visible page heading. Keep the semantic heading visually hidden.
- Keep view tabs and the list/kanban toggle in the top toolbar. Put the fixed-width numeric result count and all view-specific controls, including text mode, PDF export, search, and filters, in the row below. Animate search expansion, respecting reduced motion. Keep PDF export pinned at the right on the same row; allow the filter controls to scroll horizontally when space is limited. Counts use tabular numerals and reserved width so updates never shift controls.
- Use accessible labels for filters and a descriptive tooltip for anonymised PDF export. Avoid repeated subtitles, export captions, and persistent drag instructions above the board.

- PDF export is a key action: keep a visible Download PDF label and primary emphasis in the second row. Search defaults to a compact magnifying-glass trigger and expands on demand.

- Deals support active-deal selection across list and kanban, select-all-visible and clear-selection controls. PDF export uses exactly the selection when present, otherwise all active deals. Selection survives filtering and layout changes; archived or removed deals are pruned. Selected exports use the same strict anonymised-field projection and reject missing or ineligible requested deals.


## Deals MCP tools

The same canonical operations are available through MCP. Every slash name also
has an underscore alias (for example `overlays_deals_update_details`).

| Tool | Purpose |
| --- | --- |
| `overlays/deals` | Paginated enrolled deals, regular and anonymised fields, progress, introductions, tasks and `edit_values`. |
| `overlays/deals/introductions` | Paginated introductions, including those whose parent is not enrolled. |
| `overlays/deals/update_details` | Edit a deal's title, description and anonymised fields, or an introduction's title, purpose and arrangement. |
| `overlays/deals/update_asks` | Edit anonymised asks, optionally title and description. Asks seek contributions from new participants; existing-party follow-ups belong in tasks. |
| `overlays/deals/update_stage` | Move an active deal to a supported stage. |
| `overlays/deals/introductions/update_stage` | Move an active introduction independently of its parent. |
| `overlays/deals/update_status` | Archive or restore a deal or introduction without changing its commercial stage. |
| `overlays/deals/introductions/update_arrangement` | Set `none`, `establishing` or `agreed`, independently of stage. |
| `overlays/deals/export` | Export anonymised JSON or an embedded PDF resource, for all active deals or exactly `page_slugs`. |

Read both collections through `next_cursor` until null. Read the record before
mutating it and pass the corresponding `expected_*` fields. For detail edits,
copy `edit_values` to `expected_values` and send the desired full field set in
`values`. Stale writes fail; re-read and reconcile rather than retrying an old
snapshot. Mutations require `commit_message` and source `provenance`, write
scope and page-edit permission for the target path. Returned maintenance warnings
mean the canonical write succeeded but indexing or backup needs attention.

Export defaults to `format: "json"`; `format: "pdf"` returns an MCP embedded
resource with MIME type `application/pdf`. Omit `page_slugs` for all active deals;
a supplied selection must be nonempty and every requested deal must be eligible.
No private field fallback, raw attachment creation, publishing or external upload
occurs. List/kanban layout and selection remain client state; callers express an
export selection explicitly. Use ordinary canonical page creation tools to create
new deals or introductions, then read the overlay for their current snapshots.
