const path = require('path');
const mongoose = require('mongoose');
const dotenvFlow = require('dotenv-flow');

dotenvFlow.config({ cwd: path.resolve(__dirname, '..', '..') });

const Video = require('../models/Video');
const Notification = require('../models/Notification');
const MediaNode = require('../models/MediaNode');
const MediaAsset = require('../models/MediaAsset');
const EscalationPolicy = require('../models/EscalationPolicy');
const Session = require('../models/Session');
const Device = require('../models/Device');
const EventOutbox = require('../models/EventOutbox');
const RoughCut = require('../models/RoughCut');
const TransferSession = require('../models/TransferSession');
const MediaTask = require('../models/MediaTask');
const { STORAGE_ROOT } = require('../utils/storagePaths');

const dryRun = process.argv.includes('--dry-run');
const batchSizeArg = process.argv.find((value) => value.startsWith('--batch-size='));
const batchSize = Math.min(Math.max(Number(batchSizeArg?.split('=')[1] || 200), 10), 1000);

const pathFields = [
  ['raw', 'rawPath'],
  ['master', 'filepath'],
  ['final', 'compressedPath'],
  ['mp4_preview', 'previewPath'],
  ['thumbnail', 'thumbnailPath'],
  ['hls', 'hlsPreview.folderPath'],
  ['scrub', 'scrubPreview.folderPath'],
];

function getNested(object, dottedPath) {
  return dottedPath.split('.').reduce((current, key) => current?.[key], object);
}

function relativeStoragePath(value) {
  if (!value) return null;
  const absolute = path.resolve(value);
  const relative = path.relative(STORAGE_ROOT, absolute);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return relative.replace(/\\/g, '/');
}

async function ensurePrimaryNode() {
  const data = {
    nodeId: process.env.EDGE_NODE_ID || 'primary-edge',
    name: process.env.EDGE_NODE_NAME || 'Primarni Media Edge',
    site: process.env.EDGE_SITE_ID || 'primary',
    kind: 'edge',
    baseUrl: process.env.EDGE_BASE_URL || 'http://127.0.0.1:5100',
    status: 'offline',
    capabilities: { nvenc: false, hls: true, resumableUploads: true },
  };
  if (dryRun) return { ...data, _id: new mongoose.Types.ObjectId() };
  return MediaNode.findOneAndUpdate(
    { nodeId: data.nodeId },
    { $setOnInsert: data },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

async function backfillMediaAssets(node) {
  const result = { scannedVideos: 0, candidateAssets: 0, createdAssets: 0, outsideStorage: 0 };
  const cursor = Video.find({
    $or: pathFields.map(([, field]) => ({ [field]: { $type: 'string', $ne: '' } })),
  }).select(`_id ${pathFields.map(([, field]) => field).join(' ')}`).lean().cursor({ batchSize });

  for await (const video of cursor) {
    result.scannedVideos += 1;
    const operations = [];
    for (const [kind, field] of pathFields) {
      const sourcePath = getNested(video, field);
      if (!sourcePath) continue;
      const relativePath = relativeStoragePath(sourcePath);
      if (!relativePath) {
        result.outsideStorage += 1;
        continue;
      }
      result.candidateAssets += 1;
      operations.push({
        updateOne: {
          filter: { video: video._id, node: node._id, kind, relativePath },
          update: { $setOnInsert: { video: video._id, node: node._id, kind, relativePath, status: 'available' } },
          upsert: true,
        },
      });
    }
    if (!dryRun && operations.length) {
      const write = await MediaAsset.bulkWrite(operations, { ordered: false });
      result.createdAssets += write.upsertedCount || 0;
    }
  }
  return result;
}

async function migrateNotifications() {
  const filter = { $or: [{ severity: { $exists: false } }, { state: { $exists: false } }, { entityType: { $exists: false } }] };
  const matched = await Notification.countDocuments(filter);
  if (!dryRun && matched) {
    await Notification.updateMany(filter, [
      { $set: {
        severity: { $ifNull: ['$severity', 'info'] },
        state: { $ifNull: ['$state', { $cond: [{ $ne: ['$readAt', null] }, 'read', 'unread'] }] },
        entityType: { $ifNull: ['$entityType', { $cond: [{ $ne: ['$job', null] }, 'edit_job', 'system'] }] },
      } },
    ]);
  }
  return { matched, updated: dryRun ? 0 : matched };
}

async function ensurePolicies() {
  const policies = [
    ['show_day.changed_after_download', ['Realizator', 'Producer', 'Admin']],
    ['show_day.clip_replaced_critical', ['Realizator', 'Producer', 'Admin']],
    ['correction.urgent_live', ['Producer', 'Editor', 'VideoEditor', 'Admin']],
    ['media.missing_for_air', ['Realizator', 'Producer', 'Admin']],
  ];
  if (dryRun) return { candidates: policies.length, upserted: 0 };
  let upserted = 0;
  for (const [eventType, escalationRoles] of policies) {
    const result = await EscalationPolicy.updateOne(
      { eventType },
      { $setOnInsert: { eventType, enabled: true, repeatAfterSeconds: 90, acknowledgeAfterSeconds: 180, escalationRoles, maxEscalationLevel: 2 } },
      { upsert: true }
    );
    upserted += result.upsertedCount || 0;
  }
  return { candidates: policies.length, upserted };
}

async function createV2Indexes() {
  if (dryRun) return { skipped: true };
  const notificationIndexes = await Notification.collection.indexes();
  const legacyCommentIndex = notificationIndexes.find((index) => index.name === 'notification_recipient_comment_unique_idx');
  const expectedPartial = JSON.stringify({ commentId: { $type: 'objectId' } });
  if (legacyCommentIndex && JSON.stringify(legacyCommentIndex.partialFilterExpression || {}) !== expectedPartial) {
    await Notification.collection.dropIndex(legacyCommentIndex.name);
  }
  const models = [Session, Device, EventOutbox, Notification, MediaNode, MediaAsset, MediaTask, RoughCut, TransferSession, EscalationPolicy];
  for (const model of models) await model.createIndexes();
  return { models: models.map((model) => model.modelName) };
}

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI nije definisan.');
  await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false });
  const node = await ensurePrimaryNode();
  const report = {
    dryRun,
    batchSize,
    storageRoot: STORAGE_ROOT,
    mediaAssets: await backfillMediaAssets(node),
    notifications: await migrateNotifications(),
    escalationPolicies: await ensurePolicies(),
    indexes: await createV2Indexes(),
  };
  console.log(JSON.stringify(report, null, 2));
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error('V2 migracija nije uspjela:', error);
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});
