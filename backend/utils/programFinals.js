const path = require('path');

const PREFIX_MIN_LENGTH = 2;
const PREFIX_MAX_LENGTH = 24;

function stripDiacritics(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, (character) => (character === 'Đ' ? 'D' : 'd'));
}

function normalizeText(value) {
  return stripDiacritics(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function slugify(value, fallback = 'stavka') {
  return normalizeText(value).replace(/\s+/g, '-') || fallback;
}

function normalizeAirDate(value) {
  const raw = String(value || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const date = new Date(`${raw}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeAirTime(value) {
  const match = String(value || '').trim().match(/^(\d{1,2})[:.-](\d{2})$/);
  if (!match) return '';
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return '';
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function programFinalAirDateTime(airDate, airTime) {
  const datePart = airDate instanceof Date
    ? airDate.toISOString().slice(0, 10)
    : String(airDate || '').slice(0, 10);
  const normalizedTime = normalizeAirTime(airTime);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart) || !normalizedTime) return null;
  const value = new Date(`${datePart}T${normalizedTime}:00`);
  return Number.isNaN(value.getTime()) ? null : value;
}

function buildEditionKey(editionLabel) {
  return slugify(editionLabel || 'standard', 'standard');
}

function tokenize(value) {
  return normalizeText(value).split(' ').filter(Boolean);
}

function buildSearchPrefixes(values) {
  const prefixes = new Set();
  values.flatMap(tokenize).forEach((token) => {
    const upper = Math.min(token.length, PREFIX_MAX_LENGTH);
    for (let length = PREFIX_MIN_LENGTH; length <= upper; length += 1) {
      prefixes.add(token.slice(0, length));
    }
  });
  return Array.from(prefixes).slice(0, 2000);
}

function buildProgramFinalSearch({ title, programName, programTypeName, editionLabel, credits = [] }) {
  const values = [
    title,
    programName,
    programTypeName,
    editionLabel,
    ...credits.flatMap((credit) => [credit.personNameSnapshot, credit.roleNameSnapshot]),
  ].filter(Boolean);
  return {
    searchText: values.join(' ').replace(/\s+/g, ' ').trim(),
    searchPrefixes: buildSearchPrefixes(values),
  };
}

function searchTokens(query) {
  return tokenize(query).filter((token) => token.length >= PREFIX_MIN_LENGTH);
}

function isPathInside(rootPath, candidatePath) {
  if (!rootPath || !candidatePath) return false;
  const root = path.resolve(rootPath);
  const candidate = path.resolve(candidatePath);
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function safeRelativePath(rootPath, candidatePath) {
  const resolved = path.resolve(candidatePath);
  if (!isPathInside(rootPath, resolved)) throw new Error('Media putanja je izvan dozvoljenog storagea.');
  return path.relative(rootPath, resolved).replace(/\\/g, '/');
}

function resolveSafeRelativePath(rootPath, relativePath) {
  const candidate = path.resolve(rootPath, String(relativePath || ''));
  if (!isPathInside(rootPath, candidate)) return null;
  return candidate;
}

function parseWatchedFinalFilename(filename) {
  const extension = path.extname(String(filename || ''));
  const base = path.basename(String(filename || ''), extension);
  const match = base.match(/^(.+?)__(\d{4}-\d{2}-\d{2})__(\d{2})-(\d{2})__(.+)$/);
  if (!match) return null;
  const airDate = normalizeAirDate(match[2]);
  const airTime = normalizeAirTime(`${match[3]}:${match[4]}`);
  if (!airDate || !airTime) return null;
  return {
    programSlug: slugify(match[1]),
    airDate: match[2],
    airTime,
    title: match[5].replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim(),
    editionLabel: '',
  };
}

module.exports = {
  PREFIX_MIN_LENGTH,
  buildEditionKey,
  buildProgramFinalSearch,
  buildSearchPrefixes,
  isPathInside,
  normalizeAirDate,
  normalizeAirTime,
  normalizeText,
  parseWatchedFinalFilename,
  programFinalAirDateTime,
  resolveSafeRelativePath,
  safeRelativePath,
  searchTokens,
  slugify,
  stripDiacritics,
};
