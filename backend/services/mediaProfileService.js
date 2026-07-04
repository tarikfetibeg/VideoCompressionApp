const FfmpegSettings = require('../models/FfmpegSettings');

const DEFAULT_MEDIA_SETTINGS = {
  codec: 'libx264',
  resolution: '1920x1080',
  bitrate: 1500,
  framerate: 30,
  rawRetentionDays: 0,
  masterProfileVersion: 1,
  mp4PreviewPolicy: 'when_required',
  mp4PreviewEncoder: 'libx264',
  mp4PreviewResolution: '1280x720',
  mp4PreviewVideoBitrate: 2000,
  mp4PreviewAudioBitrate: 128,
  mp4PreviewFramerateMode: 'fixed',
  mp4PreviewFramerate: 30,
  mp4PreviewCpuPreset: 'veryfast',
  mp4PreviewNvencPreset: 'p5',
  mp4PreviewCpuFallback: true,
  mp4PreviewProfileVersion: 1,
  hlsEncoder: 'libx264',
  hlsNvencPreset: 'p5',
  hlsCpuFallback: true,
  hls720VideoBitrate: 2200,
  hls720AudioBitrate: 128,
  hls480VideoBitrate: 900,
  hls480AudioBitrate: 96,
  hlsSegmentDuration: 4,
  hlsProfileVersion: 1,
  thumbnailResolution: '640x360',
  thumbnailJpegQuality: 3,
  thumbnailProfileVersion: 1,
  scrubFrameCount: 12,
  scrubResolution: '320x180',
  scrubJpegQuality: 3,
  scrubProfileVersion: 1,
};

const profileGroups = {
  master: {
    fields: ['codec', 'resolution', 'bitrate', 'framerate'],
    versionField: 'masterProfileVersion',
  },
  mp4Preview: {
    fields: [
      'mp4PreviewPolicy',
      'mp4PreviewEncoder',
      'mp4PreviewResolution',
      'mp4PreviewVideoBitrate',
      'mp4PreviewAudioBitrate',
      'mp4PreviewFramerateMode',
      'mp4PreviewFramerate',
      'mp4PreviewCpuPreset',
      'mp4PreviewNvencPreset',
      'mp4PreviewCpuFallback',
    ],
    versionField: 'mp4PreviewProfileVersion',
  },
  hls: {
    fields: [
      'hlsEncoder',
      'hlsNvencPreset',
      'hlsCpuFallback',
      'hls720VideoBitrate',
      'hls720AudioBitrate',
      'hls480VideoBitrate',
      'hls480AudioBitrate',
      'hlsSegmentDuration',
    ],
    versionField: 'hlsProfileVersion',
  },
  thumbnail: {
    fields: ['thumbnailResolution', 'thumbnailJpegQuality'],
    versionField: 'thumbnailProfileVersion',
  },
  scrub: {
    fields: ['scrubFrameCount', 'scrubResolution', 'scrubJpegQuality'],
    versionField: 'scrubProfileVersion',
  },
};

const allowedFields = new Set([
  'codec',
  'resolution',
  'bitrate',
  'framerate',
  'rawRetentionDays',
  ...Object.values(profileGroups).flatMap((group) => group.fields),
]);

function validationError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function validateEnum(normalized, field, values) {
  if (Object.prototype.hasOwnProperty.call(normalized, field) && !values.includes(normalized[field])) {
    throw validationError(`Nepodržana vrijednost za ${field}.`);
  }
}

function validateNumber(normalized, field, { min, max, integer = false, values = null }) {
  if (!Object.prototype.hasOwnProperty.call(normalized, field)) return;
  const value = Number(normalized[field]);
  if (
    !Number.isFinite(value)
    || (integer && !Number.isInteger(value))
    || value < min
    || value > max
    || (values && !values.includes(value))
  ) {
    throw validationError(`Neispravna vrijednost za ${field}.`);
  }
  normalized[field] = value;
}

