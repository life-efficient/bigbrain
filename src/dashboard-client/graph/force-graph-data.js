export function prepareForceGraphData(data) {
  const nodes = (Array.isArray(data?.nodes) ? data.nodes : [])
    .filter((node) => node && typeof node === 'object' && typeof node.id === 'string');
  const nodeIds = new Set(nodes.map((node) => node.id));
  const links = (Array.isArray(data?.links) ? data.links : [])
    .map((link) => {
      if (!link || typeof link !== 'object') return null;
      const source = forceGraphEndpointId(link.source);
      const target = forceGraphEndpointId(link.target);
      if (!nodeIds.has(source) || !nodeIds.has(target)) return null;
      return { ...link, source, target };
    })
    .filter(Boolean);

  return { ...data, nodes, links };
}

function forceGraphEndpointId(endpoint) {
  return typeof endpoint === 'object'
    ? endpoint?.id || endpoint?.slug || null
    : endpoint;
}
