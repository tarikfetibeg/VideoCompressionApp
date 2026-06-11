const path = require('path');
const fs = require('fs');
const Video = require('../models/Video');
const { createRawManifestPath } = require('../utils/storagePaths');

function deleteFileIfExists(filePath) {
  if (!filePath) return false;

  const resolvedPath = path.resolve(filePath);

  if (fs.existsSync(resolvedPath)) {
    fs.unlinkSync(resolvedPath);
    return true;
  }

  return false;
}

async function cleanupExpiredRawFiles() {
  const now = new Date();

  const expiredVideos = await Video.find({
    rawDeleted: { $ne: true },
    rawPath: { $exists: true, $ne: null },
    rawExpiresAt: { $exists: true, $ne: null, $lte: now },
  });

  let deletedCount = 0;
  let deletedManifestCount = 0;

  for (const video of expiredVideos) {
    const deleted = deleteFileIfExists(video.rawPath);
    const manifestDeleted = deleteFileIfExists(createRawManifestPath(video.rawPath));

    video.rawDeleted = true;
    video.rawDeletedAt = new Date();
    video.rawPath = null;

    await video.save();

    if (deleted) {
      deletedCount += 1;
    }

    if (manifestDeleted) {
      deletedManifestCount += 1;
    }
  }

  return {
    checked: expiredVideos.length,
    deleted: deletedCount,
    deletedManifests: deletedManifestCount,
  };
}

module.exports = {
  cleanupExpiredRawFiles,
};
