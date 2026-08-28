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
- Keep graph canvases transparent within the viewer. Do not paint a full viewBox-sized backdrop that exposes SVG letterboxing as a square or rectangular tile.
- Keep node labels in preset graph views at a readable 15px baseline. Custom may retain its compact label sizing because its presentation is explicitly user-controlled.
- Do not expose Vis Network as a selectable renderer for large Brains. Use deterministic custom coordinates with a fixed computation budget, relationship-derived communities, recognizable branches and satellites, and a dedicated circular rim for degree-zero pages. Keep coordinate computation separate from rendering so pan and zoom use the shared custom viewport without runtime physics.
- Keep `Orb`, `Diamond`, `Hex`, and the icon family (`Icon Ring`, `Icon Bare`, `Icon Solid`, `Icon Soft`, and `Icon Hex`) plus `Key`, `All`, and `Off` labels available in every selectable graph renderer. Icon nodes use stable semantic Lucide icons for BigBrain's canonical and legacy page types, plus a deterministic fallback for custom schema types. Node colour remains an independent option and must tint icons in Updated and Type modes or remain monochrome in None mode.
- When zooming beyond the fitted graph view, keep node glyphs approximately fixed in screen space while relationship geometry expands beneath them. This zoom compensation must apply to every node style, not only icons, so zooming reveals connection detail instead of magnifying node overlap. Allow nodes to shrink normally when zooming out.
- Let the Network graph view, including the legacy Vis Network renderer, zoom in to scale 10. Keep zoom anchored beneath the pointer and retain a conservative zoom-out floor so users can inspect dense local relationships without losing the graph entirely.
- Keep node sizing independent from node shape and colour. Treat Small, Medium, and Large as base sizes at neutral zoom, default new and previously unsized preferences to Medium, and apply responsive semantic zoom around the selected base. Use an eased logarithmic curve so Medium approaches Small at full zoom-out, remains Medium at scale 1, and approaches Large at full zoom-in.
- Animate live graph activity only after a successful MCP write has completed indexing. Keep motion bounded and provide a reduced-motion path.

## Desktop Shell Theming

- Treat onboarding as part of the desktop shell, not as a separate branded surface.
- Reuse the dashboard's dark neutral palette, translucent surfaces, borders, text hierarchy, and monochrome controls.
- Primary onboarding actions use the shell's white-on-dark emphasis. Do not introduce an unrelated accent color for setup buttons, choices, or focus states.
- Keep active-dashboard controls in one compact top row. Desktop-only controls must occupy the dashboard's existing header slots instead of creating a second stacked toolbar.
- On macOS, apply traffic-light clearance to the desktop dashboard topline only. Graphs and all content below the header use the normal page gutter.
- Use a thin dedicated drag strip above the macOS dashboard header. The visible topline and every header control must remain outside draggable regions.
- In composited desktop windows, only the currently visible surface may contribute a draggable region. Disable shell drag regions while an overlaid dashboard view is active.
- Put transient update details and recovery actions in anchored popovers. Controls, menus, and popovers must live in the same composited view so a child content layer cannot cover or intercept them.
- Render the installed version as quiet persistent header text. Use the product
  blue only when the same compact control represents an available download,
  active progress, or restart-ready update.
