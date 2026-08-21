export const GRAPH_NODE_SIZES = [
  { id: 'small', label: 'Small', scale: 1 },
  { id: 'medium', label: 'Medium', scale: 2 },
  { id: 'large', label: 'Large', scale: 3 },
];

const NODE_SIZE_SCALE_BY_ID = new Map(
  GRAPH_NODE_SIZES.map((size) => [size.id, size.scale]),
);

export function getGraphNodeSizeScale(nodeSize = 'medium') {
  return NODE_SIZE_SCALE_BY_ID.get(nodeSize) || NODE_SIZE_SCALE_BY_ID.get('medium');
}
