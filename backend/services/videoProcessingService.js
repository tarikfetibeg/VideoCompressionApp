const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const Video = require('../models/Video');
const AuditLog = require('../models/AuditLog');
const { ensureFolderExists } = require('../utils/storagePaths');

function removeFileIfExists(filePath) {
  if (filePath && fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
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
      const format = metadata.format || {};
      const width = videoStream.width;
      const height = videoStream.height;

      return resolve({
        duration: Number(format.duration) || null,
        codec: videoStream.codec_name || null,
        resolution: width && height ? `${width}x${height}` : null,
        bitrate: Number(format.bit_rate) ? Math.round(Number(format.bit_rate) / 1000) : null,
        framerate: parseFrameRate(videoStream.avg_frame_rate || videoStream.r_frame_rate),
      });
    });
  });
}

function convertVideo({
  inputPath,
  outputPath,
  codec,
  resolution,
  bitrateKbps,
  frameRate,
}) {
  return new Promise((resolve, reject) => {
    ensureFolderExists(path.dirname(outputPath));

    ffmpeg(inputPath)
      .videoCodec(codec)
      .audioCodec('aac')
      .size(resolution)
      .videoBitrate(bitrateKbps)
      .audioBitrate('128k')
      .fps(frameRate)
      .outputOptions([
        '-pix_fmt yuv420p',
        '-movflags +faststart',
      ])
      .on('end', resolve)
      .on('error', reject)
      .save(outputPath);
  });
}

function convertPreviewVideo({ inputPath, outputPath }) {
  return new Promise((resolve, reject) => {
    ensureFolderExists(path.dirname(outputPath));

    ffmpeg(inputPath)
      .videoCodec('libx264')
      .audioCodec('aac')
      .size('1280x720')
      .videoBitrate(2000)
      .audioBitrate('128k')
      .fps(30)
      .outputOptions([
        '-pix_fmt yuv420p',
        '-movflags +faststart',
        '-preset veryfast',
      ])
      .on('end', resolve)
      .on('error', reject)
      .save(outputPath);
  });
}

function createThumbnail({ inputPath, outputPath }) {
  return new Promise((resolve, reject) => {
    ensureFolderExists(path.dirname(outputPath));

    ffmpeg(inputPath)
      .seekInput('00:00:01')
      .frames(1)
      .size('640x360')
      .outputOptions(['-q:v 3'])
      .on('end', resolve)
      .on('error', reject)
      .save(outputPath);
  });
}

async function updateProgress(video, job, processingProgress) {
  video.processingProgress = processingProgress;
  await video.save();

  if (job && typeof job.progress === 'function') {
    await job.progress(processingProgress);
  }
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

    video.processingStatus = 'processing';
    video.processingError = null;
    video.processingStartedAt = new Date();
    video.processingCompletedAt = null;
    await updateProgress(video, job, 5);

    if (video.processingMode === 'finalize') {
      await convertPreviewVideo({
        inputPath,
        outputPath: video.previewPath,
      });
      await updateProgress(video, job, 45);

      await createThumbnail({
        inputPath,
        outputPath: video.thumbnailPath,
      });
      await updateProgress(video, job, 70);

      ensureFolderExists(path.dirname(video.compressedPath));
      fs.renameSync(inputPath, video.compressedPath);

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
      });
      await updateProgress(video, job, 45);

      await convertPreviewVideo({
        inputPath,
        outputPath: video.previewPath,
      });
      await updateProgress(video, job, 70);

      await createThumbnail({
        inputPath,
        outputPath: video.thumbnailPath,
      });
      await updateProgress(video, job, 90);

      if (!video.rawRetentionDays || video.rawRetentionDays <= 0) {
        removeFileIfExists(inputPath);
        video.rawPath = null;
        video.rawDeleted = true;
        video.rawDeletedAt = new Date();
      }
    }

    const mediaProbe = await probeMedia(video.compressedPath || video.filepath);

    video.filepath = video.compressedPath || video.filepath;
    video.sizeCompressed = getFileSize(video.compressedPath);
    video.sizePreview = getFileSize(video.previewPath);
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
    video.broadcastStatus = video.qcStatus === 'passed' ? 'ready_for_approval' : 'qc_pending';

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
  processVideoJob,
};
