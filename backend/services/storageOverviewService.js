const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const StorageSettings = require('../models/StorageSettings');
const {
  PROJECT_ROOT,
  paths,
  ensureFolderExists,
} = require('../utils/storagePaths');

const SNAPSHOT_PATH = path.join(paths.adminMetrics, 'storage-overview.json');
const SNAPSHOT_TEMP_PATH = `${SNAPSHOT_PATH}.building`;
const CACHE_TTL_MS = 10 * 60 * 1000;

const folderCategories = [
  { id: 'final', label: 'Finalni masteri', group: 'media', target: paths.final },
  { id: 'compressed', label: 'Kompresovani materijal', group: 'media', target: paths.compressed },
  { id: 'raw', label: 'Raw materijal', group: 'media', target: paths.raw },
  { id: 'mp4-previews', label: 'MP4 previewi', group: 'media', target: paths.previews },
  { id: 'hls-previews', label: 'HLS previewi', group: 'media', target: paths.hlsPreviews },
  { id: 'scrub-previews', label: 'Scrub previewi', group: 'media', target: paths.scrubPreviews },
  { id: 'thumbnails', label: 'Thumbnail slike', group: 'media', target: paths.thumbnails },
  { id: 'off-audio', label: 'OFF audio', group: 'media', target: paths.offAudio },
  { id: 'temp', label: 'Privremeni fajlovi', group: 'operational', target: paths.temp },
  { id: 'raw-manifests', label: 'Raw manifesti', group: 'operational', target: paths.rawManifests },
  { id: 'admin-metrics', label: 'Admin metrics', group: 'operational', target: paths.adminMetrics },
  { id: 'frontend-build', label: 'Frontend build', group: 'application', target: path.join(PROJECT_ROOT, 'frontend', 'build') },
  { id: 'dependencies-root', label: 'Root dependencies', group: 'application', target: path.join(PROJECT_ROOT, 'node_modules') },
  { id: 'dependencies-frontend', label: 'Frontend dependencies', group: 'application', target: path.join(PROJECT_ROOT, 'frontend', 'node_modules') },
  { id: 'dependencies-backend', label: 'Backend dependencies', group: 'application', target: path.join(PROJECT_ROOT, 'backend', 'node_modules') },
  { id: 'git', label: 'Git razvojni podaci', group: 'application', target: path.join(PROJECT_ROOT, '.git') },
];

let cachedSnapshot = null;
let activeScan = null;
let scanStartedAt = null;
let lastScanError = '';

function toSafeNumber(value) {
  if (typeof value === 'bigint') {
    return value > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(value);
  }
  return Number(value) || 0;
}

function addTotals(target, source) {
  target.bytes += Number(source.bytes || 0);
  target.fileCount += Number(source.fileCount || 0);
}

async function scanDirectory(target) {
  const result = { bytes: 0, fileCount: 0, skippedSymlinks: 0, errors: [] };
  if (!fs.existsSync(target)) return result;

  async function visit(folder) {
    let directory;
    try {
      directory = await fs.promises.opendir(folder);
      for await (const entry of directory) {
        const entryPath = path.join(folder, entry.name);
        if (entry.isSymbolicLink()) {
          result.skippedSymlinks += 1;
        } else if (entry.isDirectory()) {
          await visit(entryPath);
        } else if (entry.isFile()) {
          try {
            const stats = await fs.promises.stat(entryPath);
            result.bytes += stats.size;
            result.fileCount += 1;
          } catch (error) {
            result.errors.push({ item: entry.name, message: error.message });
          }
        }
      }
    } catch (error) {
      result.errors.push({ item: path.basename(folder), message: error.message });
    } finally {
      if (directory) await directory.close().catch(() => {});
    }
  }

  await visit(target);
  return result;
}

function shouldSkipSourceEntry(relativePath, entryName) {
  const normalized = relativePath.replace(/\\/g, '/');
  if (!normalized) return false;
  if (normalized === 'storage' || normalized.startsWith('storage/')) return true;
  if (normalized === '.git' || normalized.startsWith('.git/')) return true;
  if (entryName === 'node_modules') return true;
  if (normalized === 'frontend/build' || normalized.startsWith('frontend/build/')) return true;
  if (normalized.startsWith('.tmp_doc_')) return true;
  if (!normalized.includes('/') && entryName.toLowerCase().endsWith('.log')) return true;
  return false;
}

