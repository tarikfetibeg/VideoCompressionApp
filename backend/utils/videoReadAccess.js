const { buildApprovedArchiveEligibilityCondition } = require('./archiveEligibility');

const previewRoles = ['Reporter', 'Editor', 'VideoEditor', 'Producer', 'Realizator', 'Archivist', 'Admin'];
const idOf = (value) => String(value?._id || value || '');

function isApprovedArchiveVideo(video) {
  return video?.status === 'edited'
    && video.processingStatus === 'completed'
    && ['approved_for_air', 'aired', 'archived'].includes(video.broadcastStatus)
    && (video.finalApprovalStatus === 'approved' || video.qcStatus === 'passed' || ['aired', 'archived'].includes(video.broadcastStatus));
}

function canReadVideo(user, video, roles = previewRoles) {
  if (!user || !video || !roles.includes(user.role)) return false;
  if (user.role !== 'Reporter') return true;
  const userId = idOf(user.id || user._id);
  return Boolean(userId) && (idOf(video.uploader) === userId || idOf(video.reporter) === userId || isApprovedArchiveVideo(video));
}

function applyReporterVideoScope(filter, user, scope) {
  if (user?.role !== 'Reporter') return filter;
  const own = [{ uploader: user.id }, { reporter: user.id }];
  const condition = { $or: scope === 'station' ? [...own, buildApprovedArchiveEligibilityCondition()] : own };
  filter.$and = [...(filter.$and || []), condition];
  return filter;
}

module.exports = { canReadVideo, applyReporterVideoScope, isApprovedArchiveVideo };
