export function graphNodeDomains(node) {
  return Array.isArray(node?.domains) ? node.domains : [];
}

export function graphNodeMatchesFilters(node, selectedTypeSet, selectedDomainSet, selectedCollectionSlugs = null) {
  if (!node) return false;
  const matchesType = selectedTypeSet.size === 0 || selectedTypeSet.has(node.type);
  const matchesDomain = selectedDomainSet.size === 0 || graphNodeDomains(node).some((domain) => selectedDomainSet.has(domain));
  const matchesCollection = selectedCollectionSlugs === null || selectedCollectionSlugs.has(node.slug);
  return matchesType && matchesDomain && matchesCollection;
}
