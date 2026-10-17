const path = require('path');
const EditJob = require('../models/EditJob');
const { paths } = require('../utils/storagePaths');
const { normalizeStoragePath, inspectStorageFile, unlinkStorageFile } = require('../utils/storageFileSafety');
const { isPathReferencedByAnotherVideo } = require('./videoFileDeletionService');

async function removeOffFile(jobId, filePath, { offFileId, wholeJob = false } = {}) {
  if (!filePath) return { safe: true, deleted: false, reason: 'no storage path' };
  const check = await inspectStorageFile(filePath, [paths.offAudio]);
  if (!check.safe || !check.exists) return { ...check, deleted: false };
  const basename = path.basename(filePath).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const suffix = new RegExp(`(?:^|[\\\\/])${basename}$`, process.platform === 'win32' ? 'i' : '');
  const candidates = await EditJob.find({ ...(wholeJob ? { _id: { $ne: jobId } } : {}), $or: [{ 'offFiles.storagePath': suffix }, { 'offFiles.path': suffix }] }).select('offFiles').lean();
  const shared = candidates.some((job) => job.offFiles.some((file) => {
    if (String(job._id) === String(jobId) && offFileId && String(file._id) === String(offFileId)) return false;
    const value = file.storagePath || file.path;
    return value && normalizeStoragePath(value) === normalizeStoragePath(filePath);
  }));
  if (shared) return { safe: true, deleted: false, reason: 'referenced by another job' };
  if (await isPathReferencedByAnotherVideo(null, filePath)) return { safe: true, deleted: false, reason: 'referenced by a video' };
  return unlinkStorageFile(filePath, [paths.offAudio]);
}

module.exports = { removeOffFile };
