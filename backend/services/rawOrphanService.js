const fs = require('fs');
const path = require('path');
const Video = require('../models/Video');
const User = require('../models/User');
const FfmpegSettings = require('../models/FfmpegSettings');
const {
  allowedVideoExtensions,
} = require('../config/mediaFormats');
const {
  paths,
  ensureFolderExists,
  createMp4Filename,
  createJpgFilename,
  createRawManifestPath,
} = require('../utils/storagePaths');
const { probeMedia } = require('./videoProcessingService');
const { enqueueVideoProcessing } = require('../queues/videoQueue');
const { getQueueErrorMessage } = require('../utils/queueErrors');

function resolvePath(filePath) {
  return path.resolve(filePath).toLowerCase();
}

function inferOriginalFilename(rawFilename) {
  const match = rawFilename.match(/^raw_\d+_\d+_(.+)$/);
  return match ? match[1] : rawFilename;
}

async function readRawManifest(rawPath) {
  try {
    const manifestPath = createRawManifestPath(rawPath);
    const manifestContent = await fs.promises.readFile(manifestPath, 'utf8');
    return JSON.parse(manifestContent);
  } catch (error) {
    return null;
  }
}

function resolveTagDate(value, fallbackDate) {
  if (!value) return fallbackDate;

  const parsedDate = new Date(value);
  return Number.isNaN(parsedDate.getTime()) ? fallbackDate : parsedDate;
}

function buildSourceMetadata(mediaProbe = {}) {
  return {
    sourceFormat: mediaProbe.container || null,
    sourceCodec: mediaProbe.codec || null,
    sourceResolution: mediaProbe.resolution || null,
    sourceBitrate: mediaProbe.bitrate || null,
    sourceFramerate: mediaProbe.framerate || null,
    sourceDuration: mediaProbe.duration || null,
    sourceAudioCodec: mediaProbe.audioCodec || null,
    sourceAudioChannels: mediaProbe.audioChannels || null,
    sourceAudioSampleRate: mediaProbe.audioSampleRate || null,
  };
}

function buildRawRetentionInfo(rawRetentionDays) {
  const days = Number(rawRetentionDays) || 0;

  if (days <= 0) {
    return {
      rawRetentionDays: 0,
      rawExpiresAt: null,
    };
  }

  return {
    rawRetentionDays: days,
    rawExpiresAt: new Date(Date.now() + days * 24 * 60 * 60 * 1000),
  };
}

async function getProcessingSettings() {
  const settings = await FfmpegSettings.findOne({});
  return {
    codec: settings?.codec || 'libx264',
    resolution: settings?.resolution || '1920x1080',
    bitrate: settings?.bitrate || 1500,
    framerate: settings?.framerate || 30,
    rawRetentionDays: Math.min(Math.max(settings?.rawRetentionDays || 0, 0), 365),
  };
}

async function getReferencedRawPaths() {
  const videos = await Video.find({}).select('rawPath filepath compressedPath');
  const referencedPaths = new Set();

  videos.forEach((video) => {
    [video.rawPath, video.filepath, video.compressedPath]
      .filter(Boolean)
      .forEach((filePath) => referencedPaths.add(resolvePath(filePath)));
  });

  return referencedPaths;
}

async function findRawOrphans() {
  ensureFolderExists(paths.raw);

  const referencedPaths = await getReferencedRawPaths();
  const entries = await fs.promises.readdir(paths.raw, { withFileTypes: true });
  const orphans = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;

    const ext = path.extname(entry.name).toLowerCase();
    if (!allowedVideoExtensions.includes(ext)) continue;

    const filePath = path.join(paths.raw, entry.name);
    if (referencedPaths.has(resolvePath(filePath))) continue;

    const stats = await fs.promises.stat(filePath);
    const manifest = await readRawManifest(filePath);

    orphans.push({
      filename: entry.name,
      originalFilename: manifest?.originalFilename || inferOriginalFilename(entry.name),
      path: filePath,
      size: stats.size,
      modifiedAt: stats.mtime,
      manifest: manifest
        ? {
          uploadKind: manifest.uploadKind || null,
          uploaderId: manifest.uploaderId || null,
          uploaderUsername: manifest.uploaderUsername || null,
          uploaderRole: manifest.uploaderRole || null,
          event: manifest.event || null,
          location: manifest.location || null,
          tagDate: manifest.tagDate || null,
        }
        : null,
    });
  }

  return orphans.sort((a, b) => b.modifiedAt - a.modifiedAt);
}

