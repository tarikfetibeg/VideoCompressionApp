const jwt = require('jsonwebtoken');
const MediaNode = require('../models/MediaNode');

function transferSecret() {
  const secret = process.env.EDGE_TRANSFER_SECRET || process.env.JWT_SECRET;
  if (!secret) throw new Error('EDGE_TRANSFER_SECRET ili JWT_SECRET nije konfigurisan.');
  return secret;
}

function signEdgeTransfer(transfer, node) {
  return jwt.sign({
    tokenType: 'edge-transfer',
    transferId: transfer.transferId,
    userId: String(transfer.user),
    nodeId: node.nodeId,
    direction: transfer.direction,
    entityType: transfer.entityType,
    entityId: transfer.entityId ? String(transfer.entityId) : undefined,
    mediaAssetId: transfer.mediaAsset ? String(transfer.mediaAsset) : undefined,
  }, transferSecret(), { expiresIn: '24h' });
}

function heartbeatCutoff() {
  const configuredSeconds = Math.max(Number(process.env.EDGE_HEARTBEAT_MAX_AGE_SECONDS || 90), 30);
  return new Date(Date.now() - configuredSeconds * 1000);
}

async function chooseAvailableMediaEdge({ nodeId, site = 'primary' } = {}) {
  const filter = {
    kind: 'edge',
    status: { $in: ['online', 'degraded'] },
    lastSeenAt: { $gte: heartbeatCutoff() },
    'capabilities.resumableUploads': { $ne: false },
  };
  if (nodeId) filter.nodeId = nodeId;
  else filter.site = site;
  return MediaNode.findOne(filter).sort({ lastSeenAt: -1 });
}

async function getAvailableTransferNode(transfer) {
  if (!transfer?.mediaNode) return null;
  return MediaNode.findOne({
    _id: transfer.mediaNode,
    kind: 'edge',
    status: { $in: ['online', 'degraded'] },
    lastSeenAt: { $gte: heartbeatCutoff() },
  });
}

module.exports = {
  chooseAvailableMediaEdge,
  getAvailableTransferNode,
  signEdgeTransfer,
};
