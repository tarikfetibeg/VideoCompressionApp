const path = require('path');
const fs = require('fs');

// Always resolve storage relative to project root.
// This file is in backend/utils, so ../.. points to project root.
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const STORAGE_ROOT = path.join(PROJECT_ROOT, 'storage');

const paths = {
  root: STORAGE_ROOT,
  raw: path.join(STORAGE_ROOT, 'raw'),
  rawManifests: path.join(STORAGE_ROOT, 'raw-manifests'),
  offAudio: path.join(STORAGE_ROOT, 'off-audio'),
  compressed: path.join(STORAGE_ROOT, 'compressed'),
  previews: path.join(STORAGE_ROOT, 'previews'),
  thumbnails: path.join(STORAGE_ROOT, 'thumbnails'),
  temp: path.join(STORAGE_ROOT, 'temp'),
  final: path.join(STORAGE_ROOT, 'final'),
};

function ensureFolderExists(folderPath) {
  if (!fs.existsSync(folderPath)) {
    fs.mkdirSync(folderPath, { recursive: true });
  }
}

function ensureStorageFolders() {
  Object.values(paths).forEach((folderPath) => {
    ensureFolderExists(folderPath);
  });
}

function sanitizeFileName(fileName) {
  const parsed = path.parse(fileName);

  const safeBaseName = parsed.name
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  const safeExtension = parsed.ext
    .toLowerCase()
    .replace(/[^a-zA-Z0-9.]/g, '');

  return {
    baseName: safeBaseName || 'file',
    extension: safeExtension,
  };
}

function createUniqueSuffix() {
  const timestamp = Date.now();
  const random = Math.round(Math.random() * 1e9);
  return `${timestamp}_${random}`;
}

function createStoredFilename(prefix, originalName) {
  const { baseName, extension } = sanitizeFileName(originalName);
  return `${prefix}_${createUniqueSuffix()}_${baseName}${extension}`;
}

function createMp4Filename(prefix, originalName) {
  const { baseName } = sanitizeFileName(originalName);
  return `${prefix}_${createUniqueSuffix()}_${baseName}.mp4`;
}

function createJpgFilename(prefix, originalName) {
  const { baseName } = sanitizeFileName(originalName);
  return `${prefix}_${createUniqueSuffix()}_${baseName}.jpg`;
}

function getStoragePath(storageType, filename) {
  if (!paths[storageType]) {
    throw new Error(`Invalid storage type: ${storageType}`);
  }

  return path.join(paths[storageType], filename);
}

function createRawManifestPath(rawFilePath) {
  return path.join(paths.rawManifests, `${path.basename(rawFilePath)}.json`);
}

module.exports = {
  PROJECT_ROOT,
  STORAGE_ROOT,
  paths,
  ensureFolderExists,
  ensureStorageFolders,
  sanitizeFileName,
  createStoredFilename,
  createMp4Filename,
  createJpgFilename,
  createRawManifestPath,
  getStoragePath,
};
