const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const Video = require('../models/Video');
const { probeFile, resolveExistingPath } = require('./mediaCompatibilityService');
const { getMediaSettings } = require('./mediaProfileService');
const { paths, ensureFolderExists } = require('../utils/storagePaths');

const HLS_PREVIEW_VERSION = 'hls-v2-single-pass';
const HLS_SEGMENT_DURATION = 4;
const HLS_PREVIOUS_VERSION_GRACE_MS = Math.max(
  parseInt(process.env.HLS_PREVIOUS_VERSION_GRACE_SECONDS || '30', 10) || 30,
  20
) * 1000;
const HLS_RENDITIONS = [
  {
    name: '720p',
    width: 1280,
    height: 720,
    bitrate: 2200000,
    maxrate: 2640000,
    bufferSize: 4400000,
    cq: 21,
    audioBitrate: '128k',
    bandwidth: 2450000,
  },
  {
    name: '480p',
    width: 854,
    height: 480,
    bitrate: 900000,
    maxrate: 1080000,
    bufferSize: 1800000,
    cq: 22,
    audioBitrate: '96k',
    bandwidth: 1100000,
  },
];

function getHlsProfile(settings) {
  return {
    encoder: settings.hlsEncoder === 'h264_nvenc' ? 'h264_nvenc' : 'libx264',
    preset: settings.hlsNvencPreset || 'p5',
    cpuFallback: settings.hlsCpuFallback !== false,
    segmentDuration: Number(settings.hlsSegmentDuration) || HLS_SEGMENT_DURATION,
    profileVersion: Number(settings.hlsProfileVersion) || 1,
    renditions: [
      {
        ...HLS_RENDITIONS[0],
        bitrate: Number(settings.hls720VideoBitrate || 2200) * 1000,
        maxrate: Math.round(Number(settings.hls720VideoBitrate || 2200) * 1200),
        bufferSize: Number(settings.hls720VideoBitrate || 2200) * 2000,
        audioBitrate: `${Number(settings.hls720AudioBitrate) || 128}k`,
        bandwidth: (Number(settings.hls720VideoBitrate || 2200) + Number(settings.hls720AudioBitrate || 128)) * 1000,
      },
      {
        ...HLS_RENDITIONS[1],
        bitrate: Number(settings.hls480VideoBitrate || 900) * 1000,
        maxrate: Math.round(Number(settings.hls480VideoBitrate || 900) * 1200),
        bufferSize: Number(settings.hls480VideoBitrate || 900) * 2000,
        audioBitrate: `${Number(settings.hls480AudioBitrate) || 96}k`,
        bandwidth: (Number(settings.hls480VideoBitrate || 900) + Number(settings.hls480AudioBitrate || 96)) * 1000,
      },
    ],
  };
}

function isPathInside(rootPath, targetPath) {
  if (!targetPath) return false;
  const root = path.resolve(rootPath);
  const target = path.resolve(targetPath);
  return target === root || target.startsWith(`${root}${path.sep}`);
}

function getHlsPreviewFolder(videoId) {
  return path.join(paths.hlsPreviews, String(videoId));
}

function getActiveHlsFolder(video) {
  const videoRoot = getHlsPreviewFolder(video?._id || video);
  const configured = video?.hlsPreview?.folderPath
    ? path.resolve(video.hlsPreview.folderPath)
    : videoRoot;
  return isPathInside(videoRoot, configured) ? configured : videoRoot;
}

function getFolderSize(folderPath) {
  if (!folderPath || !fs.existsSync(folderPath)) return 0;
  return fs.readdirSync(folderPath, { withFileTypes: true }).reduce((total, entry) => {
    const entryPath = path.join(folderPath, entry.name);
    return total + (entry.isDirectory() ? getFolderSize(entryPath) : fs.statSync(entryPath).size);
  }, 0);
}

function removeFolderIfExists(folderPath) {
  if (folderPath && fs.existsSync(folderPath)) {
    fs.rmSync(folderPath, { recursive: true, force: true });
  }
}

function removeHlsPreviewFolder(videoId) {
  const folder = getHlsPreviewFolder(videoId);
  if (!isPathInside(paths.hlsPreviews, folder) || !fs.existsSync(folder)) return false;
  removeFolderIfExists(folder);
  return true;
}

function writeMasterPlaylist(folderPath, renditions = HLS_RENDITIONS) {
  const lines = ['#EXTM3U', '#EXT-X-VERSION:3', '#EXT-X-INDEPENDENT-SEGMENTS'];
  for (const rendition of renditions) {
    lines.push(
      `#EXT-X-STREAM-INF:BANDWIDTH=${rendition.bandwidth},AVERAGE-BANDWIDTH=${rendition.bitrate},RESOLUTION=${rendition.width}x${rendition.height},CODECS="avc1.64001f,mp4a.40.2"`
    );
    lines.push(`${rendition.name}/index.m3u8`);
  }
  fs.writeFileSync(path.join(folderPath, 'master.m3u8'), `${lines.join('\n')}\n`, 'utf8');
}