function normalizeMediaSettingsUpdate(update) {
  const normalized = {};
  Object.entries(update || {}).forEach(([field, value]) => {
    if (allowedFields.has(field)) normalized[field] = value;
  });

  validateEnum(normalized, 'hlsEncoder', ['libx264', 'h264_nvenc']);
  validateEnum(normalized, 'codec', ['libx264', 'libx265', 'h264_nvenc', 'hevc_nvenc']);
  validateEnum(normalized, 'resolution', ['1280x720', '1920x1080', '2560x1440', '3840x2160']);
  validateEnum(normalized, 'hlsNvencPreset', ['p2', 'p3', 'p4', 'p5', 'p6']);
  validateEnum(normalized, 'mp4PreviewPolicy', ['always', 'when_required']);
  validateEnum(normalized, 'mp4PreviewEncoder', ['libx264', 'h264_nvenc']);
  validateEnum(normalized, 'mp4PreviewResolution', ['1920x1080', '1280x720', '854x480']);
  validateEnum(normalized, 'mp4PreviewFramerateMode', ['source_capped_50', 'fixed']);
  validateEnum(normalized, 'mp4PreviewCpuPreset', ['veryfast', 'faster', 'medium']);
  validateEnum(normalized, 'mp4PreviewNvencPreset', ['p4', 'p5', 'p6']);
  validateEnum(normalized, 'thumbnailResolution', ['640x360', '480x270', '320x180']);
  validateEnum(normalized, 'scrubResolution', ['320x180', '240x135', '160x90']);

  [
    'hlsCpuFallback',
    'mp4PreviewCpuFallback',
  ].forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(normalized, field)) {
      normalized[field] = normalized[field] !== false;
    }
  });

  validateNumber(normalized, 'rawRetentionDays', { min: 0, max: 365, integer: true });
  validateNumber(normalized, 'bitrate', { min: 1, max: 100000 });
  validateNumber(normalized, 'framerate', { min: 1, max: 120 });
  validateNumber(normalized, 'mp4PreviewVideoBitrate', { min: 500, max: 8000, integer: true });
  validateNumber(normalized, 'mp4PreviewAudioBitrate', {
    min: 64,
    max: 192,
    integer: true,
    values: [64, 96, 128, 160, 192],
  });
  validateNumber(normalized, 'mp4PreviewFramerate', {
    min: 25,
    max: 50,
    integer: true,
    values: [25, 30, 50],
  });
  validateNumber(normalized, 'hls720VideoBitrate', { min: 1000, max: 6000, integer: true });
  validateNumber(normalized, 'hls480VideoBitrate', { min: 400, max: 3000, integer: true });
  ['hls720AudioBitrate', 'hls480AudioBitrate'].forEach((field) => {
    validateNumber(normalized, field, {
      min: 64,
      max: 192,
      integer: true,
      values: [64, 96, 128, 160, 192],
    });
  });
  validateNumber(normalized, 'hlsSegmentDuration', {
    min: 2,
    max: 6,
    integer: true,
    values: [2, 4, 6],
  });
  validateNumber(normalized, 'thumbnailJpegQuality', { min: 2, max: 8, integer: true });
  validateNumber(normalized, 'scrubFrameCount', { min: 6, max: 24, integer: true });
  validateNumber(normalized, 'scrubJpegQuality', { min: 2, max: 8, integer: true });

  return normalized;
}

function toComparable(value) {
  if (value === undefined || value === null) return '';
  return String(value);
}

function applyProfileVersions(currentSettings, normalizedUpdate) {
  const current = getEffectiveMediaSettings(currentSettings);
  const update = { ...normalizedUpdate };
  const changedGroups = [];

  Object.entries(profileGroups).forEach(([groupName, group]) => {
    const changed = group.fields.some((field) => (
      Object.prototype.hasOwnProperty.call(update, field)
      && toComparable(update[field]) !== toComparable(current[field])
    ));
    if (changed) {
      update[group.versionField] = Number(current[group.versionField] || 1) + 1;
      changedGroups.push(groupName);
    }
  });

  return { update, changedGroups };
}

function getEffectiveMediaSettings(settings) {
  const plain = settings?.toObject ? settings.toObject() : (settings || {});
  return { ...DEFAULT_MEDIA_SETTINGS, ...plain };
}

async function getMediaSettings() {
  let settings = await FfmpegSettings.findOne({});
  if (!settings) settings = await FfmpegSettings.create({});
  return getEffectiveMediaSettings(settings);
}

function parseResolution(value, fallback = '1280x720') {
  const [width, height] = String(value || fallback).split('x').map(Number);
  return {
    width: Number.isFinite(width) && width > 0 ? width : Number(fallback.split('x')[0]),
    height: Number.isFinite(height) && height > 0 ? height : Number(fallback.split('x')[1]),
  };
}

module.exports = {
  DEFAULT_MEDIA_SETTINGS,
  applyProfileVersions,
  getEffectiveMediaSettings,
  getMediaSettings,
  normalizeMediaSettingsUpdate,
  parseResolution,
  profileGroups,
};
