const DEFAULT_ARCHIVE_CLAIM_MINUTES = 120;

function getClaimMinutes() {
  const configured = Number(process.env.ARCHIVE_CLAIM_MINUTES);
  if (!Number.isFinite(configured)) return DEFAULT_ARCHIVE_CLAIM_MINUTES;
  return Math.min(Math.max(Math.round(configured), 15), 480);
}

function getClaimExpiry(now = new Date()) {
  return new Date(now.getTime() + getClaimMinutes() * 60 * 1000);
}

function getId(value) {
  return value?._id || value || null;
}

function isClaimActive(video, now = new Date()) {
  if (!getId(video?.archiveAssignedTo) || !video?.archiveAssignmentExpiresAt) return false;
  return new Date(video.archiveAssignmentExpiresAt).getTime() > now.getTime();
}

function isClaimOwner(video, user, now = new Date()) {
  return isClaimActive(video, now)
    && String(getId(video.archiveAssignedTo)) === String(getId(user?.id || user?._id));
}

function assertArchiveClaim(video, user, now = new Date()) {
  if (user?.role === 'Admin') return;
  if (isClaimOwner(video, user, now)) return;

  const error = new Error(
    isClaimActive(video, now)
      ? 'Materijal je trenutno preuzeo drugi arhivista.'
      : 'Prije izmjene preuzmite materijal u svoj radni red.'
  );
  error.statusCode = 409;
  error.code = 'ARCHIVE_CLAIM_REQUIRED';
  throw error;
}

function extendArchiveClaim(video, user, now = new Date()) {
  if (user?.role === 'Admin') return;
  video.archiveAssignedTo = getId(user?.id || user?._id);
  if (!video.archiveAssignedAt) video.archiveAssignedAt = now;
  video.archiveAssignmentExpiresAt = getClaimExpiry(now);
}

function clearArchiveClaim(video) {
  video.archiveAssignedTo = null;
  video.archiveAssignedAt = null;
  video.archiveAssignmentExpiresAt = null;
}

function buildArchiveAssignmentCondition(assignment, userId, now = new Date()) {
  if (assignment === 'mine') {
    return {
      archiveAssignedTo: userId,
      archiveAssignmentExpiresAt: { $gt: now },
    };
  }
  if (assignment === 'unassigned') {
    return {
      $or: [
        { archiveAssignedTo: { $exists: false } },
        { archiveAssignedTo: null },
        { archiveAssignmentExpiresAt: { $exists: false } },
        { archiveAssignmentExpiresAt: null },
        { archiveAssignmentExpiresAt: { $lte: now } },
      ],
    };
  }
  return null;
}

function getArchiveReviewWarnings(video) {
  const warnings = [];
  if (!String(video?.finalTitle || '').trim()) warnings.push({ code: 'missing_title', label: 'Nedostaje naslov' });
  if (!video?.tagDate) warnings.push({ code: 'missing_date', label: 'Nedostaje datum' });
  if (!getId(video?.contentType) && !String(video?.finalCategory || '').trim()) {
    warnings.push({ code: 'missing_category', label: 'Nedostaje kategorija' });
  }
  if (!String(video?.event || '').trim()) warnings.push({ code: 'missing_event', label: 'Nedostaje event' });
  if (!getId(video?.reporter) && !getId(video?.uploader)) {
    warnings.push({ code: 'missing_author', label: 'Nedostaje autor' });
  }
  if (!Array.isArray(video?.keywords) || video.keywords.length === 0) {
    warnings.push({ code: 'missing_tags', label: 'Nedostaju tagovi' });
  }
  if (video?.correctionStatus === 'needs_correction' || getId(video?.activeCorrectionRequest)) {
    warnings.push({ code: 'open_correction', label: 'Postoji otvorena ispravka' });
  }
  return warnings;
}

module.exports = {
  DEFAULT_ARCHIVE_CLAIM_MINUTES,
  assertArchiveClaim,
  buildArchiveAssignmentCondition,
  clearArchiveClaim,
  extendArchiveClaim,
  getArchiveReviewWarnings,
  getClaimExpiry,
  getClaimMinutes,
  isClaimActive,
  isClaimOwner,
};