function parseFrameRate(value) {
  const [numerator, denominator] = String(value || '').split('/').map(Number);
  if (!numerator || !denominator) return 30;
  return Math.max(Math.min(numerator / denominator, 120), 1);
}

function buildScaleFilter(rendition, inputLabel, outputLabel) {
  return `${inputLabel}scale=w=${rendition.width}:h=${rendition.height}:force_original_aspect_ratio=decrease:force_divisible_by=2,`
    + `pad=${rendition.width}:${rendition.height}:(ow-iw)/2:(oh-ih)/2:color=black,`
    + `setsar=1${outputLabel}`;
}

function buildEncoderArgs(encoder, rendition, preset, gop, segmentDuration = HLS_SEGMENT_DURATION) {
  const common = [
    '-c:v', encoder,
    '-profile:v', 'high',
    '-pix_fmt', 'yuv420p',
    '-b:v', String(rendition.bitrate),
    '-maxrate', String(rendition.maxrate),
    '-bufsize', String(rendition.bufferSize),
    '-g', String(gop),
    '-keyint_min', String(gop),
    '-force_key_frames', `expr:gte(t,n_forced*${segmentDuration})`,
  ];
  if (encoder === 'h264_nvenc') {
    return [
      ...common,
      '-preset', preset,
      '-tune', 'hq',
      '-rc', 'vbr',
      '-cq', String(rendition.cq),
      '-multipass', 'qres',
      '-rc-lookahead', '20',
      '-spatial-aq', '1',
      '-temporal-aq', '1',
      '-aq-strength', '8',
      '-bf', '3',
      '-b_ref_mode', 'middle',
      '-forced-idr', '1',
    ];
  }
  return [
    ...common,
    '-preset', 'veryfast',
    '-sc_threshold', '0',
  ];
}

function buildOutputArgs(folderPath, rendition, encoder, preset, gop, videoLabel, segmentDuration) {
  const variantFolder = path.join(folderPath, rendition.name);
  ensureFolderExists(variantFolder);
  return [
    '-map', videoLabel,
    '-map', '0:a:0?',
    ...buildEncoderArgs(encoder, rendition, preset, gop, segmentDuration),
    '-c:a', 'aac',
    '-b:a', rendition.audioBitrate,
    '-ac', '2',
    '-ar', '48000',
    '-hls_time', String(segmentDuration),
    '-hls_playlist_type', 'vod',
    '-hls_flags', 'independent_segments',
    '-hls_segment_filename', path.join(variantFolder, 'segment_%05d.ts'),
    '-f', 'hls',
    path.join(variantFolder, 'index.m3u8'),
  ];
}

function buildFfmpegArgs(
  inputPath,
  folderPath,
  encoder,
  preset,
  frameRate,
  renditions = HLS_RENDITIONS,
  segmentDuration = HLS_SEGMENT_DURATION
) {
  const gop = Math.max(Math.round(frameRate * segmentDuration), 1);
  const filter = [
    '[0:v:0]split=2[v720src][v480src]',
    buildScaleFilter(renditions[0], '[v720src]', '[v720]'),
    buildScaleFilter(renditions[1], '[v480src]', '[v480]'),
  ].join(';');
  return [
    '-hide_banner',
    '-y',
    '-loglevel', 'warning',
    '-progress', 'pipe:1',
    '-nostats',
    '-fflags', '+genpts',
    '-i', inputPath,
    '-filter_complex', filter,
    ...buildOutputArgs(folderPath, renditions[0], encoder, preset, gop, '[v720]', segmentDuration),
    ...buildOutputArgs(folderPath, renditions[1], encoder, preset, gop, '[v480]', segmentDuration),
  ];
}

function runFfmpeg(args, { duration, onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', args, {
      windowsHide: true,
      shell: false,
    });
    let stdoutBuffer = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() || '';
      for (const line of lines) {
        const [key, rawValue] = line.split('=');
        if (key === 'out_time_ms' && duration && onProgress) {
          const seconds = Number(rawValue) / 1000000;
          const percent = Math.min(Math.max(Math.round((seconds / duration) * 100), 0), 99);
          onProgress(percent);
        }
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr = `${stderr}${chunk.toString()}`.slice(-16000);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        if (onProgress) onProgress(100);
        resolve();
        return;
      }
      const error = new Error(stderr.trim() || `FFmpeg exited with code ${code}.`);
      error.code = 'FFMPEG_FAILED';
      reject(error);
    });
  });
}

