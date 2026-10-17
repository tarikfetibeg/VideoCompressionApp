const path = require('path');
const Video = require('../models/Video');
const { paths, PROJECT_ROOT, createRawManifestPath } = require('../utils/storagePaths');
const { normalizeStoragePath, inspectStorageFile, unlinkStorageFile } = require('../utils/storageFileSafety');
const { isPathReferencedByAnotherVideo } = require('./videoFileDeletionService');
let cleanupInFlight;

async function runCleanup() {
  const result = { checked: 0, deleted: 0, deletedManifests: 0, skipped: 0, failed: 0, skippedDetails: [] };
  const cursor = Video.find({
    rawDeleted: { $ne: true },
    rawPath: { $exists: true, $ne: null },
    rawExpiresAt: { $exists: true, $ne: null, $lte: new Date() },
  }).cursor({ batchSize: 100 });
  const skip = (video, reason) => {
    result.skipped += 1;
    if (result.skippedDetails.length < 100) result.skippedDetails.push({ videoId: video._id, reason });
  };
  try {
    for await (const video of cursor) {
      result.checked += 1;
      try {
        if (video.processingStatus !== 'completed') { skip(video, 'processing is not completed'); continue; }
        const rawPath = video.rawPath;
        if ([video.filepath, video.compressedPath, video.previewPath].some((value) => value && normalizeStoragePath(value) === normalizeStoragePath(rawPath))) {
          skip(video, 'active master or fallback'); continue;
        }
        const check = await inspectStorageFile(rawPath, [paths.raw, path.join(PROJECT_ROOT, 'uploads')]);
        if (!check.safe) { skip(video, check.reason); continue; }
        if (await isPathReferencedByAnotherVideo(video._id, rawPath)) { skip(video, 'referenced by another video'); continue; }
        const current = await Video.exists({ _id: video._id, rawPath, processingStatus: 'completed', rawDeleted: { $ne: true }, rawExpiresAt: { $lte: new Date() } });
        if (!current) { skip(video, 'record changed during cleanup'); continue; }
        const deletion = await unlinkStorageFile(rawPath, [paths.raw, path.join(PROJECT_ROOT, 'uploads')]);
        if (!deletion.safe) { skip(video, deletion.reason); continue; }
        video.rawDeleted = true;
        video.rawDeletedAt = new Date();
        video.rawPath = null;
        await video.save();
        if (deletion.deleted) result.deleted += 1;
        const basename = path.basename(rawPath).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const sharedManifest = await Video.exists({ _id: { $ne: video._id }, rawPath: new RegExp(`(?:^|[\\\\/])${basename}$`, process.platform === 'win32' ? 'i' : '') });
        if (!sharedManifest) {
          const manifest = await unlinkStorageFile(createRawManifestPath(rawPath), [paths.rawManifests]);
          if (manifest.deleted) result.deletedManifests += 1;
        }
      } catch (error) {
        result.failed += 1;
        skip(video, error.code || error.name || 'cleanup failed');
      }
    }
  } finally { await cursor.close(); }
  return result;
}

function cleanupExpiredRawFiles() {
  if (!cleanupInFlight) {
    cleanupInFlight = runCleanup().finally(() => { cleanupInFlight = null; });
  }
  return cleanupInFlight;
}

module.exports = {
  cleanupExpiredRawFiles,
};
