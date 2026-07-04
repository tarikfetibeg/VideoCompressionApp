import { getSearchParam } from './searchParams';

describe('searchParams', () => {
  test('ignores empty and one-character searches', () => {
    expect(getSearchParam('')).toBeUndefined();
    expect(getSearchParam(' a ')).toBeUndefined();
  });

  test('returns trimmed searches with at least two characters', () => {
    expect(getSearchParam('  qc ')).toBe('qc');
    expect(getSearchParam('materijal')).toBe('materijal');
  });
});
