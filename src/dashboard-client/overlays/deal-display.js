export function dealDisplayText(record, textMode = 'regular') {
  if (textMode === 'anonymised') {
    return {
      title: record.anonymised_title?.trim() || 'Anonymised title not set',
      description: record.anonymised_description?.trim() || 'Anonymised description not set.',
    };
  }
  return { title: record.title || record.page_slug, description: record.summary || 'No summary yet.' };
}
