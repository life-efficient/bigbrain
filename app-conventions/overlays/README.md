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

Qualifying is a stage. Establishing arrangement follows it and covers our mandate,
fees, scope and authority with the originating party. Counterparty-specific
investment or supply terms belong to the introduction's discussion/negotiation.
Paused and Dropped are not deal stages; use Archived status. Declined remains a
valid introduction outcome. Archived cards retain their stage but cannot be
dragged until restored. Stage saves check status as well as stage and evidence
date to prevent edits racing an archive action.

### Deal layouts

The Deals view has an icon toggle for list and kanban layouts, with accessible
names, keyboard navigation, and a visible selected state. Retain the selected
layout within the session. Both layouts use the same search and filters.

Kanban groups deals by their recorded deal stage in lifecycle order, with counts
and compact cards that open the ordinary deal page. Missing or unrecognised
stages appear under Stage not established. Keep stage columns stable, including
empty destinations, and horizontal scrolling inside the board. Changing layouts does not change deal
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

Canonical deal fields are `anonymised_title`, `anonymised_description`, and
`anonymised_asks`. Each ask is a complete, evidence-backed contribution sought
from a potential new participant. Documents, approvals, or replies owed by an
existing party belong in linked tasks. An empty ask list is valid.

Copy and export actions use only the anonymised fields. Never substitute internal
titles, summaries, page paths, parties, tasks, relationship history, or private
commercial details. Authors prepare the anonymised wording; export does not
attempt automatic anonymisation of internal text.

### PDF overview

**Download PDF** exports all active enrolled deals, regardless of the current search,
filters, or pagination. Archived deals are excluded. It downloads an actual PDF containing each anonymised
title, description, and ask list. Do not use the browser print dialog or export
the internal screen. Keep typography black, with readable wrapping, pagination,
and page numbers. Missing required anonymised information must produce a useful
error rather than silently omit a deal or fall back to internal fields.

The export remains behind the existing authenticated Brain read boundary and
must not publish pages, change visibility, or upload the document elsewhere.

### Editing

Add/edit actions use dialogs with explicit Save and Cancel. Failed saves retain
the draft. Writes update canonical frontmatter and refresh the record. Optimistic
concurrency checks reject stale edits instead of overwriting newer values.