async function scanRootLogs() {
  const result = { bytes: 0, fileCount: 0, skippedSymlinks: 0, errors: [] };
  try {
    const entries = await fs.promises.readdir(PROJECT_ROOT, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.log')) continue;
      try {
        const stats = await fs.promises.stat(path.join(PROJECT_ROOT, entry.name));
        result.bytes += stats.size;
        result.fileCount += 1;
      } catch (error) {
        result.errors.push({ item: entry.name, message: error.message });
      }
    }
  } catch (error) {
    result.errors.push({ item: 'project-root', message: error.message });
  }
  return result;
}

async function scanApplicationSource() {
  const result = { bytes: 0, fileCount: 0, skippedSymlinks: 0, errors: [] };

  async function visit(folder) {
    let directory;
    try {
      directory = await fs.promises.opendir(folder);
      for await (const entry of directory) {
        const entryPath = path.join(folder, entry.name);
        const relativePath = path.relative(PROJECT_ROOT, entryPath);
        if (shouldSkipSourceEntry(relativePath, entry.name)) continue;
        if (entry.isSymbolicLink()) {
          result.skippedSymlinks += 1;
        } else if (entry.isDirectory()) {
          await visit(entryPath);
        } else if (entry.isFile()) {
          try {
            const stats = await fs.promises.stat(entryPath);
            result.bytes += stats.size;
            result.fileCount += 1;
          } catch (error) {
            result.errors.push({ item: relativePath, message: error.message });
          }
        }
      }
    } catch (error) {
      result.errors.push({ item: path.relative(PROJECT_ROOT, folder), message: error.message });
    } finally {
      if (directory) await directory.close().catch(() => {});
    }
  }

  await visit(PROJECT_ROOT);
  return result;
}

async function getSettings() {
  let settings = await StorageSettings.findOne({});
  if (!settings) settings = await StorageSettings.create({});
  return settings;
}

function getDiskStatus(freePercent, settings) {
  if (freePercent <= Number(settings.criticalFreePercent)) return 'critical';
  if (freePercent <= Number(settings.warningFreePercent)) return 'warning';
  return 'healthy';
}

async function getVolume(target, role, settings) {
  const resolved = path.resolve(target);
  const stats = await fs.promises.statfs(resolved, { bigint: true });
  const blockSize = toSafeNumber(stats.bsize);
  const totalBytes = toSafeNumber(stats.blocks) * blockSize;
  const freeBytes = toSafeNumber(stats.bavail) * blockSize;
  const usedBytes = Math.max(totalBytes - freeBytes, 0);
  const freePercent = totalBytes > 0 ? (freeBytes / totalBytes) * 100 : 0;
  return {
    id: path.parse(resolved).root.toLowerCase() || resolved,
    role,
    totalBytes,
    usedBytes,
    freeBytes,
    freePercent,
    status: getDiskStatus(freePercent, settings),
  };
}

async function getVolumes(settings) {
  const candidates = [
    { target: PROJECT_ROOT, role: 'application' },
    { target: paths.root, role: 'storage' },
  ];
  const volumes = [];
  for (const candidate of candidates) {
    try {
      const volume = await getVolume(candidate.target, candidate.role, settings);
      const existing = volumes.find((item) => item.id === volume.id);
      if (existing) {
        existing.role = 'application+storage';
      } else {
        volumes.push(volume);
      }
    } catch (error) {
      volumes.push({
        id: candidate.role,
        role: candidate.role,
        error: error.message,
        status: 'unknown',
      });
    }
  }
  return volumes;
}

async function getDatabaseStats() {
  try {
    if (!mongoose.connection?.db) throw new Error('MongoDB connection is not ready.');
    const stats = await mongoose.connection.db.command({ dbStats: 1, scale: 1 });
    return {
      available: true,
      database: stats.db,
      collections: Number(stats.collections || 0),
      objects: Number(stats.objects || 0),
      dataSize: Number(stats.dataSize || 0),
      storageSize: Number(stats.storageSize || 0),
      indexSize: Number(stats.indexSize || 0),
      totalSize: Number(stats.totalSize || 0),
      separateFromLocalDisk: true,
    };
  } catch (error) {
    return {
      available: false,
      error: error.message,
      separateFromLocalDisk: true,
    };
  }
}

function sanitizeCategoryResult(definition, result) {
  return {
    id: definition.id,
    label: definition.label,
    group: definition.group,
    bytes: result.bytes,
    fileCount: result.fileCount,
    skippedSymlinks: result.skippedSymlinks,
    errors: result.errors.slice(0, 10),
  };
}

