const fs = require('fs');
const mongoose = require('mongoose');
const MediaNode = require('../models/MediaNode');
const MediaTask = require('../models/MediaTask');
const TransferSession = require('../models/TransferSession');
const EventOutbox = require('../models/EventOutbox');
const EscalationPolicy = require('../models/EscalationPolicy');
const Device = require('../models/Device');
const { paths } = require('../utils/storagePaths');
const { snapshotRuntimeMetrics } = require('./runtimeMetricsService');
const { releaseConfiguration } = require('./desktopVersionService');

function countMap(rows = []) {
  return Object.fromEntries(rows.map((item) => [item._id || 'unknown', item.count]));
}

function bytesFromStatfs(stats) {
  const blockSize = Number(stats.bsize || 0);
  const totalBytes = Number(stats.blocks || 0) * blockSize;
  const freeBytes = Number(stats.bavail || 0) * blockSize;
  return {
    totalBytes,
    freeBytes,
    usedBytes: Math.max(totalBytes - freeBytes, 0),
    freePercent: totalBytes > 0 ? Math.round((freeBytes / totalBytes) * 1000) / 10 : 0,
  };
}

async function getDiskHealth() {
  try {
    return { available: true, ...bytesFromStatfs(await fs.promises.statfs(paths.root)) };
  } catch (error) {
    return { available: false, error: error.message };
  }
}

async function loadPlatformOverview() {
  const staleAt = new Date(Date.now() - 90 * 1000);
  const [nodes, taskCounts, transferCounts, outbox, policies] = await Promise.all([
    MediaNode.find()
      .select('nodeId name site kind baseUrl status capabilities storage lastSeenAt createdAt updatedAt')
      .sort({ site: 1, name: 1 })
      .lean(),
    MediaTask.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    TransferSession.aggregate([
      { $match: { status: { $in: ['queued', 'preparing', 'transferring', 'paused', 'verifying', 'failed'] } } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    Promise.all([
      EventOutbox.countDocuments({ publishedAt: null }),
      EventOutbox.countDocuments({ publishedAt: null, attempts: { $gt: 0 } }),
      EventOutbox.findOne({ publishedAt: { $ne: null } }).sort({ publishedAt: -1 }).select('publishedAt').lean(),
    ]),
    EscalationPolicy.find().sort({ eventType: 1 }).lean(),
  ]);

  return {
    nodes: nodes.map((node) => ({
      ...node,
      effectiveStatus: node.status === 'maintenance'
        ? 'maintenance'
        : (!node.lastSeenAt || new Date(node.lastSeenAt) < staleAt ? 'offline' : node.status),
    })),
    queues: {
      mediaTasks: countMap(taskCounts),
      transfers: countMap(transferCounts),
      outbox: {
        pending: outbox[0],
        retrying: outbox[1],
        lastPublishedAt: outbox[2]?.publishedAt || null,
      },
    },
    policies,
    desktopRelease: releaseConfiguration(),
    generatedAt: new Date(),
  };
}

async function loadPlatformHealth() {
  const startedAt = Date.now();
  const mongoStartedAt = Date.now();
  let mongo = { connected: mongoose.connection.readyState === 1, pingMs: null, error: '' };
  if (mongo.connected) {
    try {
      await mongoose.connection.db.admin().ping();
      mongo.pingMs = Date.now() - mongoStartedAt;
    } catch (error) {
      mongo = { connected: false, pingMs: null, error: error.message };
    }
  }

  const [disk, onlineDevices, onlineNodes, pendingTransfers, failedTransfers, pendingOutbox] = await Promise.all([
    getDiskHealth(),
    Device.countDocuments({ revokedAt: null, lastSeenAt: { $gte: new Date(Date.now() - 90 * 1000) } }),
    MediaNode.countDocuments({ status: { $in: ['online', 'degraded'] }, lastSeenAt: { $gte: new Date(Date.now() - 90 * 1000) } }),
    TransferSession.countDocuments({ status: { $in: ['queued', 'preparing', 'transferring', 'paused', 'verifying'] } }),
    TransferSession.countDocuments({ status: 'failed' }),
    EventOutbox.countDocuments({ publishedAt: null }),
  ]);

  const runtime = snapshotRuntimeMetrics();
  const warnings = [];
  if (!mongo.connected) warnings.push('MongoDB nije dostupan.');
  if (!disk.available) warnings.push('Kapacitet media diska nije dostupan.');
  if (disk.available && disk.freePercent <= 10) warnings.push('Media disk ima manje od 10% slobodnog prostora.');
  if (runtime.eventLoop.p95Ms >= 200) warnings.push('API event loop je opterećen.');
  if (pendingOutbox >= 100) warnings.push('Event outbox ima veliki backlog.');

  return {
    status: warnings.length ? 'degraded' : 'healthy',
    generatedAt: new Date(),
    collectionMs: Date.now() - startedAt,
    mongo,
    disk,
    runtime,
    services: {
      onlineDevices,
      onlineNodes,
      pendingTransfers,
      failedTransfers,
      pendingOutbox,
    },
    warnings,
  };
}

module.exports = {
  loadPlatformHealth,
  loadPlatformOverview,
};
