const fs = require('fs');
const path = require('path');
const Video = require('../models/Video');
const { hasReadyHlsPreview } = require('./hlsPreviewService');
const {
  getAlternativePlaybackPath,
  inspectBrowserCompatibility,
} = require('./mediaCompatibilityService');
const { paths } = require('../utils/storagePaths');
const { getMediaSettings } = require('./mediaProfileService');

function isPathInside(rootPath, targetPath) {
  if (!targetPath) return false;
  const root = path.resolve(rootPath);
  const target = path.resolve(targetPath);
  return target === root || target.startsWith(`${root}${path.sep}`);
}

function parseLimit(value, fallback = 50) {
  return Math.min(Math.max(parseInt(value, 10) || fallback, 1), 500);
}

async function assessPreviewRetentionCandidate(video) {
  const previewPath = video?.previewPath ? path.resolve(video.previewPath) : null;
  const size = previewPath && fs.existsSync(previewPath)
    ? fs.statSync(previewPath).size
    : Number(video?.sizePreview || 0);

  if (!previewPath || !fs.existsSync(previewPath)) {
    return { eligible: false, reason: 'preview_missing', size: 0 };
  }
  if (!isPathInside(paths.previews, previewPath)) {
    return { eligible: false, reason: 'preview_outside_storage', size };
  }
  if (!hasReadyHlsPreview(video)) {
    return { eligible: false, reason: 'hls_not_ready', size };
  }

  const sharedCount = await Video.countDocuments({
    _id: { $ne: video._id },
    previewPath: video.previewPath,
  });
  if (sharedCount > 0) {
    return { eligible: false, reason: 'preview_path_shared', size, sharedCount };
  }

  const alternativePath = getAlternativePlaybackPath(video);
  const compatibility = await inspectBrowserCompatibility(alternativePath);
  if (!compatibility.compatible) {
    return {
      eligible: false,
      reason: compatibility.reason || 'alternative_not_browser_compatible',
      size,
      compatibility,
    };
  }

  return {
    eligible: true,
    reason: 'safe_to_remove',
    size,
    previewPath,
    alternativePath,
    compatibility,
  };
}

async function scanPreviewRetention({ limit = 50, videoIds = [] } = {}) {
  const parsedLimit = parseLimit(limit);
  const requestedIds = Array.isArray(videoIds) ? videoIds.filter(Boolean).slice(0, parsedLimit) : [];
  const query = requestedIds.length > 0
    ? { _id: { $in: requestedIds } }
    : {
      processingStatus: 'completed',
      previewPath: { $exists: true, $nin: [null, ''] },
      'hlsPreview.status': 'ready',
    };
  const videos = await Video.find(query)
    .select('filename originalFilename finalTitle previewPath compressedPath filepath sizePreview processingStatus hlsPreview')
    .sort({ uploadDate: 1 })
    .limit(parsedLimit);
  const items = [];

  for (const video of videos) {
    const assessment = await assessPreviewRetentionCandidate(video);
    items.push({
      videoId: video._id,
      title: video.finalTitle || video.originalFilename || video.filename || 'Video',
      ...assessment,
      previewPath: undefined,
      alternativePath: undefined,
      compatibility: assessment.compatibility
        ? {
          compatible: assessment.compatibility.compatible,
          reason: assessment.compatibility.reason,
          container: assessment.compatibility.probe?.container || '',
          videoCodec: assessment.compatibility.probe?.videoCodec || '',
          pixelFormat: assessment.compatibility.probe?.pixelFormat || '',
          audioCodec: assessment.compatibility.probe?.audioCodec || '',
        }
        : undefined,
    });
  }

  const eligible = items.filter((item) => item.eligible);
  return {
    scanned: items.length,
    eligibleCount: eligible.length,
    ineligibleCount: items.length - eligible.length,
    reclaimableBytes: eligible.reduce((total, item) => total + Number(item.size || 0), 0),
    items,
  };
}

async function cleanupEligiblePreviews(options = {}) {
  const scan = await scanPreviewRetention(options);
  const settings = await getMediaSettings();
  const deleted = [];
  const skipped = [];

  for (const item of scan.items) {
    if (!item.eligible) {
      skipped.push({ videoId: item.videoId, reason: item.reason });
      continue;
    }

    const video = await Video.findById(item.videoId);
    if (!video) {
      skipped.push({ videoId: item.videoId, reason: 'video_missing' });
      continue;
    }
    const assessment = await assessPreviewRetentionCandidate(video);
    if (!assessment.eligible) {
      skipped.push({ videoId: video._id, reason: assessment.reason });
      continue;
    }

    await fs.promises.unlink(assessment.previewPath);
    video.previewPath = null;
    video.sizePreview = 0;
    video.playbackCompatibility = {
      compatible: true,
      checkedAt: new Date(),
      pathType: video.compressedPath ? 'compressed' : 'filepath',
      container: assessment.compatibility.probe?.container || '',
      videoCodec: assessment.compatibility.probe?.videoCodec || '',
      pixelFormat: assessment.compatibility.probe?.pixelFormat || '',
      audioCodec: assessment.compatibility.probe?.audioCodec || '',
      reason: 'preview_removed_alternative_verified',
    };
    video.mp4Preview = {
      profileVersion: settings.mp4PreviewProfileVersion,
      encoderRequested: settings.mp4PreviewEncoder,
      encoderUsed: 'source',
      width: assessment.compatibility.probe?.width || null,
      height: assessment.compatibility.probe?.height || null,
      videoBitrate: video.bitrate || null,
      audioBitrate: null,
      framerate: video.framerate || null,
      size: assessment.alternativePath && fs.existsSync(assessment.alternativePath)
        ? fs.statSync(assessment.alternativePath).size
        : 0,
      processingMs: 0,
      createdAt: new Date(),
      error: '',
    };
    await video.save();
    deleted.push({ videoId: video._id, bytes: assessment.size });
  }

  return {
    scanned: scan.scanned,
    deleted,
    skipped,
    reclaimedBytes: deleted.reduce((total, item) => total + Number(item.bytes || 0), 0),
  };
}

module.exports = {
  assessPreviewRetentionCandidate,
  cleanupEligiblePreviews,
  parseLimit,
  scanPreviewRetention,
};