async function buildSnapshot() {
  ensureFolderExists(paths.adminMetrics);
  const categories = [];
  for (const definition of folderCategories) {
    categories.push(sanitizeCategoryResult(definition, await scanDirectory(definition.target)));
  }
  categories.push({
    id: 'application-logs',
    label: 'Aplikacijski logovi',
    group: 'operational',
    ...(await scanRootLogs()),
  });
  categories.push({
    id: 'application-source',
    label: 'Aplikacijski kod, konfiguracija i dokumentacija',
    group: 'application',
    ...(await scanApplicationSource()),
  });

  const groups = {
    media: { bytes: 0, fileCount: 0 },
    operational: { bytes: 0, fileCount: 0 },
    application: { bytes: 0, fileCount: 0 },
  };
  categories.forEach((category) => addTotals(groups[category.group], category));

  const snapshot = {
    generatedAt: new Date().toISOString(),
    categories,
    groups,
    trackedBytes: Object.values(groups).reduce((total, group) => total + group.bytes, 0),
    database: await getDatabaseStats(),
  };

  await fs.promises.writeFile(SNAPSHOT_TEMP_PATH, JSON.stringify(snapshot, null, 2), 'utf8');
  await fs.promises.rm(SNAPSHOT_PATH, { force: true });
  await fs.promises.rename(SNAPSHOT_TEMP_PATH, SNAPSHOT_PATH);
  cachedSnapshot = snapshot;
  return snapshot;
}

function loadPersistedSnapshot() {
  if (cachedSnapshot) return cachedSnapshot;
  try {
    cachedSnapshot = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8'));
  } catch (error) {
    cachedSnapshot = null;
  }
  return cachedSnapshot;
}

function refreshStorageOverview() {
  if (activeScan) return { started: false, promise: activeScan };
  scanStartedAt = new Date();
  activeScan = buildSnapshot()
    .then((snapshot) => {
      lastScanError = '';
      return snapshot;
    })
    .catch((error) => {
      lastScanError = error.message;
      return cachedSnapshot;
    })
    .finally(() => {
      activeScan = null;
      scanStartedAt = null;
    });
  return { started: true, promise: activeScan };
}

async function getStorageOverview({ refreshIfStale = true } = {}) {
  const settings = await getSettings();
  const snapshot = loadPersistedSnapshot();
  const generatedAt = snapshot?.generatedAt ? new Date(snapshot.generatedAt).getTime() : 0;
  const stale = !generatedAt || Date.now() - generatedAt > CACHE_TTL_MS;
  if (refreshIfStale && stale && !activeScan) refreshStorageOverview();
  const currentSnapshot = cachedSnapshot || snapshot;
  return {
    ...(currentSnapshot || {
      generatedAt: null,
      categories: [],
      groups: {
        media: { bytes: 0, fileCount: 0 },
        operational: { bytes: 0, fileCount: 0 },
        application: { bytes: 0, fileCount: 0 },
      },
      trackedBytes: 0,
      database: { available: false, separateFromLocalDisk: true },
    }),
    volumes: await getVolumes(settings),
    thresholds: {
      warningFreePercent: settings.warningFreePercent,
      criticalFreePercent: settings.criticalFreePercent,
    },
    scan: {
      status: activeScan ? 'collecting' : 'idle',
      startedAt: scanStartedAt,
      stale,
      error: lastScanError,
    },
  };
}

async function updateStorageSettings(update) {
  const warningFreePercent = Number(update.warningFreePercent);
  const criticalFreePercent = Number(update.criticalFreePercent);
  if (!Number.isFinite(warningFreePercent) || warningFreePercent < 2 || warningFreePercent > 50) {
    const error = new Error('Warning prag mora biti između 2% i 50%.');
    error.statusCode = 400;
    throw error;
  }
  if (
    !Number.isFinite(criticalFreePercent)
    || criticalFreePercent < 1
    || criticalFreePercent >= warningFreePercent
  ) {
    const error = new Error('Critical prag mora biti najmanje 1% i manji od warning praga.');
    error.statusCode = 400;
    throw error;
  }
  let settings = await StorageSettings.findOne({});
  if (!settings) settings = new StorageSettings();
  settings.warningFreePercent = warningFreePercent;
  settings.criticalFreePercent = criticalFreePercent;
  return settings.save();
}

module.exports = {
  CACHE_TTL_MS,
  SNAPSHOT_PATH,
  getStorageOverview,
  getSettings,
  refreshStorageOverview,
  scanApplicationSource,
  scanDirectory,
  updateStorageSettings,
};
