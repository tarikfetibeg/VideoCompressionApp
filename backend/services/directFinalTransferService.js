const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const BroadcastContentType = require('../models/BroadcastContentType');
const BroadcastProgram = require('../models/BroadcastProgram');
const User = require('../models/User');
const Video = require('../models/Video');
const TransferSession = require('../models/TransferSession');
const AuditLog = require('../models/AuditLog');
const { enqueueVideoProcessing } = require('../queues/videoQueue');
const { getQueueErrorMessage } = require('../utils/queueErrors');
const { recordOperation } = require('./runtimeMetricsService');
const {
  createJpgFilename,
  createMp4Filename,
  createStoredFilename,
  ensureFolderExists,
  paths,
} = require('../utils/storagePaths');

const NO_PROGRAM_VALUES = new Set(['', 'ingest', 'none', 'no_program', 'no-show']);
const AUTO_ARCHIVE_SLUGS = new Set(['prilog', 'insert']);
const TRANSFER_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TOKEN_TTL = '48h';

function transferSecret() {
  const secret = process.env.EDGE_TRANSFER_SECRET || process.env.JWT_SECRET;
  if (!secret) throw new Error('EDGE_TRANSFER_SECRET ili JWT_SECRET nije konfigurisan.');
  return secret;
}

function signResumableTransfer(transfer) {
  return jwt.sign({
    tokenType: 'resumable-upload',
    transferId: transfer.transferId,
    userId: String(transfer.user),
    direction: 'upload',
    entityId: String(transfer.entityId),
  }, transferSecret(), { expiresIn: TOKEN_TTL });
}

function verifyResumableTransferToken(value) {
  const token = String(value || '').replace(/^Bearer\s+/i, '');
  const payload = jwt.verify(token, transferSecret());
  if (payload.tokenType !== 'resumable-upload' || payload.direction !== 'upload') {
    throw new Error('Resumable upload token nije ispravan.');
  }
  return payload;
}

