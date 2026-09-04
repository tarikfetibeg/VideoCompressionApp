const fs = require('fs');
const path = require('path');
const express = require('express');
const { z } = require('zod');
const { Server: TusServer, EVENTS } = require('@tus/server');
const { FileStore } = require('@tus/file-store');
const authenticateToken = require('../../middleware/authenticateToken');
const TransferSession = require('../../models/TransferSession');
const { allowedVideoExtensions } = require('../../config/mediaFormats');
const { ensureFolderExists, paths } = require('../../utils/storagePaths');
const {
  finalizeDirectFinalTransfer,
  prepareDirectFinalTransfer,
  signResumableTransfer,
  verifyResumableTransferToken,
} = require('../../services/directFinalTransferService');
const {
  authorizationForProgramFinalTransfer,
  finalizeProgramFinalTransfer,
  queueProgramFinalTransferRetry,
} = require('../../services/programFinalTransferService');

const router = express.Router();
const uploadDirectory = path.join(paths.temp, 'resumable-uploads');
const directMaximumBytes = Math.max(Number(process.env.MAX_UPLOAD_SIZE_GB || 25), 1) * 1024 ** 3;
const programFinalMaximumBytes = Math.max(Number(process.env.MAX_PROGRAM_FINAL_SIZE_GB || 100), 1) * 1024 ** 3;
const maximumBytes = Math.max(directMaximumBytes, programFinalMaximumBytes);
const transferRetentionMs = 7 * 24 * 60 * 60 * 1000;
const allowedRoles = new Set(['Editor', 'VideoEditor', 'Admin']);
ensureFolderExists(uploadDirectory);

const directFinalSchema = z.object({
  idempotencyKey: z.string().min(8).max(200),
  originalFilename: z.string().min(1).max(500),
  totalBytes: z.number().int().positive().max(directMaximumBytes),
  lastModified: z.number().int().nonnegative().optional(),
  metadata: z.object({
    programId: z.string().max(100).optional(),
    contentTypeId: z.string().min(1).max(100),
    airDate: z.string().max(40).optional(),
    finalTitle: z.string().max(500).optional(),
    reporterId: z.string().max(100).optional(),
    keywords: z.string().max(4000).optional(),
    notes: z.string().max(8000).optional(),
  }),
});

function transferResponse(result) {
  return {
    transferId: result.transfer.transferId,
    videoId: result.video?._id || result.transfer.entityId,
    status: result.transfer.status,
    resumableUrl: result.transfer.resumableUrl,
    authorization: result.authorization,
    expiresAt: result.transfer.expiresAt,
    existing: result.existing,
  };
}

router.post('/direct-final', authenticateToken, async (req, res) => {
  if (!allowedRoles.has(req.user.role)) {
    return res.status(403).json({ message: 'Resumable final upload je dostupan montaži i Adminu.' });
  }
  const parsed = directFinalSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Podaci resumable uploada nisu ispravni.' });
  const extension = path.extname(parsed.data.originalFilename).toLowerCase();
  if (!allowedVideoExtensions.includes(extension)) {
    return res.status(400).json({ message: 'Format video fajla nije podržan.' });
  }
  try {
    const result = await prepareDirectFinalTransfer({
      user: req.user,
      ...parsed.data,
    });
    return res.status(result.existing ? 200 : 201).json(transferResponse(result));
  } catch (error) {
    console.error('Prepare resumable direct-final upload failed:', error);
    return res.status(error.statusCode || 500).json({ message: error.message || 'Resumable upload se ne može pripremiti.' });
  }
});

router.post('/transfers/:transferId/resume', authenticateToken, async (req, res) => {
  const transfer = await TransferSession.findOne({
    transferId: req.params.transferId,
    user: req.user.id,
    direction: 'upload',
    status: { $nin: ['cancelled'] },
  });
  if (!transfer) return res.status(404).json({ message: 'Upload transfer nije pronađen.' });
  transfer.ticketExpiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
  transfer.expiresAt = new Date(Date.now() + transferRetentionMs);
  const completedUploadPath = path.join(uploadDirectory, transfer.transferId);
  const retryCompletedUpload = !transfer.mediaNode && transfer.status === 'failed'
    && fs.existsSync(completedUploadPath)
    && fs.statSync(completedUploadPath).size === transfer.totalBytes;
  if (transfer.status === 'paused' || transfer.status === 'failed') transfer.status = 'queued';
  await transfer.save();
  try {
    if (transfer.mediaNode && transfer.entityType === 'program_final'
      && transfer.transferredBytes === transfer.totalBytes) {
      await queueProgramFinalTransferRetry(transfer);
    }
  } catch (error) {
    return res.status(error.statusCode || 500).json({ message: error.message });
  }
  if (retryCompletedUpload) {
    setImmediate(async () => {
      try {
        if (transfer.entityType === 'program_final') {
          await finalizeProgramFinalTransfer({
            transferId: transfer.transferId,
            uploadedPath: completedUploadPath,
            size: transfer.totalBytes,
          });
        } else {
          await finalizeDirectFinalTransfer({
            transferId: transfer.transferId,
            uploadedPath: completedUploadPath,
            size: transfer.totalBytes,
          });
        }
      } catch (error) {
        console.error('Resumable upload retry finalization failed:', error);
      }
    });
  }
  let authorization = '';
  try {
    authorization = transfer.status === 'completed'
      ? ''
      : transfer.entityType === 'program_final'
        ? await authorizationForProgramFinalTransfer(transfer)
        : `Bearer ${signResumableTransfer(transfer)}`;
  } catch (error) {
    return res.status(error.statusCode || 500).json({ message: error.message });
  }
  return res.json({
    transferId: transfer.transferId,
    videoId: transfer.entityId,
    status: transfer.status,
    resumableUrl: transfer.resumableUrl,
    authorization,
    expiresAt: transfer.expiresAt,
  });
});

