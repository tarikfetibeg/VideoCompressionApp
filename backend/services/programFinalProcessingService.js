const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const ProgramFinal = require('../models/ProgramFinal');
const ProgramFinalVersion = require('../models/ProgramFinalVersion');
const { enqueueDomainEvent } = require('./domainEventService');
const {
  buildFfmpegArgs,
  getFolderSize,
  getHlsProfile,
  isNvencRuntimeError,
  runFfmpeg,
  validateHlsBuild,
  writeMasterPlaylist,
} = require('./hlsPreviewService');
const { getMediaSettings, parseResolution } = require('./mediaProfileService');
const { probeFile } = require('./mediaCompatibilityService');
const {
  convertPreviewVideo,
  createScrubPreviewFrame,
  createThumbnail,
  getScrubPreviewTimestamp,
} = require('./videoProcessingService');
const { paths, ensureFolderExists } = require('../utils/storagePaths');
const { resolveSafeRelativePath, safeRelativePath } = require('../utils/programFinals');

function parseFrameRate(value) {
  const [numerator, denominator] = String(value || '').split('/').map(Number);
  if (!numerator || !denominator) return 30;
  return Math.max(Math.min(numerator / denominator, 120), 1);
}

function removeFolder(folderPath) {
  if (folderPath && fs.existsSync(folderPath)) fs.rmSync(folderPath, { recursive: true, force: true });
}

function activateVersionFolder(buildingFolder, activeFolder) {
  const backupFolder = `${activeFolder}.previous-${crypto.randomBytes(4).toString('hex')}`;
  const hadActiveFolder = fs.existsSync(activeFolder);
  if (hadActiveFolder) fs.renameSync(activeFolder, backupFolder);
  try {
    fs.renameSync(buildingFolder, activeFolder);
    removeFolder(backupFolder);
  } catch (error) {
    if (hadActiveFolder && fs.existsSync(backupFolder) && !fs.existsSync(activeFolder)) {
      fs.renameSync(backupFolder, activeFolder);
    }
    throw error;
  }
}

async function buildHls(inputPath, outputFolder, mediaProbe, settings, onProgress) {
  const profile = getHlsProfile(settings);
  let encoder = profile.encoder;
  let fallbackReason = '';
  ensureFolderExists(outputFolder);
  try {
    await runFfmpeg(buildFfmpegArgs(
      inputPath,
      outputFolder,
      encoder,
      profile.preset,
      parseFrameRate(mediaProbe.frameRate),
      profile.renditions,
      profile.segmentDuration
    ), { duration: mediaProbe.duration, onProgress });
  } catch (error) {
    if (encoder !== 'h264_nvenc' || !profile.cpuFallback || !isNvencRuntimeError(error)) throw error;
    fallbackReason = error.message;
    encoder = 'libx264';
    removeFolder(outputFolder);
    ensureFolderExists(outputFolder);
    await runFfmpeg(buildFfmpegArgs(
      inputPath,
      outputFolder,
      encoder,
      'veryfast',
      parseFrameRate(mediaProbe.frameRate),
      profile.renditions,
      profile.segmentDuration
    ), { duration: mediaProbe.duration, onProgress });
  }
  writeMasterPlaylist(outputFolder, profile.renditions);
  validateHlsBuild(outputFolder, profile.renditions);
  return { encoder, fallbackReason, profile };
}