function parseDate(value) {
  if (!String(value || '').trim()) return null;
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseKeywords(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function titleFromFilename(filename) {
  return path.parse(String(filename || 'video')).name
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || 'Video';
}

async function findExistingTransfer(userId, idempotencyKey) {
  return TransferSession.findOne({ user: userId, idempotencyKey });
}

async function prepareDirectFinalTransfer({ user, idempotencyKey, originalFilename, totalBytes, metadata = {} }) {
  const existing = await findExistingTransfer(user.id, idempotencyKey);
  if (existing) {
    return {
      transfer: existing,
      video: await Video.findById(existing.entityId),
      authorization: `Bearer ${signResumableTransfer(existing)}`,
      existing: true,
    };
  }

  const contentType = await BroadcastContentType.findOne({ _id: metadata.contentTypeId, active: true });
  if (!contentType) throw Object.assign(new Error('Aktivna kategorija materijala je obavezna.'), { statusCode: 400 });
  const programId = String(metadata.programId || 'ingest').trim();
  const ingestOnly = NO_PROGRAM_VALUES.has(programId);
  const program = ingestOnly ? null : await BroadcastProgram.findOne({ _id: programId, active: true });
  if (!ingestOnly && !program) throw Object.assign(new Error('Odabrani program nije aktivan.'), { statusCode: 400 });
  const airDate = parseDate(metadata.airDate);
  if (!ingestOnly && !airDate) throw Object.assign(new Error('Datum emitovanja je obavezan.'), { statusCode: 400 });
  const reporter = metadata.reporterId
    ? await User.findById(metadata.reporterId).select('_id username role')
    : null;
  if (metadata.reporterId && !reporter) throw Object.assign(new Error('Reporter nije pronađen.'), { statusCode: 404 });

  const title = String(metadata.finalTitle || '').trim() || titleFromFilename(originalFilename);
  const autoArchive = ingestOnly && AUTO_ARCHIVE_SLUGS.has(contentType.slug);
  const finalFolder = path.join(paths.final, contentType.slug);
  ensureFolderExists(finalFolder);
  ensureFolderExists(paths.previews);
  ensureFolderExists(paths.thumbnails);
  const finalFilename = createStoredFilename('final', originalFilename);
  const finalPath = path.join(finalFolder, finalFilename);
  const previewPath = path.join(paths.previews, createMp4Filename('preview', originalFilename));
  const thumbnailPath = path.join(paths.thumbnails, createJpgFilename('thumb', originalFilename));

  const video = await Video.create({
    filename: finalFilename,
    filepath: finalPath,
    originalFilename,
    rawPath: null,
    rawRelativePath: '',
    compressedPath: finalPath,
    previewPath,
    thumbnailPath,
    uploader: user.id,
    reporter: reporter?._id || null,
    editor: user.id,
    event: title,
    location: '',
    tagDate: airDate || new Date(),
    status: 'edited',
    processingStatus: 'uploaded',
    processingMode: 'finalize',
    processingProgress: 0,
    qcStatus: 'passed',
    qcNotes: metadata.notes || 'Desktop resumable direct-final upload.',
    qcCheckedBy: user.id,
    qcCheckedAt: new Date(),
    broadcastStatus: autoArchive ? 'archived' : 'qc_pending',
    program: program?._id || null,
    contentType: contentType._id,
    airDate: ingestOnly ? null : airDate,
    finalTitle: title,
    finalCategory: contentType.slug,
    finalApprovalStatus: 'approved',
    finalApprovedBy: user.id,
    finalApprovedAt: new Date(),
    finalApprovalRole: user.role,
    finalApprovalNotes: metadata.notes || '',
    qaResponsible: user.id,
    qaResponsibilityType: 'direct_editor',
    archivedAt: autoArchive ? new Date() : null,
    keywords: Array.from(new Set([
      program?.name || 'Nema emisije / ingest',
      contentType.name,
      title,
      reporter?.username,
      ...parseKeywords(metadata.keywords),
    ].filter(Boolean))),
    sizeOriginal: Number(totalBytes) || null,
    uploadDate: new Date(),
  });

  try {
    const transfer = await TransferSession.create({
      transferId: crypto.randomUUID(),
      idempotencyKey,
      user: user.id,
      direction: 'upload',
      kind: 'final',
      entityType: 'video',
      entityId: video._id,
      filename: originalFilename,
      totalBytes,
      transferredBytes: 0,
      status: 'queued',
      resumableUrl: '/api/v2/uploads/files',
      ticketExpiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
      expiresAt: new Date(Date.now() + TRANSFER_TTL_MS),
      metadata: { directFinal: metadata },
    });
    return {
      transfer,
      video,
      authorization: `Bearer ${signResumableTransfer(transfer)}`,
      existing: false,
    };
  } catch (error) {
    await Video.deleteOne({ _id: video._id, processingStatus: 'uploaded', rawPath: null });
    throw error;
  }
}

async function finalizeDirectFinalTransfer({ transferId, uploadedPath, size }) {
  const startedAt = Date.now();
  const transfer = await TransferSession.findOne({ transferId, direction: 'upload' });
  if (!transfer) throw new Error('Transfer nije pronađen.');
  if (transfer.status === 'completed') return transfer;
  const video = await Video.findById(transfer.entityId);
  if (!video) throw new Error('Video placeholder nije pronađen.');
  if (!fs.existsSync(uploadedPath)) throw new Error('Uploadovani fajl nije pronađen.');

  const relativePath = path.relative(paths.root, uploadedPath).replace(/\\/g, '/');
  video.rawPath = uploadedPath;
  video.rawRelativePath = relativePath;
  video.sizeOriginal = Number(size) || fs.statSync(uploadedPath).size;
  video.processingStatus = 'queued';
  video.processingProgress = 0;
  video.processingError = '';
  await video.save();

  try {
    const queueJob = await enqueueVideoProcessing(video._id);
    video.processingJobId = String(queueJob.id);
    await video.save();
    transfer.status = 'completed';
    transfer.transferredBytes = video.sizeOriginal;
    transfer.completedAt = new Date();
    transfer.error = '';
    await transfer.save();
    await AuditLog.create({
      action: 'Complete Resumable Direct Final Upload',
      performedBy: transfer.user,
      details: { transferId, videoId: video._id, filename: video.originalFilename, bytes: video.sizeOriginal },
    });
    recordOperation('resumable_upload_finalize', Date.now() - startedAt, 'completed');
    return transfer;
  } catch (error) {
    const message = getQueueErrorMessage(error);
    video.processingStatus = 'failed';
    video.processingError = message;
    await video.save();
    transfer.status = 'failed';
    transfer.error = message;
    await transfer.save();
    recordOperation('resumable_upload_finalize', Date.now() - startedAt, 'failed');
    throw error;
  }
}

module.exports = {
  finalizeDirectFinalTransfer,
  prepareDirectFinalTransfer,
  signResumableTransfer,
  verifyResumableTransferToken,
};
