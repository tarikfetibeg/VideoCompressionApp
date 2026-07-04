const mongoose = require('mongoose');

const FfmpegSettingsSchema = new mongoose.Schema({
  codec: {
    type: String,
    enum: ['libx264', 'libx265', 'h264_nvenc', 'hevc_nvenc'],
    default: 'libx264',
  },
  resolution: {
    type: String,
    enum: ['1280x720', '1920x1080', '2560x1440', '3840x2160'],
    default: '1920x1080',
  },
  bitrate: { type: Number, default: 1500 }, // in Kbps
  framerate: { type: Number, default: 30 },

  // 0 = raw file is deleted immediately after successful processing.
  // 1-365 = raw file is kept for the defined number of days.
  rawRetentionDays: {
    type: Number,
    default: 0,
    min: 0,
    max: 365,
  },
  hlsEncoder: {
    type: String,
    enum: ['libx264', 'h264_nvenc'],
    default: 'libx264',
  },
  hlsNvencPreset: {
    type: String,
    enum: ['p2', 'p3', 'p4', 'p5', 'p6'],
    default: 'p5',
  },
  hlsCpuFallback: { type: Boolean, default: true },
  hls720VideoBitrate: { type: Number, default: 2200, min: 1000, max: 6000 },
  hls720AudioBitrate: { type: Number, enum: [64, 96, 128, 160, 192], default: 128 },
  hls480VideoBitrate: { type: Number, default: 900, min: 400, max: 3000 },
  hls480AudioBitrate: { type: Number, enum: [64, 96, 128, 160, 192], default: 96 },
  hlsSegmentDuration: { type: Number, enum: [2, 4, 6], default: 4 },
  hlsProfileVersion: { type: Number, default: 1, min: 1 },
  mp4PreviewPolicy: {
    type: String,
    enum: ['always', 'when_required'],
    default: 'when_required',
  },
  mp4PreviewEncoder: {
    type: String,
    enum: ['libx264', 'h264_nvenc'],
    default: 'libx264',
  },
  mp4PreviewResolution: {
    type: String,
    enum: ['1920x1080', '1280x720', '854x480'],
    default: '1280x720',
  },
  mp4PreviewVideoBitrate: { type: Number, default: 2000, min: 500, max: 8000 },
  mp4PreviewAudioBitrate: { type: Number, enum: [64, 96, 128, 160, 192], default: 128 },
  mp4PreviewFramerateMode: {
    type: String,
    enum: ['source_capped_50', 'fixed'],
    default: 'fixed',
  },
  mp4PreviewFramerate: { type: Number, enum: [25, 30, 50], default: 30 },
  mp4PreviewCpuPreset: {
    type: String,
    enum: ['veryfast', 'faster', 'medium'],
    default: 'veryfast',
  },
  mp4PreviewNvencPreset: {
    type: String,
    enum: ['p4', 'p5', 'p6'],
    default: 'p5',
  },
  mp4PreviewCpuFallback: { type: Boolean, default: true },
  mp4PreviewProfileVersion: { type: Number, default: 1, min: 1 },
  thumbnailResolution: {
    type: String,
    enum: ['640x360', '480x270', '320x180'],
    default: '640x360',
  },
  thumbnailJpegQuality: { type: Number, min: 2, max: 8, default: 3 },
  thumbnailProfileVersion: { type: Number, default: 1, min: 1 },
  scrubFrameCount: { type: Number, min: 6, max: 24, default: 12 },
  scrubResolution: {
    type: String,
    enum: ['320x180', '240x135', '160x90'],
    default: '320x180',
  },
  scrubJpegQuality: { type: Number, min: 2, max: 8, default: 3 },
  scrubProfileVersion: { type: Number, default: 1, min: 1 },
  masterProfileVersion: { type: Number, default: 1, min: 1 },
  nvencProbe: {
    ok: { type: Boolean, default: false },
    checkedAt: { type: Date },
    ffmpegVersion: { type: String },
    gpuName: { type: String },
    driverVersion: { type: String },
    error: { type: String },
  },
});

module.exports = mongoose.model('FfmpegSettings', FfmpegSettingsSchema);
