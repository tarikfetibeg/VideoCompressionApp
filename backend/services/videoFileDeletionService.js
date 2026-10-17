const fs = require('fs');
const path = require('path');
const Video = require('../models/Video');
const { paths, PROJECT_ROOT } = require('../utils/storagePaths');

const videoPathFields = ['filepath', 'rawPath', 'compressedPath', 'previewPath', 'thumbnailPath'];
const deleteRoots = [paths.raw, paths.compressed, paths.final, paths.previews, paths.thumbnails, path.join(PROJECT_ROOT, 'uploads')];
const normalize = (value) => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
const within = (root, candidate) => {
  const relative = path.relative(root, candidate);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
};

async function isPathReferencedByAnotherVideo(videoId, filePath) {
  const basename = path.basename(filePath).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const suffix = new RegExp(`(?:^|[\\\\/])${basename}$`, process.platform === 'win32' ? 'i' : '');
  const candidates = await Video.find({ _id: { $ne: videoId }, $or: videoPathFields.map((field) => ({ [field]: suffix })) })
    .select(videoPathFields.join(' ')).lean();
  return candidates.some((video) => videoPathFields.some((field) => video[field] && normalize(video[field]) === normalize(filePath)));
}

async function removeVideoFiles(video) {
  const deletedPaths = [];
  const skippedPaths = [];
  const candidates = [...new Set(videoPathFields.map((field) => video[field]).filter(Boolean).map((value) => path.resolve(value)))];
  for (const candidate of candidates) {
    let reason;
    const root = deleteRoots.find((folder) => within(folder, candidate));
    if (!root) reason = 'outside allowed video storage';
    else if (await isPathReferencedByAnotherVideo(video._id, candidate)) reason = 'referenced by another video record';
    else {
      try {
        const stat = await fs.promises.lstat(candidate);
        if (stat.isSymbolicLink() || !stat.isFile()) reason = 'not a regular file';
        else if (!within(await fs.promises.realpath(root), await fs.promises.realpath(candidate))) reason = 'resolved outside video storage';
        else { await fs.promises.unlink(candidate); deletedPaths.push(candidate); }
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        reason = 'file not found';
      }
    }
    if (reason) skippedPaths.push({ path: candidate, reason });
  }
  return { deletedPaths, skippedPaths };
}

module.exports = { removeVideoFiles, isPathReferencedByAnotherVideo };
