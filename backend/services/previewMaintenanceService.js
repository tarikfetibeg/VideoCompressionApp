const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Video = require('../models/Video');
const {
  convertPreviewVideo,
  createScrubPreviewFrame,
  createThumbnail,
  getScrubPreviewTimestamp,
  probeMedia,
} = require('./videoProcessingService');
const {
  inspectBrowserCompatibility,
  resolveExistingPath,
  toPlaybackCompatibility,
} = require('./mediaCompatibilityService');
const {
  getMediaSettings,
  parseResolution,
} = require('./mediaProfileService');
const {
  createJpgFilename,
  createMp4Filename,
  ensureFolderExists,
  paths,
} = require('../utils/storagePaths');

function isPathInside(rootPath, targetPath) {
  if (!targetPath) return false;
  const root = path.resolve(rootPath);
  const target = path.resolve(targetPath);
  return target === root || target.startsWith(`${root}${path.sep}`);
}

function removeFile(filePath) {
  if (filePath && fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
}

function removeFolder(folderPath) {
  if (folderPath && fs.existsSync(folderPath)) fs.rmSync(folderPath, { recursive: true, force: true });
}

async function chooseOwnedPath(video, currentPath, rootPath, createName) {
  if (currentPath && isPathInside(rootPath, currentPath)) {
    const shared = await Video.exists({
      _id: { $ne: video._id },
      $or: [
        { previewPath: currentPath },
        { thumbnailPath: currentPath },
      ],
    });
    if (!shared) return path.resolve(currentPath);
  }
  return path.join(rootPath, createName());
}

async function replaceFileAtomically({
  finalPath,
  temporaryPath,
  saveMetadata,
}) {
  const backupPath = `${finalPath}.previous-${crypto.randomBytes(4).toString('hex')}`;
  const hadPrevious = fs.existsSync(finalPath);
  ensureFolderExists(path.dirname(finalPath));
  if (hadPrevious) fs.renameSync(finalPath, backupPath);
  try {
    fs.renameSync(temporaryPath, finalPath);
    await saveMetadata();
    removeFile(backupPath);
  } catch (error) {
    removeFile(finalPath);
    if (hadPrevious && fs.existsSync(backupPath)) fs.renameSync(backupPath, finalPath);
    throw error;
  }
}

async function rebuildMp4Preview(video, settings) {
  const inputPath = resolveExistingPath(video.compressedPath, video.filepath, video.rawPath);
  if (!inputPath) throw new Error('MP4 preview source file nije pronađen.');
  const finalPath = await chooseOwnedPath(
    video,
    video.previewPath,
    paths.previews,
    () => createMp4Filename('preview_rebuild', video.originalFilename || video.filename || 'video.mp4')
  );
  const temporaryPath = path.join(
    paths.previews,
    `.building-${video._id}-${crypto.randomBytes(5).toString('hex')}.mp4`
  );
  ensureFolderExists(paths.previews);
  const previousState = {
    previewPath: video.previewPath,
    sizePreview: video.sizePreview,
    mp4Preview: video.mp4Preview?.toObject?.() || video.mp4Preview,
    playbackCompatibility: video.playbackCompatibility?.toObject?.() || video.playbackCompatibility,
  };
  try {
    const metadata = await convertPreviewVideo({
      inputPath,
      outputPath: temporaryPath,
      settings,
      sourceFramerate: video.sourceFramerate || video.framerate,
    });
    const compatibility = await inspectBrowserCompatibility(temporaryPath);
    if (!compatibility.compatible) {
      throw new Error(`Generisani MP4 preview nije browser-kompatibilan: ${compatibility.reason}.`);
    }
    await replaceFileAtomically({
      finalPath,
      temporaryPath,
      saveMetadata: async () => {
        video.previewPath = finalPath;
        video.sizePreview = fs.statSync(finalPath).size;
        video.mp4Preview = { ...metadata, size: video.sizePreview };
        video.playbackCompatibility = toPlaybackCompatibility(compatibility, 'preview');
        await video.save();
      },
    });
    return { assetType: 'mp4', status: 'rebuilt', path: finalPath };
  } catch (error) {
    video.previewPath = previousState.previewPath;
    video.sizePreview = previousState.sizePreview;
    video.mp4Preview = previousState.mp4Preview;
    video.playbackCompatibility = previousState.playbackCompatibility;
    throw error;
  } finally {
    removeFile(temporaryPath);
  }
}

async function rebuildThumbnail(video, settings) {
  const inputPath = resolveExistingPath(
    video.previewPath,
    video.compressedPath,
    video.filepath,
    video.rawPath
  );
  if (!inputPath) throw new Error('Thumbnail source file nije pronađen.');
  const finalPath = await chooseOwnedPath(
    video,
    video.thumbnailPath,
    paths.thumbnails,
    () => createJpgFilename('thumb_rebuild', video.originalFilename || video.filename || 'video.jpg')
  );
  const temporaryPath = path.join(
    paths.thumbnails,
    `.building-${video._id}-${crypto.randomBytes(5).toString('hex')}.jpg`
  );
  ensureFolderExists(paths.thumbnails);
  const dimensions = parseResolution(settings.thumbnailResolution, '640x360');
  const previousState = {
    thumbnailPath: video.thumbnailPath,
    sizeThumbnail: video.sizeThumbnail,
    thumbnail: video.thumbnail?.toObject?.() || video.thumbnail,
  };
  try {
    await createThumbnail({
      inputPath,
      outputPath: temporaryPath,
      resolution: settings.thumbnailResolution,
      jpegQuality: settings.thumbnailJpegQuality,
    });
    if (!fs.existsSync(temporaryPath) || fs.statSync(temporaryPath).size <= 0) {
      throw new Error('Generisani thumbnail je prazan.');
    }
    await replaceFileAtomically({
      finalPath,
      temporaryPath,
      saveMetadata: async () => {
        video.thumbnailPath = finalPath;
        video.sizeThumbnail = fs.statSync(finalPath).size;
        video.thumbnail = {
          profileVersion: settings.thumbnailProfileVersion,
          width: dimensions.width,
          height: dimensions.height,
          jpegQuality: settings.thumbnailJpegQuality,
          size: video.sizeThumbnail,
          createdAt: new Date(),
          error: '',
        };
        await video.save();
      },
    });
    return { assetType: 'thumbnail', status: 'rebuilt', path: finalPath };
  } catch (error) {
    video.thumbnailPath = previousState.thumbnailPath;
    video.sizeThumbnail = previousState.sizeThumbnail;
    video.thumbnail = previousState.thumbnail;
    throw error;
  } finally {
    removeFile(temporaryPath);
  }
}

function cleanupInactiveScrubVersions(rootFolder, activeFolder) {
  if (!fs.existsSync(rootFolder)) return;
  for (const entry of fs.readdirSync(rootFolder, { withFileTypes: true })) {
    const entryPath = path.join(rootFolder, entry.name);
    if (path.resolve(entryPath) === path.resolve(activeFolder)) continue;
    if (entry.name.startsWith('.building-')) continue;
    if (entry.isDirectory()) removeFolder(entryPath);
    else removeFile(entryPath);
  }
}

async function rebuildScrubPreview(video, settings) {
  const inputPath = resolveExistingPath(
    video.previewPath,
    video.compressedPath,
    video.filepath,
    video.rawPath
  );
  if (!inputPath) throw new Error('Scrub preview source file nije pronađen.');
  const dimensions = parseResolution(settings.scrubResolution, '320x180');
  const rootFolder = path.join(paths.scrubPreviews, String(video._id));
  const buildId = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const buildingFolder = path.join(rootFolder, `.building-${buildId}`);
  const activeFolder = path.join(rootFolder, `v-${buildId}`);
  const previousFolder = video.scrubPreview?.folderPath
    ? path.resolve(video.scrubPreview.folderPath)
    : rootFolder;
  const previousScrubPreview = video.scrubPreview?.toObject?.() || video.scrubPreview;
  ensureFolderExists(buildingFolder);

  try {
    const mediaProbe = await probeMedia(inputPath);
    const duration = mediaProbe.duration || video.duration || 0;
    for (let index = 0; index < settings.scrubFrameCount; index += 1) {
      await createScrubPreviewFrame({
        inputPath,
        outputPath: path.join(buildingFolder, `frame_${String(index).padStart(2, '0')}.jpg`),
        timestamp: getScrubPreviewTimestamp(duration, index, settings.scrubFrameCount),
        width: dimensions.width,
        height: dimensions.height,
        jpegQuality: settings.scrubJpegQuality,
      });
    }
    const firstFrame = path.join(buildingFolder, 'frame_00.jpg');
    const lastFrame = path.join(
      buildingFolder,
      `frame_${String(settings.scrubFrameCount - 1).padStart(2, '0')}.jpg`
    );
    if (!fs.existsSync(firstFrame) || !fs.existsSync(lastFrame)) {
      throw new Error('Scrub preview frameovi nisu kompletni.');
    }
    fs.renameSync(buildingFolder, activeFolder);
    try {
      video.scrubPreview = {
        folderPath: activeFolder,
        frameCount: settings.scrubFrameCount,
        frameWidth: dimensions.width,
        frameHeight: dimensions.height,
        duration,
        createdAt: new Date(),
        version: 'frames-v1',
        profileVersion: settings.scrubProfileVersion,
        jpegQuality: settings.scrubJpegQuality,
        error: '',
      };
      await video.save();
    } catch (error) {
      removeFolder(activeFolder);
      video.scrubPreview = previousScrubPreview;
      throw error;
    }
    if (isPathInside(rootFolder, previousFolder)) {
      try {
        cleanupInactiveScrubVersions(rootFolder, activeFolder);
      } catch (cleanupError) {
        console.warn(`Scrub preview cleanup failed for ${video._id}:`, cleanupError.message);
      }
    }
    return { assetType: 'scrub', status: 'rebuilt', folderPath: activeFolder };
  } finally {
    removeFolder(buildingFolder);
  }
}

async function processPreviewMaintenanceTask(data, job) {
  const video = await Video.findById(data.videoId);
  if (!video) throw new Error('Video nije pronađen.');
  const settings = await getMediaSettings();
  const assetTypes = Array.from(new Set(data.assetTypes || []))
    .filter((assetType) => ['mp4', 'thumbnail', 'scrub'].includes(assetType));
  if (assetTypes.length === 0) throw new Error('Nije odabran preview asset.');

  video.previewMaintenance = {
    status: 'processing',
    assetTypes,
    error: '',
    startedAt: new Date(),
  };
  await video.save();

  const results = [];
  try {
    for (let index = 0; index < assetTypes.length; index += 1) {
      const assetType = assetTypes[index];
      if (assetType === 'mp4') results.push(await rebuildMp4Preview(video, settings));
      if (assetType === 'thumbnail') results.push(await rebuildThumbnail(video, settings));
      if (assetType === 'scrub') results.push(await rebuildScrubPreview(video, settings));
      if (job && typeof job.progress === 'function') {
        await job.progress(Math.round(((index + 1) / assetTypes.length) * 100));
      }
    }
    video.previewMaintenance = {
      status: 'idle',
      assetTypes,
      error: '',
      startedAt: video.previewMaintenance?.startedAt,
      completedAt: new Date(),
    };
    await video.save();
    return { videoId: video._id, results };
  } catch (error) {
    video.previewMaintenance = {
      status: 'failed',
      assetTypes,
      error: error.message,
      startedAt: video.previewMaintenance?.startedAt,
      completedAt: new Date(),
    };
    await video.save();
    throw error;
  }
}

module.exports = {
  processPreviewMaintenanceTask,
  rebuildMp4Preview,
  rebuildScrubPreview,
  rebuildThumbnail,
};