async function resolveUploaderId(candidateIds, userExistsCache) {
  for (const candidateId of candidateIds.filter(Boolean)) {
    if (!userExistsCache.has(candidateId)) {
      try {
        const userExists = await User.exists({ _id: candidateId });
        userExistsCache.set(candidateId, Boolean(userExists));
      } catch (error) {
        userExistsCache.set(candidateId, false);
      }
    }

    if (userExistsCache.get(candidateId)) {
      return candidateId;
    }
  }

  return undefined;
}

async function importRawOrphans({
  userId,
  fallbackUserId,
  event,
  date,
} = {}) {
  const orphans = await findRawOrphans();
  const settings = await getProcessingSettings();
  const rawRetentionInfo = buildRawRetentionInfo(settings.rawRetentionDays);
  const imported = [];
  const skipped = [];
  const userExistsCache = new Map();

  for (const orphan of orphans) {
    try {
      const manifest = orphan.manifest || {};
      const uploaderId = await resolveUploaderId(
        [userId, manifest.uploaderId, fallbackUserId],
        userExistsCache
      );
      const recoveredEvent = event || manifest.event || 'Recovered Raw';
      const recoveredLocation = manifest.location || '';
      const recoveredTagDate = resolveTagDate(date || manifest.tagDate, orphan.modifiedAt);
      const sourceMetadata = buildSourceMetadata(await probeMedia(orphan.path));
      const outputFilename = createMp4Filename('compressed', orphan.originalFilename);
      const previewFilename = createMp4Filename('preview', orphan.originalFilename);
      const thumbnailFilename = createJpgFilename('thumb', orphan.originalFilename);
      const outputPath = path.join(paths.compressed, outputFilename);
      const previewPath = path.join(paths.previews, previewFilename);
      const thumbnailPath = path.join(paths.thumbnails, thumbnailFilename);

      ensureFolderExists(paths.compressed);
      ensureFolderExists(paths.previews);
      ensureFolderExists(paths.thumbnails);

      const videoDoc = await Video.create({
        filename: outputFilename,
        filepath: outputPath,
        originalFilename: orphan.originalFilename,

        rawPath: orphan.path,
        compressedPath: outputPath,
        previewPath,
        thumbnailPath,

        uploader: uploaderId,
        event: recoveredEvent,
        location: recoveredLocation,
        tagDate: recoveredTagDate,

        status: 'raw',
        processingStatus: 'queued',
        processingMode: 'transcode',
        processingProgress: 0,

        codec: settings.codec,
        resolution: settings.resolution,
        bitrate: settings.bitrate,
        framerate: settings.framerate,
        ...sourceMetadata,

        sizeOriginal: orphan.size,
        sizeCompressed: null,
        sizePreview: null,
        sizeThumbnail: null,
        duration: sourceMetadata.sourceDuration,

        rawRetentionDays: rawRetentionInfo.rawRetentionDays,
        rawExpiresAt: rawRetentionInfo.rawExpiresAt,
        rawDeleted: false,
        rawDeletedAt: null,

        uploadDate: orphan.modifiedAt,
      });

      let processingError = null;
      let processingJobId = null;

      try {
        const job = await enqueueVideoProcessing(videoDoc._id);
        processingJobId = job.id.toString();
      } catch (queueError) {
        processingError = getQueueErrorMessage(queueError);
        videoDoc.processingStatus = 'failed';
        videoDoc.processingError = processingError;
        videoDoc.processingCompletedAt = new Date();
        await videoDoc.save();
      }

      imported.push({
        videoId: videoDoc._id,
        filename: orphan.filename,
        originalFilename: orphan.originalFilename,
        uploaderId,
        manifestUsed: Boolean(orphan.manifest),
        processingJobId,
        processingError,
      });
    } catch (error) {
      skipped.push({
        filename: orphan.filename,
        error: error.message,
      });
    }
  }

  return {
    found: orphans.length,
    imported,
    skipped,
  };
}

module.exports = {
  findRawOrphans,
  importRawOrphans,
};
