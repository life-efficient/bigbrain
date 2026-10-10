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

The Deals overlay is a read-only view of the selected Brain's indexed canonical
`deals/` pages. It includes `deal_involvement` values `active`,
`network_actionable`, and `network_observed`. Public transactions, unclassified
pages, and source attachments are excluded. Classifications belong on actual
deal pages, not buyer research or supporting documents.

- Open the panel from Overlays or `/overlays/deals`.
- Retrieve it through MCP `overlays/deals` (alias `overlays_deals`) or HTTP
  `GET /api/overlays/deals`.
- Both endpoints accept `limit` (1 to 100, default 100), `cursor` (an offset),
  and an optional single `deal_involvement` filter.
- Results contain `records` with `page_slug`, `title`, `summary`,
  `deal_involvement`, and `updated_at`, plus `total` and `next_cursor`.
  Follow `next_cursor` until null to retrieve all deals.
- First-class summaries are returned in full. Pages without one use a bounded
  excerpt from indexed text; the request never scans source files or calls a model.
- This view is derived, so it requires no enrollment records or knowledge copies.
  It is Brain-scoped and protected by the existing dashboard and MCP read access.
