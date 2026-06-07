const path = require('path');
const fs = require('fs');

const STORAGE_ROOT = path.join(process.cwd(), 'storage');

const paths = {
  root: STORAGE_ROOT,
  raw: path.join(STORAGE_ROOT, 'raw'),
  compressed: path.join(STORAGE_ROOT, 'compressed'),
  previews: path.join(STORAGE_ROOT, 'previews'),
  thumbnails: path.join(STORAGE_ROOT, 'thumbnails'),
  temp: path.join(STORAGE_ROOT, 'temp'),
  final: path.join(STORAGE_ROOT, 'final'),
};

function ensureStorageFolders() {
  Object.values(paths).forEach((folderPath) => {
    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true });
    }
  });
}

function createStoredFilename(prefix, originalName) {
  const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `${prefix}_${Date.now()}_${safeName}`;
}

module.exports = {
  paths,
  ensureStorageFolders,
  createStoredFilename,
};