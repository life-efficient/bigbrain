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
- Preserve vis-network's emergent clustering and physics when refining its appearance or interaction. Treat its stabilized positions as the renderer's canonical geometry.
- Vis-network node hover and click targeting must use a forgiving screen-space proximity radius instead of requiring precise contact with the visible glyph.
- Render vis-network labels in the dashboard overlay layer so key, hover, and selected labels can use the app's typography and translucent surfaces without changing graph geometry.
- Keep `Orb`, `Diamond`, and `Hex` node styles available in vis-network. Selection should emphasize the focused node and its immediate neighborhood while muting unrelated nodes and edges.
- Do not change or formalize disconnected-page placement as part of vis-network presentation work.
- Run the vis-network boot treatment once, only after physics has frozen and the initial camera fit has finished. Keep it CSS-only, brief, and independent of graph size so it cannot disturb the stabilized geometry.
- Animate live graph activity only after a successful MCP write has completed indexing. Refresh graph data, patch the existing vis-network datasets in place, preserve settled node positions, and use a bounded overlay pulse to distinguish page creation from updates.
- Boot and live graph motion must have a reduced-motion path that immediately reveals the settled graph and omits scan, reticle, and pulse effects.
- Treat a stabilized graph as fixed geometry: zoom and pan should transform the settled scene as one composited layer, then commit the camera once when interaction ends. Never rerun layout, rebuild overlays, or repaint thousands of individual graph primitives on every input tick.

## Desktop Shell Theming

- Treat onboarding as part of the desktop shell, not as a separate branded surface.
- Reuse the dashboard's dark neutral palette, translucent surfaces, borders, text hierarchy, and monochrome controls.
- Primary onboarding actions use the shell's white-on-dark emphasis. Do not introduce an unrelated accent color for setup buttons, choices, or focus states.
- Keep active-dashboard controls in one compact top row. Desktop-only controls must occupy the dashboard's existing header slots instead of creating a second stacked toolbar.
- On macOS, apply traffic-light clearance to the desktop dashboard topline only. Graphs and all content below the header use the normal page gutter.
- Use a thin dedicated drag strip above the macOS dashboard header. The visible topline and every header control must remain outside draggable regions.
- In composited desktop windows, only the currently visible surface may contribute a draggable region. Disable shell drag regions while an overlaid dashboard view is active.
- Put transient update details and recovery actions in anchored popovers. Controls, menus, and popovers must live in the same composited view so a child content layer cannot cover or intercept them.
