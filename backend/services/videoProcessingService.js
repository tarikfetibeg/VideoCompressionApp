const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const Video = require('../models/Video');
const AuditLog = require('../models/AuditLog');
const {
  getMediaSettings,
  parseResolution,
} = require('./mediaProfileService');
const {
  inspectBrowserCompatibility,
  toPlaybackCompatibility,
} = require('./mediaCompatibilityService');
const { paths, ensureFolderExists } = require('../utils/storagePaths');

const SCRUB_PREVIEW_VERSION = 'frames-v1';
const SCRUB_PREVIEW_FRAME_COUNT = 12;
const SCRUB_PREVIEW_FRAME_WIDTH = 320;
const SCRUB_PREVIEW_FRAME_HEIGHT = 180;

function isPathInside(parentPath, candidatePath) {
  if (!candidatePath) return false;
  const resolvedParent = path.resolve(parentPath);
  const resolvedCandidate = path.resolve(candidatePath);
  return resolvedCandidate === resolvedParent || resolvedCandidate.startsWith(`${resolvedParent}${path.sep}`);
}

function removeFileIfExists(filePath) {
  if (filePath && fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

function removeDirectoryIfExists(folderPath) {
  if (folderPath && fs.existsSync(folderPath)) {
    fs.rmSync(folderPath, { recursive: true, force: true });
  }
}

function resolveExistingPath(...candidatePaths) {
  for (const candidatePath of candidatePaths) {
    if (!candidatePath) continue;

    const resolvedPath = path.resolve(candidatePath);
    if (fs.existsSync(resolvedPath)) {
      return resolvedPath;
    }
  }

  return null;
}

function getScrubPreviewFolder(videoOrId) {
  const videoId = videoOrId?._id || videoOrId;
  return path.join(paths.scrubPreviews, String(videoId));
}

function getScrubPreviewFramePath(folderPath, frameIndex) {
  return path.join(folderPath, `frame_${String(frameIndex).padStart(2, '0')}.jpg`);
}

function getScrubPreviewFolderForVideo(video) {
  return video?.scrubPreview?.folderPath || getScrubPreviewFolder(video?._id || video);
}

function removeScrubPreviewFolderForVideo(video) {
  const folderPath = getScrubPreviewFolder(video?._id || video);
  const resolvedFolder = path.resolve(folderPath);

  if (!isPathInside(paths.scrubPreviews, resolvedFolder)) {
    return false;
  }

  removeDirectoryIfExists(resolvedFolder);
  return true;
}

function hasUsableScrubPreview(video) {
  const frameCount = Number(video?.scrubPreview?.frameCount) || 0;
  if (!video?._id || frameCount <= 0 || video.scrubPreview?.error) return false;

  const folderPath = getScrubPreviewFolderForVideo(video);
  const resolvedFolder = path.resolve(folderPath);
  if (!isPathInside(paths.scrubPreviews, resolvedFolder)) return false;

  const firstFrame = getScrubPreviewFramePath(resolvedFolder, 0);
  const lastFrame = getScrubPreviewFramePath(resolvedFolder, frameCount - 1);
  return fs.existsSync(firstFrame) && fs.existsSync(lastFrame);
}

function resolveScrubPreviewFramePath(video, frameIndex) {
  const frameCount = Number(video?.scrubPreview?.frameCount) || 0;
  const parsedIndex = Number(frameIndex);

  if (!Number.isInteger(parsedIndex) || parsedIndex < 0 || parsedIndex >= frameCount) {
    return null;
  }

  const folderPath = getScrubPreviewFolderForVideo(video);
  const framePath = getScrubPreviewFramePath(path.resolve(folderPath), parsedIndex);

  if (!isPathInside(paths.scrubPreviews, framePath) || !fs.existsSync(framePath)) {
    return null;
  }

  return framePath;
}

function getFileSize(filePath) {
  return filePath && fs.existsSync(filePath) ? fs.statSync(filePath).size : null;
}

function parseFrameRate(value) {
  if (!value || typeof value !== 'string') return null;

  const [numerator, denominator] = value.split('/').map(Number);
  if (!numerator || !denominator) return null;

  return Math.round((numerator / denominator) * 1000) / 1000;
}

function probeMedia(filePath) {
  return new Promise((resolve) => {
    if (!filePath || !fs.existsSync(filePath)) {
      return resolve({});
    }

    ffmpeg.ffprobe(filePath, (error, metadata) => {
      if (error) {
        console.warn('FFprobe warning:', error.message);
        return resolve({});
      }

      const videoStream = metadata.streams.find((stream) => stream.codec_type === 'video') || {};
      const audioStream = metadata.streams.find((stream) => stream.codec_type === 'audio') || {};
      const format = metadata.format || {};
      const width = videoStream.width;
      const height = videoStream.height;

      return resolve({
        container: format.format_name || null,
        duration: Number(format.duration) || null,
        codec: videoStream.codec_name || null,
        resolution: width && height ? `${width}x${height}` : null,
        bitrate: Number(format.bit_rate) ? Math.round(Number(format.bit_rate) / 1000) : null,
        framerate: parseFrameRate(videoStream.avg_frame_rate || videoStream.r_frame_rate),
        audioCodec: audioStream.codec_name || null,
        audioChannels: audioStream.channels || null,
        audioSampleRate: Number(audioStream.sample_rate) || null,
      });
    });
  });
}

function applySourceMetadata(video, mediaProbe = {}) {
  video.sourceFormat = video.sourceFormat || mediaProbe.container || null;
  video.sourceCodec = video.sourceCodec || mediaProbe.codec || null;
  video.sourceResolution = video.sourceResolution || mediaProbe.resolution || null;
  video.sourceBitrate = video.sourceBitrate || mediaProbe.bitrate || null;
  video.sourceFramerate = video.sourceFramerate || mediaProbe.framerate || null;
  video.sourceDuration = video.sourceDuration || mediaProbe.duration || null;
  video.sourceAudioCodec = video.sourceAudioCodec || mediaProbe.audioCodec || null;
  video.sourceAudioChannels = video.sourceAudioChannels || mediaProbe.audioChannels || null;
  video.sourceAudioSampleRate = video.sourceAudioSampleRate || mediaProbe.audioSampleRate || null;
  video.duration = video.duration || mediaProbe.duration || null;
}

function convertVideo({
  inputPath,
  outputPath,
  codec,
  resolution,
  bitrateKbps,
  frameRate,
  onProgress,
}) {
  return new Promise((resolve, reject) => {
    ensureFolderExists(path.dirname(outputPath));

    ffmpeg(inputPath)
      .inputOptions(['-fflags +genpts'])
      .videoCodec(codec)
      .audioCodec('aac')
      .size(resolution)
      .videoBitrate(bitrateKbps)
      .audioBitrate('128k')
      .fps(frameRate)
      .outputOptions([
        '-map 0:v:0',
        '-map 0:a?',
        '-dn',
        '-sn',
        '-pix_fmt yuv420p',
        '-movflags +faststart',
        '-max_muxing_queue_size 2048',
      ])
      .on('progress', (progress) => {
        const percent = getFfmpegProgressPercent(progress);
        if (percent !== null && onProgress) {
          onProgress(percent);
        }
      })
      .on('end', resolve)
      .on('error', reject)
      .save(outputPath);
  });
}

function convertPreviewAttempt({
  inputPath,
  outputPath,
  onProgress,
  encoder,
  preset,
  resolution,
  videoBitrate,
  audioBitrate,
  frameRate,
}) {
  return new Promise((resolve, reject) => {
    ensureFolderExists(path.dirname(outputPath));
    const dimensions = parseResolution(resolution, '1280x720');
    const aspectFilter = `scale=w=${dimensions.width}:h=${dimensions.height}:force_original_aspect_ratio=decrease:force_divisible_by=2,`
      + `pad=${dimensions.width}:${dimensions.height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`;

    const command = ffmpeg(inputPath)
      .inputOptions(['-fflags +genpts'])
      .videoCodec(encoder)
      .audioCodec('aac')
      .videoFilters(aspectFilter)
      .videoBitrate(videoBitrate)
      .audioBitrate(`${audioBitrate}k`)
      .fps(frameRate)
      .outputOptions([
        '-map 0:v:0',
        '-map 0:a?',
        '-dn',
        '-sn',
        '-pix_fmt yuv420p',
        '-movflags +faststart',
        '-max_muxing_queue_size 2048',
      ]);

    if (encoder === 'h264_nvenc') {
      command.outputOptions([
        `-preset ${preset}`,
        '-tune hq',
        '-profile:v high',
        '-rc vbr',
        '-spatial-aq 1',
        '-temporal-aq 1',
      ]);
    } else {
      command.outputOptions([`-preset ${preset}`]);
    }

    command
      .on('progress', (progress) => {
        const percent = getFfmpegProgressPercent(progress);
        if (percent !== null && onProgress) {
          onProgress(percent);
        }
      })
      .on('end', resolve)
      .on('error', reject)
      .save(outputPath);
  });
}

function isPreviewNvencRuntimeError(error) {
  return /(cannot load (?:nvcuda|nvencodeapi)|no capable devices|device not available|encode session|openencode session|driver does not support|required nvenc api|nvenc api version|cannot init cuda|cuda_error|out of memory|error while opening encoder|failed to (?:open|initiali[sz]e) (?:encoder|device))/i
    .test(String(error?.message || ''));
}

async function convertPreviewVideo({
  inputPath,
  outputPath,
  onProgress,
  settings,
  sourceFramerate,
}) {
  const mediaSettings = settings || await getMediaSettings();
  const requestedEncoder = mediaSettings.mp4PreviewEncoder;
  const resolution = mediaSettings.mp4PreviewResolution;
  const frameRate = mediaSettings.mp4PreviewFramerateMode === 'source_capped_50'
    ? Math.min(Math.max(Number(sourceFramerate) || 30, 1), 50)
    : mediaSettings.mp4PreviewFramerate;
  const startedAt = Date.now();
  let encoderUsed = requestedEncoder;
  let preset = requestedEncoder === 'h264_nvenc'
    ? mediaSettings.mp4PreviewNvencPreset
    : mediaSettings.mp4PreviewCpuPreset;
  let cpuFallbackUsed = false;
  let fallbackReason = '';

  try {
    await convertPreviewAttempt({
      inputPath,
      outputPath,
      onProgress,
      encoder: encoderUsed,
      preset,
      resolution,
      videoBitrate: mediaSettings.mp4PreviewVideoBitrate,
      audioBitrate: mediaSettings.mp4PreviewAudioBitrate,
      frameRate,
    });
  } catch (error) {
    if (
      requestedEncoder !== 'h264_nvenc'
      || mediaSettings.mp4PreviewCpuFallback === false
      || !isPreviewNvencRuntimeError(error)
    ) {
      throw error;
    }
    removeFileIfExists(outputPath);
    encoderUsed = 'libx264';
    preset = mediaSettings.mp4PreviewCpuPreset;
    cpuFallbackUsed = true;
    fallbackReason = error.message;
    await convertPreviewAttempt({
      inputPath,
      outputPath,
      onProgress,
      encoder: encoderUsed,
      preset,
      resolution,
      videoBitrate: mediaSettings.mp4PreviewVideoBitrate,
      audioBitrate: mediaSettings.mp4PreviewAudioBitrate,
      frameRate,
    });
  }

  const dimensions = parseResolution(resolution);
  return {
    profileVersion: mediaSettings.mp4PreviewProfileVersion,
    encoderRequested: requestedEncoder,
    encoderUsed,
    encoderPreset: preset,
    cpuFallbackUsed,
    fallbackReason,
    width: dimensions.width,
    height: dimensions.height,
    videoBitrate: mediaSettings.mp4PreviewVideoBitrate,
    audioBitrate: mediaSettings.mp4PreviewAudioBitrate,
    framerate: frameRate,
    size: getFileSize(outputPath) || 0,
    processingMs: Date.now() - startedAt,
    createdAt: new Date(),
    error: '',
  };
}

function createThumbnail({
  inputPath,
  outputPath,
  resolution = '640x360',
  jpegQuality = 3,
}) {
  return new Promise((resolve, reject) => {
    ensureFolderExists(path.dirname(outputPath));
    const dimensions = parseResolution(resolution, '640x360');
    const aspectFilter = `scale=w=${dimensions.width}:h=${dimensions.height}:force_original_aspect_ratio=decrease:force_divisible_by=2,`
      + `pad=${dimensions.width}:${dimensions.height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`;

    ffmpeg(inputPath)
      .inputOptions(['-fflags +genpts'])
      .seekInput('00:00:01')
      .frames(1)
      .videoFilters(aspectFilter)
      .outputOptions([
        '-map 0:v:0',
        `-q:v ${jpegQuality}`,
      ])
      .on('end', resolve)
      .on('error', reject)
      .save(outputPath);
  });
}

function getScrubPreviewTimestamp(duration, frameIndex, frameCount) {
  const parsedDuration = Number(duration);
  if (!Number.isFinite(parsedDuration) || parsedDuration <= 0) {
    return 0;
  }

  const position = parsedDuration * ((frameIndex + 0.5) / frameCount);
  const upperBound = Math.max(parsedDuration - 0.15, 0);
  return Math.min(Math.max(position, 0), upperBound);
}

function createScrubPreviewFrame({
  inputPath,
  outputPath,
  timestamp,
  width,
  height,
  jpegQuality = 3,
}) {
  return new Promise((resolve, reject) => {
    ensureFolderExists(path.dirname(outputPath));
    const aspectFilter = `scale=w=${width}:h=${height}:force_original_aspect_ratio=decrease:force_divisible_by=2,`
      + `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`;

    ffmpeg(inputPath)
      .inputOptions(['-fflags +genpts'])
      .seekInput(timestamp)
      .frames(1)
      .videoFilters(aspectFilter)
      .outputOptions([
        '-map 0:v:0',
        `-q:v ${jpegQuality}`,
      ])
      .on('end', resolve)
      .on('error', reject)
      .save(outputPath);
  });
}

async function buildScrubPreviewForVideo(video, options = {}) {
  const mediaSettings = options.settings || await getMediaSettings();
  const scrubDimensions = parseResolution(mediaSettings.scrubResolution, '320x180');
  const {
    force = false,
    frameCount = mediaSettings.scrubFrameCount || SCRUB_PREVIEW_FRAME_COUNT,
    frameWidth = scrubDimensions.width || SCRUB_PREVIEW_FRAME_WIDTH,
    frameHeight = scrubDimensions.height || SCRUB_PREVIEW_FRAME_HEIGHT,
    jpegQuality = mediaSettings.scrubJpegQuality || 3,
  } = options;

  if (!video?._id) {
    return { status: 'skipped', reason: 'missing_video' };
  }

  if (!force && hasUsableScrubPreview(video)) {
    return {
      status: 'skipped',
      reason: 'already_exists',
      videoId: video._id,
      frameCount: video.scrubPreview.frameCount,
    };
  }

  const folderPath = getScrubPreviewFolder(video._id);
  const resolvedFolder = path.resolve(folderPath);

  if (!isPathInside(paths.scrubPreviews, resolvedFolder)) {
    const errorMessage = 'Scrub preview path is outside storage.';
    video.scrubPreview = {
      ...(video.scrubPreview || {}),
      folderPath: resolvedFolder,
      frameCount: 0,
      frameWidth,
      frameHeight,
      duration: video.duration || null,
      createdAt: new Date(),
      version: SCRUB_PREVIEW_VERSION,
      profileVersion: mediaSettings.scrubProfileVersion,
      jpegQuality,
      error: errorMessage,
    };
    await video.save();
    return { status: 'failed', reason: errorMessage, videoId: video._id };
  }

  const inputPath = resolveExistingPath(
    video.previewPath,
    video.compressedPath,
    video.filepath,
    video.rawPath
  );

  if (!inputPath) {
    const errorMessage = 'Source file not found.';
    video.scrubPreview = {
      ...(video.scrubPreview || {}),
      folderPath: resolvedFolder,
      frameCount: 0,
      frameWidth,
      frameHeight,
      duration: video.duration || null,
      createdAt: new Date(),
      version: SCRUB_PREVIEW_VERSION,
      profileVersion: mediaSettings.scrubProfileVersion,
      jpegQuality,
      error: errorMessage,
    };
    await video.save();
    return { status: 'skipped', reason: 'source_missing', videoId: video._id };
  }

  try {
    removeDirectoryIfExists(resolvedFolder);
    ensureFolderExists(resolvedFolder);

    const mediaProbe = await probeMedia(inputPath);
    const duration = mediaProbe.duration || video.duration || null;
    const generatedFrameCount = Math.max(1, Math.min(Number(frameCount) || SCRUB_PREVIEW_FRAME_COUNT, 24));

    for (let index = 0; index < generatedFrameCount; index += 1) {
      await createScrubPreviewFrame({
        inputPath,
        outputPath: getScrubPreviewFramePath(resolvedFolder, index),
        timestamp: getScrubPreviewTimestamp(duration, index, generatedFrameCount),
        width: frameWidth,
        height: frameHeight,
        jpegQuality,
      });
    }

    video.duration = video.duration || duration;
    video.scrubPreview = {
      folderPath: resolvedFolder,
      frameCount: generatedFrameCount,
      frameWidth,
      frameHeight,
      duration,
      createdAt: new Date(),
      version: SCRUB_PREVIEW_VERSION,
      profileVersion: mediaSettings.scrubProfileVersion,
      jpegQuality,
      error: '',
    };
    await video.save();

    return {
      status: 'built',
      videoId: video._id,
      frameCount: generatedFrameCount,
      folderPath: resolvedFolder,
    };
  } catch (error) {
    const errorMessage = error.message || 'Scrub preview generation failed.';

    removeDirectoryIfExists(resolvedFolder);
    video.scrubPreview = {
      folderPath: resolvedFolder,
      frameCount: 0,
      frameWidth,
      frameHeight,
      duration: video.duration || null,
      createdAt: new Date(),
      version: SCRUB_PREVIEW_VERSION,
      profileVersion: mediaSettings.scrubProfileVersion,
      jpegQuality,
      error: errorMessage,
    };
    await video.save();

    return {
      status: 'failed',
      reason: errorMessage,
      videoId: video._id,
    };
  }
}

async function updateProgress(video, job, processingProgress) {
  video.processingProgress = processingProgress;
  await video.save();

  if (job && typeof job.progress === 'function') {
    await job.progress(processingProgress);
  }
}

function getFfmpegProgressPercent(progress) {
  const percent = Number(progress?.percent);
  if (!Number.isFinite(percent)) return null;
  return Math.min(100, Math.max(0, percent));
}

function mapPhaseProgress(percent, start, end) {
  if (!Number.isFinite(percent)) return start;
  return start + ((end - start) * Math.min(100, Math.max(0, percent)) / 100);
}

function createProgressReporter(video, job) {
  let lastProgress = Number(video.processingProgress) || 0;
  let lastSaveAt = 0;
  let pendingSave = Promise.resolve();

  const report = (progressValue, { force = false } = {}) => {
    const nextProgress = Math.min(100, Math.max(0, Math.round(Number(progressValue) || 0)));
    const now = Date.now();
    const meaningfulChange = nextProgress > lastProgress && nextProgress - lastProgress >= 2;
    const staleEnough = now - lastSaveAt >= 2000;

    if (!force && (!meaningfulChange || !staleEnough)) {
      return pendingSave;
    }

    if (!force && nextProgress <= lastProgress) {
      return pendingSave;
    }

    lastProgress = nextProgress;
    lastSaveAt = now;
    video.processingProgress = nextProgress;

    pendingSave = pendingSave
      .then(async () => {
        await Video.updateOne(
          { _id: video._id },
          { $set: { processingProgress: nextProgress } }
        );

        if (job && typeof job.progress === 'function') {
          await job.progress(nextProgress);
        }
      })
      .catch((error) => {
        console.warn('Processing progress update failed:', error.message);
      });

    return pendingSave;
  };

  report.flush = () => pendingSave;

  return report;
}

async function processVideoJob({ videoId }, job) {
  const video = await Video.findById(videoId);

  if (!video) {
    throw new Error(`Video not found: ${videoId}`);
  }

  const inputPath = video.rawPath || video.filepath;

  try {
    if (!inputPath || !fs.existsSync(inputPath)) {
      throw new Error('Input video file is missing.');
    }

    video.processingProgress = 0;
    video.processingStatus = 'processing';
    video.processingError = null;
    video.processingStartedAt = new Date();
    video.processingCompletedAt = null;
    applySourceMetadata(video, await probeMedia(inputPath));
    await video.save();

    const reportProgress = createProgressReporter(video, job);
    const mediaSettings = await getMediaSettings();
    const previewPolicy = mediaSettings.mp4PreviewPolicy === 'always'
      ? 'always'
      : 'when_required';
    await reportProgress(5, { force: true });

    if (video.processingMode === 'finalize') {
      const sourceCompatibility = await inspectBrowserCompatibility(inputPath);
      const skipPreview = previewPolicy === 'when_required' && sourceCompatibility.compatible;
      if (skipPreview) {
        video.previewPath = null;
        video.sizePreview = 0;
        video.playbackCompatibility = toPlaybackCompatibility(sourceCompatibility, 'compressed');
        video.mp4Preview = {
          profileVersion: mediaSettings.mp4PreviewProfileVersion,
          encoderRequested: mediaSettings.mp4PreviewEncoder,
          encoderUsed: 'source',
          width: sourceCompatibility.probe?.width,
          height: sourceCompatibility.probe?.height,
          videoBitrate: video.sourceBitrate,
          audioBitrate: null,
          framerate: video.sourceFramerate,
          size: getFileSize(inputPath) || 0,
          processingMs: 0,
          createdAt: new Date(),
          error: '',
        };
      } else {
        video.mp4Preview = await convertPreviewVideo({
          inputPath,
          outputPath: video.previewPath,
          onProgress: (percent) => reportProgress(mapPhaseProgress(percent, 5, 45)),
          settings: mediaSettings,
          sourceFramerate: video.sourceFramerate,
        });
        video.playbackCompatibility = toPlaybackCompatibility(
          await inspectBrowserCompatibility(video.previewPath),
          'preview'
        );
      }
      await reportProgress(45, { force: true });

      await createThumbnail({
        inputPath,
        outputPath: video.thumbnailPath,
        resolution: mediaSettings.thumbnailResolution,
        jpegQuality: mediaSettings.thumbnailJpegQuality,
      });
      {
        const dimensions = parseResolution(mediaSettings.thumbnailResolution, '640x360');
        video.thumbnail = {
          profileVersion: mediaSettings.thumbnailProfileVersion,
          width: dimensions.width,
          height: dimensions.height,
          jpegQuality: mediaSettings.thumbnailJpegQuality,
          size: getFileSize(video.thumbnailPath) || 0,
          createdAt: new Date(),
          error: '',
        };
      }
      await reportProgress(62, { force: true });

      const scrubResult = await buildScrubPreviewForVideo(video, {
        force: true,
        settings: mediaSettings,
      });
      if (scrubResult.status === 'failed') {
        console.warn(`Scrub preview failed for video ${video._id}: ${scrubResult.reason}`);
      }
      await reportProgress(78, { force: true });

      ensureFolderExists(path.dirname(video.compressedPath));
      fs.renameSync(inputPath, video.compressedPath);
      await reportProgress(90, { force: true });

      video.filepath = video.compressedPath;
      video.rawPath = video.compressedPath;
      video.rawDeleted = false;
      video.rawDeletedAt = null;
    } else {
      await convertVideo({
        inputPath,
        outputPath: video.compressedPath,
        codec: video.codec || 'libx264',
        resolution: video.resolution || '1920x1080',
        bitrateKbps: video.bitrate || 1500,
        frameRate: video.framerate || 30,
        onProgress: (percent) => reportProgress(mapPhaseProgress(percent, 5, 45)),
      });
      await reportProgress(45, { force: true });

      const compressedCompatibility = await inspectBrowserCompatibility(video.compressedPath);
      const skipPreview = previewPolicy === 'when_required' && compressedCompatibility.compatible;
      if (skipPreview) {
        video.previewPath = null;
        video.sizePreview = 0;
        video.playbackCompatibility = toPlaybackCompatibility(compressedCompatibility, 'compressed');
        video.mp4Preview = {
          profileVersion: mediaSettings.mp4PreviewProfileVersion,
          encoderRequested: mediaSettings.mp4PreviewEncoder,
          encoderUsed: 'source',
          width: compressedCompatibility.probe?.width,
          height: compressedCompatibility.probe?.height,
          videoBitrate: video.bitrate,
          audioBitrate: null,
          framerate: video.framerate,
          size: getFileSize(video.compressedPath) || 0,
          processingMs: 0,
          createdAt: new Date(),
          error: '',
        };
      } else {
        video.mp4Preview = await convertPreviewVideo({
          inputPath,
          outputPath: video.previewPath,
          onProgress: (percent) => reportProgress(mapPhaseProgress(percent, 45, 70)),
          settings: mediaSettings,
          sourceFramerate: video.sourceFramerate,
        });
        video.playbackCompatibility = toPlaybackCompatibility(
          await inspectBrowserCompatibility(video.previewPath),
          'preview'
        );
      }
      await reportProgress(70, { force: true });

      await createThumbnail({
        inputPath,
        outputPath: video.thumbnailPath,
        resolution: mediaSettings.thumbnailResolution,
        jpegQuality: mediaSettings.thumbnailJpegQuality,
      });
      {
        const dimensions = parseResolution(mediaSettings.thumbnailResolution, '640x360');
        video.thumbnail = {
          profileVersion: mediaSettings.thumbnailProfileVersion,
          width: dimensions.width,
          height: dimensions.height,
          jpegQuality: mediaSettings.thumbnailJpegQuality,
          size: getFileSize(video.thumbnailPath) || 0,
          createdAt: new Date(),
          error: '',
        };
      }
      await reportProgress(84, { force: true });

      const scrubResult = await buildScrubPreviewForVideo(video, {
        force: true,
        settings: mediaSettings,
      });
      if (scrubResult.status === 'failed') {
        console.warn(`Scrub preview failed for video ${video._id}: ${scrubResult.reason}`);
      }
      await reportProgress(90, { force: true });

      if (!video.rawRetentionDays || video.rawRetentionDays <= 0) {
        removeFileIfExists(inputPath);
        video.rawPath = null;
        video.rawDeleted = true;
        video.rawDeletedAt = new Date();
      }
    }

    await reportProgress.flush();
    const mediaProbe = await probeMedia(video.compressedPath || video.filepath);

    video.filepath = video.compressedPath || video.filepath;
    video.sizeCompressed = getFileSize(video.compressedPath);
    video.sizePreview = video.previewPath ? getFileSize(video.previewPath) : 0;
    video.sizeThumbnail = getFileSize(video.thumbnailPath);
    video.duration = mediaProbe.duration || video.duration;
    video.codec = video.codec || mediaProbe.codec;
    video.resolution = video.resolution || mediaProbe.resolution;
    video.bitrate = video.bitrate || mediaProbe.bitrate;
    video.framerate = video.framerate || mediaProbe.framerate;
    video.processingStatus = 'completed';
    video.processingProgress = 100;
    video.processingCompletedAt = new Date();
    video.processingError = null;
    if (video.finalApprovalStatus === 'approved' && ['aired', 'archived'].includes(video.broadcastStatus)) {
      if (video.broadcastStatus === 'archived') {
        video.archivedAt = video.archivedAt || new Date();
      }
    } else if (video.finalApprovalStatus === 'approved') {
      video.broadcastStatus = 'approved_for_air';
    } else {
      video.broadcastStatus = video.qcStatus === 'passed' ? 'ready_for_approval' : 'qc_pending';
    }

    await video.save();

    if (video.uploader) {
      await AuditLog.create({
        action: 'Video Processing Completed',
        performedBy: video.uploader,
        details: {
          videoId: video._id,
          filename: video.filename,
          processingMode: video.processingMode,
          sizeCompressed: video.sizeCompressed,
          sizePreview: video.sizePreview,
          sizeThumbnail: video.sizeThumbnail,
        },
      });
    }

    return video;
  } catch (error) {
    video.processingStatus = 'failed';
    video.processingError = error.message;
    video.processingCompletedAt = new Date();
    await video.save();

    if (video.uploader) {
      await AuditLog.create({
        action: 'Video Processing Failed',
        performedBy: video.uploader,
        details: {
          videoId: video._id,
          filename: video.filename,
          processingMode: video.processingMode,
          error: error.message,
        },
      });
    }

    throw error;
  }
}

module.exports = {
  SCRUB_PREVIEW_VERSION,
  buildScrubPreviewForVideo,
  convertPreviewVideo,
  createScrubPreviewFrame,
  createThumbnail,
  getScrubPreviewTimestamp,
  getScrubPreviewFolder,
  getScrubPreviewFolderForVideo,
  getScrubPreviewFramePath,
  hasUsableScrubPreview,
  probeMedia,
  processVideoJob,
  removeScrubPreviewFolderForVideo,
  resolveScrubPreviewFramePath,
};
