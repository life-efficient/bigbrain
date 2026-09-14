export function nextGraphStyleOption(current, options) {
  if (!options.length) return current;
  const index = options.findIndex((option) => option.id === current);
  return options[(index + 1) % options.length].id;
}

export function nextGraphDomainFilter(selected, domains) {
  if (!domains.length) return [];
  if (selected.length !== 1) return [domains[0]];
  const index = domains.indexOf(selected[0]);
  return index === domains.length - 1 ? [] : [domains[index + 1]];
}