async function buildProgramFinalProxies(versionId, { force = false, onProgress } = {}) {
  const version = await ProgramFinalVersion.findById(versionId);
  if (!version) throw new Error('Verzija finala nije pronađena.');
  const programFinal = await ProgramFinal.findById(version.programFinal);
  if (!programFinal) throw new Error('Final emisije nije pronađen.');
  if (!force && version.status === 'ready' && version.proxy?.hlsMaster) {
    return { status: 'skipped', versionId: version._id };
  }

  const masterPath = resolveSafeRelativePath(paths.root, version.masterRelativePath);
  if (!masterPath || !fs.existsSync(masterPath)) throw new Error('Zaštićeni master nije pronađen.');
  const finalRoot = path.join(paths.programFinalPreviews, String(programFinal._id));
  const folderName = `v${version.versionNumber}-${version._id}`;
  const activeFolder = path.join(finalRoot, folderName);
  const buildingFolder = path.join(finalRoot, `.building-${folderName}-${crypto.randomBytes(4).toString('hex')}`);
  const hlsFolder = path.join(buildingFolder, 'hls');
  const scrubFolder = path.join(buildingFolder, 'scrub');
  const accessMp4Path = path.join(buildingFolder, 'access.mp4');
  const thumbnailPath = path.join(buildingFolder, 'thumbnail.jpg');
  ensureFolderExists(buildingFolder);
  const startedAt = Date.now();

  try {
    const settings = await getMediaSettings();
    const mediaProbe = await probeFile(masterPath);
    const hlsResult = await buildHls(masterPath, hlsFolder, mediaProbe, settings, (percent) => {
      if (onProgress) onProgress(Math.min(Math.max(percent * 0.7, 0), 70));
    });

    await convertPreviewVideo({
      inputPath: masterPath,
      outputPath: accessMp4Path,
      settings,
      sourceFramerate: parseFrameRate(mediaProbe.frameRate),
      onProgress: (percent) => onProgress?.(70 + (percent * 0.2)),
    });
    await createThumbnail({
      inputPath: accessMp4Path,
      outputPath: thumbnailPath,
      resolution: settings.thumbnailResolution,
      jpegQuality: settings.thumbnailJpegQuality,
    });

    ensureFolderExists(scrubFolder);
    const scrubDimensions = parseResolution(settings.scrubResolution, '320x180');
    const frameCount = Math.max(6, Math.min(Number(settings.scrubFrameCount) || 12, 24));
    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      await createScrubPreviewFrame({
        inputPath: accessMp4Path,
        outputPath: path.join(scrubFolder, `frame-${String(frameIndex).padStart(2, '0')}.jpg`),
        timestamp: getScrubPreviewTimestamp(mediaProbe.duration, frameIndex, frameCount),
        width: scrubDimensions.width,
        height: scrubDimensions.height,
        jpegQuality: settings.scrubJpegQuality,
      });
      onProgress?.(90 + ((frameIndex + 1) / frameCount) * 10);
    }

    if (!fs.existsSync(path.join(hlsFolder, 'master.m3u8')) || !fs.existsSync(accessMp4Path)) {
      throw new Error('Proxy validacija nije prošla.');
    }
    ensureFolderExists(finalRoot);
    activateVersionFolder(buildingFolder, activeFolder);

    version.codecMetadata = mediaProbe;
    version.proxy = {
      rootRelativePath: safeRelativePath(paths.programFinalPreviews, activeFolder),
      hlsMaster: 'hls/master.m3u8',
      accessMp4: 'access.mp4',
      thumbnail: 'thumbnail.jpg',
      scrubFolder: 'scrub',
      scrubFrameCount: frameCount,
      scrubWidth: scrubDimensions.width,
      scrubHeight: scrubDimensions.height,
      duration: mediaProbe.duration,
      profileVersions: {
        hls: settings.hlsProfileVersion,
        mp4: settings.mp4PreviewProfileVersion,
        thumbnail: settings.thumbnailProfileVersion,
        scrub: settings.scrubProfileVersion,
      },
      encoder: hlsResult.encoder,
      fallbackReason: hlsResult.fallbackReason ? `NVENC fallback: ${hlsResult.fallbackReason}` : '',
      size: getFolderSize(activeFolder),
      processingMs: Date.now() - startedAt,
      error: '',
      createdAt: new Date(),
    };
    version.status = 'ready';
    await version.save();

    const nextStatus = programFinal.airedAt
      ? 'ready_for_archive_review'
      : 'waiting_for_air';
    const currentPending = await ProgramFinal.updateOne(
      { _id: programFinal._id, pendingVersion: version._id },
      { $set: { status: nextStatus } }
    );

    if (currentPending.modifiedCount === 1 || currentPending.matchedCount === 1) {
      await enqueueDomainEvent({
        type: 'program_final.proxy_ready',
        severity: 'action_required',
        recipientRoles: ['Archivist'],
        entityType: 'program_final',
        entityId: programFinal._id,
        entityVersion: version.versionNumber,
        title: 'Final je spreman za pregled',
        bodyPreview: `${programFinal.title} · verzija ${version.versionNumber}`,
        deepLink: `vca://program-final/${programFinal._id}`,
        payload: { programFinalId: programFinal._id, versionId: version._id },
        dedupeKey: `program-final:proxy-ready:${version._id}`,
      });
    }
    return {
      status: 'ready',
      versionId: version._id,
      processingMs: version.proxy.processingMs,
      currentPending: currentPending.matchedCount === 1,
    };
  } catch (error) {
    removeFolder(buildingFolder);
    version.status = 'failed';
    version.proxy = { ...(version.proxy?.toObject?.() || version.proxy || {}), error: error.message };
    await version.save();
    await ProgramFinal.updateOne(
      { _id: programFinal._id, pendingVersion: version._id },
      { $set: { status: programFinal.activeVersion ? 'archived' : 'waiting_for_file' } }
    );
    throw error;
  }
}

module.exports = {
  buildProgramFinalProxies,
  parseFrameRate,
};
