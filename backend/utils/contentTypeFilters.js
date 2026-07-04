const mongoose = require('mongoose');
const BroadcastContentType = require('../models/BroadcastContentType');

const finalCategoryAliasesBySlug = Object.freeze({
  prilog: ['prilog', 'video-report'],
  insert: ['insert'],
  spica: ['spica'],
  promo: ['promo'],
  marketing: ['marketing'],
  grafika: ['grafika'],
  ostalo: ['ostalo'],
});

function normalizeFinalCategory(value) {
  return String(value || '').trim().toLocaleLowerCase();
}

function getFinalCategoryAliases(slug) {
  const normalizedSlug = normalizeFinalCategory(slug);
  if (!normalizedSlug) return [];
  return finalCategoryAliasesBySlug[normalizedSlug] || [normalizedSlug];
}

function getCanonicalFinalCategory(value) {
  const normalizedValue = normalizeFinalCategory(value);
  if (!normalizedValue) return '';

  const match = Object.entries(finalCategoryAliasesBySlug).find(([, aliases]) =>
    aliases.includes(normalizedValue)
  );

  return match ? match[0] : '';
}

function appendAndCondition(filter, condition) {
  if (!condition) return false;
  if (!Array.isArray(filter.$and)) {
    filter.$and = filter.$and ? [filter.$and] : [];
  }
  filter.$and.push(condition);
  return true;
}

async function buildContentTypeFallbackCondition(contentTypeId) {
  if (!contentTypeId || contentTypeId === 'all') return null;

  if (!mongoose.Types.ObjectId.isValid(contentTypeId)) {
    return { _id: null };
  }

  const contentType = await BroadcastContentType.findOne({
    _id: contentTypeId,
    active: true,
  }).select('_id slug').lean();

  if (!contentType) {
    return { _id: null };
  }

  const aliases = getFinalCategoryAliases(contentType.slug);
  return {
    $or: [
      { contentType: contentType._id },
      {
        $and: [
          {
            $or: [
              { contentType: { $exists: false } },
              { contentType: null },
            ],
          },
          { finalCategory: { $in: aliases } },
        ],
      },
    ],
  };
}

async function addContentTypeFallbackFilter(filter, contentTypeId) {
  const condition = await buildContentTypeFallbackCondition(contentTypeId);
  return appendAndCondition(filter, condition);
}

module.exports = {
  addContentTypeFallbackFilter,
  finalCategoryAliasesBySlug,
  getCanonicalFinalCategory,
  getFinalCategoryAliases,
  normalizeFinalCategory,
};
