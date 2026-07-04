export const MIN_SEARCH_QUERY_LENGTH = 2;

export function getSearchParam(value) {
  const trimmed = String(value || '').trim();
  return trimmed.length >= MIN_SEARCH_QUERY_LENGTH ? trimmed : undefined;
}
