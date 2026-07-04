const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');

const BROWSER_VIDEO_CODECS = new Set(['h264']);
const BROWSER_AUDIO_CODECS = new Set(['aac', 'mp3']);
const BROWSER_PIXEL_FORMATS = new Set(['yuv420p', 'yuvj420p']);

function resolveExistingPath(...candidates) {
  for (const candidate of candidates) {
    if (!candidate) continue;
    const resolved = path.resolve(candidate);
    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) return resolved;
  }
  return null;
}

function getAlternativePlaybackPath(video) {
  return resolveExistingPath(video?.compressedPath, video?.filepath);
}

function probeFile(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (error, metadata) => {
      if (error) return reject(error);
      const streams = metadata?.streams || [];
      const videoStream = streams.find((stream) => stream.codec_type === 'video') || {};
      const audioStream = streams.find((stream) => stream.codec_type === 'audio') || null;
      resolve({
        container: String(metadata?.format?.format_name || '').toLowerCase(),
        videoCodec: String(videoStream.codec_name || '').toLowerCase(),
        pixelFormat: String(videoStream.pix_fmt || '').toLowerCase(),
        profile: String(videoStream.profile || ''),
        audioCodec: audioStream ? String(audioStream.codec_name || '').toLowerCase() : '',
        hasAudio: Boolean(audioStream),
        width: Number(videoStream.width) || null,
        height: Number(videoStream.height) || null,
        duration: Number(metadata?.format?.duration) || null,
        frameRate: String(videoStream.avg_frame_rate || videoStream.r_frame_rate || ''),
      });
    });
  });
}

function evaluateBrowserCompatibility(filePath, probe) {
  const extension = path.extname(filePath || '').toLowerCase();
  if (extension !== '.mp4') {
    return { compatible: false, reason: 'container_extension_not_mp4' };
  }
  if (!probe.container.split(',').some((value) => value.trim() === 'mp4')) {
    return { compatible: false, reason: 'container_not_mp4' };
  }
  if (!BROWSER_VIDEO_CODECS.has(probe.videoCodec)) {
    return { compatible: false, reason: 'video_codec_not_h264' };
  }
  if (!BROWSER_PIXEL_FORMATS.has(probe.pixelFormat)) {
    return { compatible: false, reason: 'pixel_format_not_8bit_420' };
  }
  if (probe.hasAudio && !BROWSER_AUDIO_CODECS.has(probe.audioCodec)) {
    return { compatible: false, reason: 'audio_codec_not_supported' };
  }
  return { compatible: true, reason: 'browser_compatible_h264_mp4' };
}

async function inspectBrowserCompatibility(filePath) {
  const resolvedPath = resolveExistingPath(filePath);
  if (!resolvedPath) {
    return {
      compatible: false,
      reason: 'file_missing',
      filePath: null,
      probe: {},
    };
  }

  try {
    const probe = await probeFile(resolvedPath);
    return {
      ...evaluateBrowserCompatibility(resolvedPath, probe),
      filePath: resolvedPath,
      probe,
    };
  } catch (error) {
    return {
      compatible: false,
      reason: 'ffprobe_failed',
      filePath: resolvedPath,
      probe: {},
      error: error.message,
    };
  }
}

function toPlaybackCompatibility(result, pathType = 'none') {
  return {
    compatible: result?.compatible === true,
    checkedAt: new Date(),
    pathType,
    container: result?.probe?.container || '',
    videoCodec: result?.probe?.videoCodec || '',
    pixelFormat: result?.probe?.pixelFormat || '',
    audioCodec: result?.probe?.audioCodec || '',
    reason: result?.reason || 'not_checked',
  };
}

module.exports = {
  evaluateBrowserCompatibility,
  getAlternativePlaybackPath,
  inspectBrowserCompatibility,
  probeFile,
  resolveExistingPath,
  toPlaybackCompatibility,
};
