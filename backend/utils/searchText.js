function flattenSearchValue(value, output = []) {
  if (value === null || value === undefined) return output;

  if (Array.isArray(value)) {
    value.forEach((item) => flattenSearchValue(item, output));
    return output;
  }

  if (value instanceof Date) {
    output.push(value.toISOString());
    return output;
  }

  if (typeof value === 'object') {
    Object.values(value).forEach((item) => flattenSearchValue(item, output));
    return output;
  }

  output.push(String(value));
  return output;
}

function normalizeSearchText(...values) {
  return flattenSearchValue(values)
    .join(' ')
    .normalize('NFKC')
    .toLocaleLowerCase('bs-BA')
    .replace(/["'`]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function foldSearchToken(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLocaleLowerCase('bs-BA')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .trim();
}

function tokenizeSearchValue(value, { minLength = 2, maxTerms = 200 } = {}) {
  const matches = normalizeSearchText(value).match(/[\p{L}\p{N}]+/gu) || [];
  const terms = [];
  const seen = new Set();

  for (const match of matches) {
    const term = foldSearchToken(match);
    if (term.length < minLength || seen.has(term)) continue;
    seen.add(term);
    terms.push(term);
    if (terms.length >= maxTerms) break;
  }

  return terms;
}

function buildSearchPrefixes(value, {
  minLength = 2,
  maxPrefixLength = 32,
  maxPrefixes = 600,
} = {}) {
  const prefixes = [];
  const seen = new Set();
  const terms = tokenizeSearchValue(value, { minLength, maxTerms: 200 });

  for (const term of terms) {
    const lastLength = Math.min(term.length, maxPrefixLength);
    for (let length = minLength; length <= lastLength; length += 1) {
      const prefix = term.slice(0, length);
      if (seen.has(prefix)) continue;
      seen.add(prefix);
      prefixes.push(prefix);
      if (prefixes.length >= maxPrefixes) return prefixes;
    }
  }

  return prefixes;
}

function buildPrefixSearchTerms(value, { minLength = 2, maxTerms = 6 } = {}) {
  return tokenizeSearchValue(value, { minLength, maxTerms });
}

function buildFoldedPrefixRegex(term) {
  const characterMap = {
    c: '[cčć]',
    s: '[sš]',
    z: '[zž]',
    d: '[dđ]',
  };
  const escaped = String(term || '')
    .split('')
    .map((character) => characterMap[character]
      || character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('');
  return `(^|[^\\p{L}\\p{N}])${escaped}`;
}

function buildMongoTextSearch(value, { minLength = 2 } = {}) {
  const normalized = normalizeSearchText(value);

  if (normalized.length < minLength) return '';

  return normalized
    .split(/\s+/)
    .map((term) => term.replace(/^-+/, '').trim())
    .filter((term) => term.length >= minLength)
    .join(' ');
}

function addTextSearchFilter(filter, value, options = {}) {
  const search = buildMongoTextSearch(value, options);

  if (!search) return false;

  filter.$text = { $search: search };
  return true;
}

function addVideoPrefixSearchFilter(filter, value, options = {}) {
  const terms = buildPrefixSearchTerms(value, options);
  if (terms.length === 0) return false;

  const condition = {
    $or: [
      { searchPrefixes: { $all: terms } },
      {
        $and: [
          {
            $or: [
              { searchPrefixes: { $exists: false } },
              { searchPrefixes: { $size: 0 } },
            ],
          },
          ...terms.map((term) => ({
            searchText: {
              $regex: buildFoldedPrefixRegex(term),
              $options: 'i',
            },
          })),
        ],
      },
    ],
  };
  if (Array.isArray(filter.$and)) {
    filter.$and.push(condition);
  } else {
    filter.$and = [condition];
  }

  return true;
}

function buildVideoSearchText(video = {}) {
  return normalizeSearchText(
    video.finalTitle,
    video.originalFilename,
    video.filename,
    video.event,
    video.location,
    video.finalCategory,
    video.keywords,
    video.processingError,
    video.qcNotes,
    video.approvalNotes,
    video.correctionNote,
    video.correctionResolvedNote,
    video.archiveReviewNotes,
    (video.timecodes || []).map((item) => item.description)
  );
}

function buildVideoSearchPrefixes(video = {}) {
  return buildSearchPrefixes(buildVideoSearchText(video));
}

function buildEditJobSearchText(job = {}) {
  return normalizeSearchText(
    job.title,
    job.description,
    job.scriptText,
    job.program,
    (job.segments || []).map((segment) => [segment.title, segment.notes, segment.type]),
    (job.comments || []).map((comment) => comment.body),
    (job.changeLog || []).map((change) => [change.summary, change.type])
  );
}

function buildFeedbackSearchText(feedback = {}) {
  return normalizeSearchText(
    feedback.title,
    feedback.description,
    feedback.type,
    feedback.priority,
    feedback.status,
    feedback.area,
    feedback.adminComment,
    feedback.adminResponse,
    feedback.pageUrl,
    (feedback.comments || []).map((comment) => comment.body)
  );
}

module.exports = {
  addTextSearchFilter,
  addVideoPrefixSearchFilter,
  buildEditJobSearchText,
  buildFeedbackSearchText,
  buildMongoTextSearch,
  buildPrefixSearchTerms,
  buildSearchPrefixes,
  buildVideoSearchPrefixes,
  buildVideoSearchText,
  foldSearchToken,
  normalizeSearchText,
  tokenizeSearchValue,
};
