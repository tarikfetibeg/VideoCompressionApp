const path = require('path');
const MediaAsset = require('../models/MediaAsset');
const MediaNode = require('../models/MediaNode');
const Video = require('../models/Video');
const { STORAGE_ROOT } = require('../utils/storagePaths');

const LEGACY_FIELDS = [
  ['rawPath', 'raw'],
  ['compressedPath', 'master'],
  ['filepath', 'master'],
  ['previewPath', 'mp4_preview'],
  ['thumbnailPath', 'thumbnail'],
];

function toRelativeStoragePath(value) {
  if (!value) return null;
  const resolved = path.resolve(value);
  const relative = path.relative(STORAGE_ROOT, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return relative.replace(/\\/g, '/');
}

async function ensureDefaultEdgeNode() {
  const nodeId = process.env.EDGE_NODE_ID || 'primary-edge';
  return MediaNode.findOneAndUpdate(
    { nodeId },
    {
      $setOnInsert: {
        name: process.env.EDGE_NODE_NAME || 'Primarni Media Edge',
        site: process.env.EDGE_SITE_ID || 'primary',
        kind: 'edge',
        baseUrl: process.env.EDGE_BASE_URL || 'http://127.0.0.1:5100',
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

async function backfillLegacyVideoAssets(videoOrId, { dryRun = false } = {}) {
  const video = typeof videoOrId === 'object' ? videoOrId : await Video.findById(videoOrId);
  if (!video) return { matched: 0, created: 0, skipped: 0 };
  const node = await ensureDefaultEdgeNode();
  const candidates = [];

  for (const [field, kind] of LEGACY_FIELDS) {
    const relativePath = toRelativeStoragePath(video[field]);
    if (relativePath) candidates.push({ kind, relativePath });
  }
  if (video.hlsPreview?.folderPath) {
    const relativePath = toRelativeStoragePath(video.hlsPreview.folderPath);
    if (relativePath) candidates.push({ kind: 'hls', relativePath });
  }
  if (video.scrubPreview?.folderPath) {
    const relativePath = toRelativeStoragePath(video.scrubPreview.folderPath);
    if (relativePath) candidates.push({ kind: 'scrub', relativePath });
  }

  let created = 0;
  let skipped = 0;
  for (const candidate of candidates) {
    const exists = await MediaAsset.exists({
      video: video._id,
      node: node._id,
      kind: candidate.kind,
      relativePath: candidate.relativePath,
    });
    if (exists) {
      skipped += 1;
      continue;
    }
    if (!dryRun) {
      await MediaAsset.create({
        video: video._id,
        node: node._id,
        kind: candidate.kind,
        relativePath: candidate.relativePath,
        storageClass: 'local',
        status: 'available',
      });
    }
    created += 1;
  }
  return { matched: candidates.length, created, skipped };
}

async function getMediaAccessOptions(videoId, site = 'primary') {
  const assets = await MediaAsset.find({ video: videoId, status: 'available' })
    .populate('node')
    .sort({ version: -1 });
  const local = assets.filter((asset) => asset.node?.kind === 'edge' && asset.node.site === site);
  const cloud = assets.filter((asset) => asset.storageClass === 'cloud_proxy' || asset.node?.kind === 'cloud_proxy');
  return {
    local,
    cloud,
    preferred: local.find((asset) => asset.kind === 'hls')
      || cloud.find((asset) => asset.kind === 'hls')
      || local.find((asset) => ['mp4_preview', 'master'].includes(asset.kind))
      || cloud.find((asset) => asset.kind === 'mp4_preview')
      || null,
  };
}

module.exports = {
  backfillLegacyVideoAssets,
  ensureDefaultEdgeNode,
  getMediaAccessOptions,
  toRelativeStoragePath,
};
