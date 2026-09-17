# Playbooks

Playbooks are optional workflows layered on top of the Big Brain platform. The
platform owns shared page, graph, identity, database, audit, and dashboard
infrastructure. A playbook owns its workflow, overlay records, API contract,
skill, and dashboard experience.

## Boundary

- Keep playbook domain logic and overlay storage under `src/bigbrain/playbooks/`.
- Keep playbook dashboard code under `src/dashboard-client/playbooks/`.
- Keep each playbook's panel in its own module. The shared playbook shell may
  compose panels, but it must not move their workflow state into the platform
  dashboard.
- Keep playbook records scoped by Brain and keyed by playbook. Never add
  playbook fields to canonical page Markdown merely to make a workflow visible.
- Route playbook API requests through `/api/playbooks/<id>/...` and keep the
  playbook implementation responsible for its payload and mutations. The
  dashboard server should only provide the platform routing boundary.

## Navigation

- Graph and Explorer are platform navigation and may appear in the primary
  header.
- Playbooks are secondary workflows. Their only primary-shell entry point is
  the `Playbooks` button and its menu.
- Do not append enabled playbooks to the header `views` array, add playbook
  chips, or expose a playbook shortcut as a platform navigation tab.
- A playbook shortcut may open an enabled playbook panel, but it must be
  registered and handled inside the playbook shell.

## Adding a playbook

1. Add the domain and storage implementation under `src/bigbrain/playbooks/`.
2. Add the dashboard panel under `src/dashboard-client/playbooks/`.
3. Register only metadata and playbook-owned endpoints in the playbook
   registry.
4. Add the panel and enablement behavior to the shared playbook shell.
5. Add a boundary test proving the platform dashboard does not import the
   panel, own its storage, or add its label to primary navigation.
