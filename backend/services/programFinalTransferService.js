const crypto = require('crypto');
const ProgramFinal = require('../models/ProgramFinal');
const MediaTask = require('../models/MediaTask');
const TransferSession = require('../models/TransferSession');
const { ingestProgramFinalMaster } = require('./programFinalIngestService');
const { signResumableTransfer } = require('./directFinalTransferService');
const {
  chooseAvailableMediaEdge,
  getAvailableTransferNode,
  signEdgeTransfer,
} = require('./edgeTransferService');

const TRANSFER_TTL_MS = 7 * 24 * 60 * 60 * 1000;

async function authorizationForProgramFinalTransfer(transfer) {
  if (transfer.status === 'completed') return '';
  if (!transfer.mediaNode) return `Bearer ${signResumableTransfer(transfer)}`;
  const node = await getAvailableTransferNode(transfer);
  if (!node) {
    throw Object.assign(new Error('Media Edge za ovaj upload trenutno nije dostupan.'), { statusCode: 503 });
  }
  return `Bearer ${signEdgeTransfer(transfer, node)}`;
}

async function selectUploadNode() {
  const target = String(process.env.PROGRAM_FINAL_UPLOAD_TARGET || 'auto').trim().toLowerCase();
  if (target === 'api' || target === 'control') return null;
  const node = await chooseAvailableMediaEdge({ site: process.env.EDGE_SITE_ID || 'primary' });
  if (!node && target === 'edge') {
    throw Object.assign(new Error('Nijedan svježe dostupan Media Edge nije pronađen.'), { statusCode: 503 });
  }
  return node;
}

async function prepareProgramFinalTransfer({ user, programFinalId, idempotencyKey, originalFilename, totalBytes, replacementReason = '' }) {
  const programFinal = await ProgramFinal.findById(programFinalId);
  if (!programFinal) throw Object.assign(new Error('Final emisije nije pronađen.'), { statusCode: 404 });
  const existing = await TransferSession.findOne({ user: user.id, idempotencyKey });
  if (existing) {
    if (String(existing.entityId) !== String(programFinal._id) || existing.entityType !== 'program_final') {
      throw Object.assign(new Error('Idempotency key je već iskorišten za drugi transfer.'), { statusCode: 409 });
    }
    return { transfer: existing, authorization: await authorizationForProgramFinalTransfer(existing), existing: true };
  }
  const node = await selectUploadNode();
  const transferId = crypto.randomUUID();
  const transfer = await TransferSession.create({
    transferId,
    idempotencyKey,
    user: user.id,
    direction: 'upload',
    kind: 'program_final_master',
    entityType: 'program_final',
    entityId: programFinal._id,
    mediaNode: node?._id || null,
    status: 'queued',
    filename: originalFilename,
    totalBytes,
    transferredBytes: 0,
    resumableUrl: node ? `${node.baseUrl.replace(/\/$/, '')}/files` : '/api/v2/uploads/files',
    ticketExpiresAt: new Date(Date.now() + (node ? 24 : 48) * 60 * 60 * 1000),
    expiresAt: new Date(Date.now() + TRANSFER_TTL_MS),
    metadata: { replacementReason: String(replacementReason || '').trim() },
  });
  return { transfer, authorization: await authorizationForProgramFinalTransfer(transfer), existing: false };
}

async function finalizeProgramFinalTransfer({ transferId, uploadedPath, size }) {
  const transfer = await TransferSession.findOne({ transferId, entityType: 'program_final', direction: 'upload' });
  if (!transfer) throw Object.assign(new Error('Transfer finala nije pronađen.'), { statusCode: 404 });
  if (transfer.status === 'completed') return transfer;
  if (Number(size) !== Number(transfer.totalBytes)) throw new Error('Veličina uploada se ne podudara sa transferom.');
  transfer.status = 'verifying';
  transfer.transferredBytes = size;
  await transfer.save();
  try {
    const result = await ingestProgramFinalMaster({
      programFinalId: transfer.entityId,
      sourcePath: uploadedPath,
      originalFilename: transfer.filename,
      ingestSource: 'resumable_upload',
      actorId: transfer.user,
      mediaNodeId: transfer.mediaNode || null,
      replacementReason: transfer.metadata?.replacementReason || '',
      removeSourceAfterCopy: true,
    });
    transfer.status = 'completed';
    transfer.transferredBytes = size;
    transfer.sha256 = result.checksum;
    transfer.completedAt = new Date();
    transfer.error = '';
    transfer.metadata = {
      ...(transfer.metadata || {}),
      versionId: result.version?._id || null,
      duplicate: result.duplicate === true,
    };
    await transfer.save();
    return transfer;
  } catch (error) {
    transfer.status = 'failed';
    transfer.error = String(error.message || error).slice(0, 2000);
    await transfer.save();
    throw error;
  }
}

async function queueProgramFinalTransferRetry(transfer) {
  if (!transfer?.mediaNode) return null;
  const existing = await MediaTask.findOne({
    node: transfer.mediaNode,
    kind: 'program_final_ingest',
    'payload.transferId': transfer.transferId,
    status: { $in: ['queued', 'claimed', 'processing'] },
  });
  if (existing) return existing;
  return MediaTask.create({
    taskId: crypto.randomUUID(),
    node: transfer.mediaNode,
    kind: 'program_final_ingest',
    payload: { transferId: transfer.transferId },
  });
}

module.exports = {
  finalizeProgramFinalTransfer,
  authorizationForProgramFinalTransfer,
  prepareProgramFinalTransfer,
  queueProgramFinalTransferRetry,
};
