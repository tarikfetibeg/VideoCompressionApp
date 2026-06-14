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

function convertPreviewVideo({ inputPath, outputPath, onProgress }) {
  return new Promise((resolve, reject) => {
    ensureFolderExists(path.dirname(outputPath));

    ffmpeg(inputPath)
      .inputOptions(['-fflags +genpts'])
      .videoCodec('libx264')
      .audioCodec('aac')
      .size('1280x720')
      .videoBitrate(2000)
      .audioBitrate('128k')
      .fps(30)
      .outputOptions([
        '-map 0:v:0',
        '-map 0:a?',
        '-dn',
        '-sn',
        '-pix_fmt yuv420p',
        '-movflags +faststart',
        '-max_muxing_queue_size 2048',
        '-preset veryfast',
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

function createThumbnail({ inputPath, outputPath }) {
  return new Promise((resolve, reject) => {
    ensureFolderExists(path.dirname(outputPath));

    ffmpeg(inputPath)
      .inputOptions(['-fflags +genpts'])
      .seekInput('00:00:01')
      .frames(1)
      .size('640x360')
      .outputOptions([
        '-map 0:v:0',
        '-q:v 3',
      ])
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
    await reportProgress(5, { force: true });

    if (video.processingMode === 'finalize') {
      await convertPreviewVideo({
        inputPath,
        outputPath: video.previewPath,
        onProgress: (percent) => reportProgress(mapPhaseProgress(percent, 5, 45)),
      });
      await reportProgress(45, { force: true });

      await createThumbnail({
        inputPath,
        outputPath: video.thumbnailPath,
      });
      await reportProgress(70, { force: true });

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

      await convertPreviewVideo({
        inputPath,
        outputPath: video.previewPath,
        onProgress: (percent) => reportProgress(mapPhaseProgress(percent, 45, 70)),
      });
      await reportProgress(70, { force: true });

      await createThumbnail({
        inputPath,
        outputPath: video.thumbnailPath,
      });
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
  probeMedia,
  processVideoJob,
};
