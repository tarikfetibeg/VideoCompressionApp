const fs = require('fs');
const path = require('path');

const normalizeStoragePath = (value) => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
const inside = (root, candidate) => {
  const relative = path.relative(root, candidate);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
};

async function inspectStorageFile(filePath, roots) {
  const candidate = path.resolve(filePath);
  const root = roots.find((folder) => inside(path.resolve(folder), candidate));
  if (!root) return { safe: false, exists: false, path: candidate, reason: 'outside allowed storage' };
  let canonicalRoot;
  try { canonicalRoot = await fs.promises.realpath(root); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return { safe: false, exists: false, path: candidate, reason: 'storage root unavailable' };
  }
  try {
    const stat = await fs.promises.lstat(candidate);
    if (!stat.isFile() || stat.isSymbolicLink()) return { safe: false, exists: true, path: candidate, reason: 'not a regular file' };
    const canonical = await fs.promises.realpath(candidate);
    if (!inside(canonicalRoot, canonical)) return { safe: false, exists: true, path: candidate, reason: 'resolved outside allowed storage' };
    return { safe: true, exists: true, path: candidate, canonical };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    let parent = path.dirname(candidate);
    while (inside(path.resolve(root), parent) || normalizeStoragePath(parent) === normalizeStoragePath(root)) {
      try {
        const actualParent = await fs.promises.realpath(parent);
        if (!inside(canonicalRoot, actualParent) && normalizeStoragePath(actualParent) !== normalizeStoragePath(canonicalRoot)) {
          return { safe: false, exists: false, path: candidate, reason: 'resolved outside allowed storage' };
        }
        break;
      } catch (parentError) {
        if (parentError.code !== 'ENOENT') throw parentError;
        parent = path.dirname(parent);
      }
    }
    return { safe: true, exists: false, path: candidate, reason: 'file not found' };
  }
}

async function unlinkStorageFile(filePath, roots) {
  const check = await inspectStorageFile(filePath, roots);
  if (!check.safe || !check.exists) return { ...check, deleted: false };
  await fs.promises.unlink(check.path);
  return { ...check, deleted: true };
}

module.exports = { normalizeStoragePath, inspectStorageFile, unlinkStorageFile };