function validateHlsBuild(folderPath, renditions = HLS_RENDITIONS) {
  const masterPath = path.join(folderPath, 'master.m3u8');
  if (!fs.existsSync(masterPath)) throw new Error('HLS master playlist is missing.');
  for (const rendition of renditions) {
    const variantFolder = path.join(folderPath, rendition.name);
    const playlistPath = path.join(variantFolder, 'index.m3u8');
    if (!fs.existsSync(playlistPath)) throw new Error(`${rendition.name} playlist is missing.`);
    const playlist = fs.readFileSync(playlistPath, 'utf8');
    if (!playlist.includes('#EXT-X-ENDLIST')) throw new Error(`${rendition.name} VOD playlist is incomplete.`);
    const segments = fs.readdirSync(variantFolder).filter((name) => name.endsWith('.ts'));
    if (segments.length === 0) throw new Error(`${rendition.name} has no HLS segments.`);
  }
}

function isNvencRuntimeError(error) {
  return /(cannot load (?:nvcuda|nvencodeapi)|no capable devices|device not available|encode session|openencode session|driver does not support|required nvenc api|nvenc api version|cannot init cuda|cuda_error|out of memory|error while opening encoder|failed to (?:open|initiali[sz]e) (?:encoder|device))/i
    .test(String(error?.message || ''));
}

function cleanupInactiveBuilds(videoRoot, activeFolder, protectedFolder = null) {
  if (!fs.existsSync(videoRoot)) return;
  if (
    protectedFolder
    && path.resolve(protectedFolder) === path.resolve(videoRoot)
  ) {
    return;
  }
  for (const entry of fs.readdirSync(videoRoot, { withFileTypes: true })) {
    const entryPath = path.join(videoRoot, entry.name);
    if (entry.isDirectory() && entry.name.startsWith('.building-')) continue;
    if (path.resolve(entryPath) === path.resolve(activeFolder)) continue;
    if (protectedFolder && path.resolve(entryPath) === path.resolve(protectedFolder)) continue;
    if (entry.isDirectory()) removeFolderIfExists(entryPath);
    else fs.rmSync(entryPath, { force: true });
  }
}

async function getHlsSettings() {
  return getHlsProfile(await getMediaSettings());
}