router.patch('/transfers/:transferId/progress', authenticateToken, async (req, res) => {
  const status = ['transferring', 'paused', 'verifying', 'cancelled'].includes(req.body?.status)
    ? req.body.status
    : 'transferring';
  const transferredBytes = Math.max(Number(req.body?.transferredBytes) || 0, 0);
  const transfer = await TransferSession.findOneAndUpdate(
    {
      transferId: req.params.transferId,
      user: req.user.id,
      status: { $nin: ['completed', 'failed', 'cancelled'] },
    },
    { $set: { status, transferredBytes, error: '' } },
    { new: true }
  );
  if (!transfer) return res.status(404).json({ message: 'Aktivni upload transfer nije pronađen.' });
  return res.json(transfer);
});

router.get('/transfers/:transferId', authenticateToken, async (req, res) => {
  const transfer = await TransferSession.findOne({ transferId: req.params.transferId, user: req.user.id });
  if (!transfer) return res.status(404).json({ message: 'Upload transfer nije pronađen.' });
  return res.json(transfer);
});

function transferPayload(req) {
  const payload = verifyResumableTransferToken(req.headers.authorization);
  req.resumableTransfer = payload;
  return payload;
}

const tusServer = new TusServer({
  path: '/api/v2/uploads/files',
  datastore: new FileStore({ directory: uploadDirectory }),
  maxSize: maximumBytes,
  namingFunction(req) {
    const payload = transferPayload(req);
    return payload.transferId;
  },
  async onIncomingRequest(req, _res, uploadId) {
    try {
      const payload = req.resumableTransfer || transferPayload(req);
      if (uploadId !== payload.transferId) {
        throw { status_code: 403, body: 'Transfer token nije vezan za ovaj upload.' };
      }
      const transfer = await TransferSession.findOne({
        transferId: payload.transferId,
        user: payload.userId,
        direction: 'upload',
        status: { $nin: ['completed', 'cancelled'] },
        expiresAt: { $gt: new Date() },
      });
      if (!transfer) throw { status_code: 404, body: 'Upload transfer nije aktivan.' };
      req.resumableTransferRecord = transfer;
    } catch (error) {
      if (error?.status_code) throw error;
      throw { status_code: 401, body: error.message };
    }
  },
  async onUploadCreate(req, res, upload) {
    const payload = req.resumableTransfer || transferPayload(req);
    if (!upload.metadata?.transferId || upload.metadata.transferId !== payload.transferId) {
      throw { status_code: 403, body: 'Upload metadata ne odgovara transfer tokenu.' };
    }
    const transfer = req.resumableTransferRecord;
    if (!transfer) throw { status_code: 404, body: 'Upload transfer nije aktivan.' };
    if (Number(upload.size) !== Number(transfer.totalBytes)) {
      throw { status_code: 409, body: 'Veličina fajla ne odgovara pripremljenom transferu.' };
    }
    if (upload.metadata?.filename !== transfer.filename) {
      throw { status_code: 409, body: 'Naziv fajla ne odgovara pripremljenom transferu.' };
    }
    transfer.status = 'transferring';
    await transfer.save();
    return { res };
  },
});

tusServer.on(EVENTS.POST_FINISH, async (req, _res, upload) => {
  try {
    const payload = req.resumableTransfer || transferPayload(req);
    const uploadedPath = path.join(uploadDirectory, upload.id);
    const stats = await fs.promises.stat(uploadedPath);
    const transfer = await TransferSession.findOne({ transferId: payload.transferId }).select('entityType');
    if (transfer?.entityType === 'program_final') {
      await finalizeProgramFinalTransfer({ transferId: payload.transferId, uploadedPath, size: stats.size });
    } else {
      await finalizeDirectFinalTransfer({
        transferId: payload.transferId,
        uploadedPath,
        size: stats.size,
      });
    }
  } catch (error) {
    console.error('Resumable upload completion failed:', error);
    const transferId = req.resumableTransfer?.transferId;
    if (transferId) {
      await TransferSession.updateOne(
        { transferId, status: { $ne: 'completed' } },
        { $set: { status: 'failed', error: String(error.message || error).slice(0, 2000) } }
      ).catch(() => {});
    }
  }
});

function handleTusRequest(req, res) {
  return tusServer.handle(req, res);
}

module.exports = {
  handleTusRequest,
  router,
};
