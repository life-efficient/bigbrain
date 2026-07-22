# UI Design Rules

Document durable UI implementation rules for rendered verification, content
hierarchy, shared primitives, control placement, compact layouts, interaction
primitives, modal behavior, responsive behavior, layout constraints, and visual
states.

## Loading Skeletons

- Fixed chrome should render first: app bars, sidebars, route headers, tabs, and
  primary navigation should not wait for data that they do not depend on.
- Replace full-page loading messages with skeletons inside the data-dependent
  region: cards, rows, metrics, tables, maps, charts, and recipient lists.
- Do not skeletonize static labels, known copy, stable buttons, page headings,
  or tabs. If a label is known and only its count/value is pending, render the
  label and skeletonize only the missing number/value.
- Match skeleton dimensions to the final component to avoid layout jumps.
- Public surfaces with mostly static content may render static baseline content
  immediately and hydrate live data in place.
- Skeletons should be visual placeholders, not extra explanatory copy.

## Data Visualizations

- Preserve the surrounding app shell while graph data and layouts are loading; a graph renderer must not monopolize the renderer thread or make fixed navigation disappear.
- Bound entrance effects independently of dataset size. Dense graphs should animate a representative subset of nodes and links while rendering the remainder statically.
- Memoize static, expensive SVG layers such as link paths and cluster decoration so hover and selection changes only update affected nodes and labels.
- Reserve blur and glow filters for active or hovered elements. Do not apply GPU-heavy filters or independent infinite animations to every graph element.
- Offer dense graph layouts that scale their virtual canvas with node count and enforce node separation; do not force every brain into one fixed coordinate space.

## Desktop Shell Theming

- Treat onboarding as part of the desktop shell, not as a separate branded surface.
- Reuse the dashboard's dark neutral palette, translucent surfaces, borders, text hierarchy, and monochrome controls.
- Primary onboarding actions use the shell's white-on-dark emphasis. Do not introduce an unrelated accent color for setup buttons, choices, or focus states.