async function buildHlsPreviewForVideo(videoOrId, { force = false, onProgress } = {}) {
  const video = typeof videoOrId === 'object' && videoOrId?._id
    ? videoOrId
    : await Video.findById(videoOrId);
  if (!video) throw new Error('Video not found.');

  if (!force && hasReadyHlsPreview(video)) {
    return { status: 'skipped', videoId: video._id };
  }

  const inputPath = resolveExistingPath(video.compressedPath, video.filepath, video.previewPath);
  const previous = video.hlsPreview?.toObject?.() || video.hlsPreview || {};
  const previousReady = hasReadyHlsPreview(video);
  const previousActiveFolder = previousReady ? getActiveHlsFolder(video) : null;
  if (!inputPath) {
    video.hlsPreview = {
      ...previous,
      status: previousReady ? 'ready' : 'failed',
      buildStatus: 'failed',
      error: previousReady ? previous.error || '' : 'HLS source file not found.',
      lastBuildError: 'HLS source file not found.',
      lastBuildFailedAt: new Date(),
      version: previous.version || HLS_PREVIEW_VERSION,
    };
    await video.save();
    throw new Error('HLS source file not found.');
  }

  const settings = await getHlsSettings();
  const mediaProbe = await probeFile(inputPath).catch(() => ({}));
  const frameRate = parseFrameRate(mediaProbe.frameRate);
  const duration = mediaProbe.duration || video.duration || null;
  const videoRoot = getHlsPreviewFolder(video._id);
  const buildId = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const buildingFolder = path.join(videoRoot, `.building-${buildId}`);
  const activeFolder = path.join(videoRoot, `v-${buildId}`);
  ensureFolderExists(buildingFolder);
  const startedAt = Date.now();

  video.hlsPreview = {
    ...previous,
    status: previousReady ? 'ready' : 'processing',
    buildStatus: 'processing',
    profileVersion: settings.profileVersion,
    encoderRequested: settings.encoder,
    encoderPreset: settings.encoder === 'h264_nvenc' ? settings.preset : 'veryfast',
    lastBuildError: '',
  };
  await video.save();

  let encoderUsed = settings.encoder;
  let fallbackReason = '';
  let cpuFallbackUsed = false;
  try {
    try {
      await runFfmpeg(
        buildFfmpegArgs(
          inputPath,
          buildingFolder,
          encoderUsed,
          settings.preset,
          frameRate,
          settings.renditions,
          settings.segmentDuration
        ),
        { duration, onProgress }
      );
    } catch (error) {
      if (
        settings.encoder !== 'h264_nvenc'
        || !settings.cpuFallback
        || !isNvencRuntimeError(error)
      ) {
        throw error;
      }
      fallbackReason = error.message;
      cpuFallbackUsed = true;
      encoderUsed = 'libx264';
      removeFolderIfExists(buildingFolder);
      ensureFolderExists(buildingFolder);
      await runFfmpeg(
        buildFfmpegArgs(
          inputPath,
          buildingFolder,
          encoderUsed,
          'veryfast',
          frameRate,
          settings.renditions,
          settings.segmentDuration
        ),
        { duration, onProgress }
      );
    }

    writeMasterPlaylist(buildingFolder, settings.renditions);
    validateHlsBuild(buildingFolder, settings.renditions);
    fs.renameSync(buildingFolder, activeFolder);
    const renditions = settings.renditions.map((rendition) => ({
      name: rendition.name,
      width: rendition.width,
      height: rendition.height,
      bitrate: rendition.bitrate,
      playlist: `${rendition.name}/index.m3u8`,
    }));
    video.hlsPreview = {
      status: 'ready',
      buildStatus: 'idle',
      folderPath: activeFolder,
      masterPlaylist: 'master.m3u8',
      renditions,
      segmentDuration: settings.segmentDuration,
      size: getFolderSize(activeFolder),
      createdAt: new Date(),
      version: HLS_PREVIEW_VERSION,
      profileVersion: settings.profileVersion,
      error: '',
      encoderRequested: settings.encoder,
      encoderUsed,
      encoderPreset: encoderUsed === 'h264_nvenc' ? settings.preset : 'veryfast',
      cpuFallbackUsed,
      fallbackReason,
      processingMs: Date.now() - startedAt,
      lastBuildError: '',
    };
    await video.save();
    cleanupInactiveBuilds(videoRoot, activeFolder, previousActiveFolder);
    const cleanupTimer = setTimeout(async () => {
      try {
        const currentVideo = await Video.findById(video._id).select('hlsPreview');
        if (!currentVideo || !hasReadyHlsPreview(currentVideo)) return;
        cleanupInactiveBuilds(videoRoot, getActiveHlsFolder(currentVideo));
      } catch (cleanupError) {
        console.warn(`Could not remove inactive HLS versions for ${video._id}:`, cleanupError.message);
      }
    }, HLS_PREVIOUS_VERSION_GRACE_MS);
    if (typeof cleanupTimer.unref === 'function') cleanupTimer.unref();
    return {
      status: 'ready',
      videoId: video._id,
      size: video.hlsPreview.size,
      encoderUsed,
      cpuFallbackUsed,
      processingMs: video.hlsPreview.processingMs,
    };
  } catch (error) {
    removeFolderIfExists(buildingFolder);
    video.hlsPreview = {
      ...previous,
      status: previousReady ? 'ready' : 'failed',
      buildStatus: 'failed',
      error: previousReady ? previous.error || '' : error.message,
      lastBuildError: error.message,
      lastBuildFailedAt: new Date(),
      encoderRequested: settings.encoder,
      encoderUsed,
      encoderPreset: encoderUsed === 'h264_nvenc' ? settings.preset : 'veryfast',
      cpuFallbackUsed,
      fallbackReason,
      processingMs: Date.now() - startedAt,
      version: previous.version || HLS_PREVIEW_VERSION,
      profileVersion: previousReady ? previous.profileVersion : settings.profileVersion,
    };
    await video.save();
    throw error;
  }
}

function hasReadyHlsPreview(video) {
  if (!video || video.hlsPreview?.status !== 'ready') return false;
  const folder = getActiveHlsFolder(video);
  return fs.existsSync(path.join(folder, 'master.m3u8'));
}

function resolveHlsResource(video, resourcePath) {
  if (!hasReadyHlsPreview(video)) return null;
  const folder = getActiveHlsFolder(video);
  const normalized = String(resourcePath || 'master.m3u8').replace(/\\/g, '/');
  const resolved = path.resolve(folder, normalized);
  if (!isPathInside(folder, resolved) || !fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    return null;
  }
  return resolved;
}

module.exports = {
  HLS_PREVIEW_VERSION,
  HLS_RENDITIONS,
  HLS_SEGMENT_DURATION,
  buildFfmpegArgs,
  buildHlsPreviewForVideo,
  getActiveHlsFolder,
  getFolderSize,
  getHlsProfile,
  getHlsPreviewFolder,
  hasReadyHlsPreview,
  isNvencRuntimeError,
  removeHlsPreviewFolder,
  resolveHlsResource,
  runFfmpeg,
  validateHlsBuild,
  writeMasterPlaylist,
};
