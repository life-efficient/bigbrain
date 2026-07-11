# App Conventions

This folder captures durable implementation conventions for this app. Use these
notes before changing related UI, data, auth, navigation, or local development
behavior.

Schema version: `app-conventions/v1`.

## How To Use

- Read `schema/app-conventions.schema.json` to understand the expected layout.
- Read the relevant nested README before editing that area.
- Add new conventions when a user makes a durable product or implementation decision.
- Keep notes actionable and scoped to behavior future agents must preserve.

## Sections

- `app-surfaces/` for public, authenticated, admin, internal, and preview surfaces.
- `auth-and-sessions/` for sign-in, sign-out, session, authorization, and redirects.
- `navigation/` for sidebar, header, route, menu, tab, and deep-link behavior.
- `registration/` for registration flows, admin settings, forms, cohorts, and dates.
- `email-delivery/` for transactional email providers, sender domains, secrets, and delivery checks.
- `visual-design/` for layout, forms, buttons, density, contrast, notifications, and responsiveness.
- `data-and-state/` for state ownership, persistence, imports, and data assumptions.
- `local-development/` for ports, dev-server expectations, callbacks, and build checks.
