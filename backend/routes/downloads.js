const express = require('express');
const crypto = require('crypto');
const DownloadTicket = require('../models/DownloadTicket');
const User = require('../models/User');
const authenticateToken = require('../middleware/authenticateToken');
const { DownloadHttpError, streamDownloadByKind } = require('../services/downloadService');

const router = express.Router();

const TICKET_TTL_MINUTES = Math.max(parseInt(process.env.DOWNLOAD_TICKET_TTL_MINUTES || '15', 10) || 15, 1);
const allowedKinds = new Set([
  'video-single',
  'video-bulk',
  'edit-package',
  'edit-off-file',
  'air-package',
]);

function createToken() {
  return crypto.randomBytes(32).toString('hex');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function getTicketUrl(req, token) {
  return `/api/downloads/tickets/${token}`;
}

function sanitizePayload(kind, payload = {}) {
  if (!payload || typeof payload !== 'object') return {};

  if (kind === 'video-single') {
    return { videoId: String(payload.videoId || '') };
  }

  if (kind === 'video-bulk') {
    return {
      videoIds: Array.isArray(payload.videoIds)
        ? payload.videoIds.map((videoId) => String(videoId)).filter(Boolean).slice(0, 500)
        : [],
    };
  }

  if (kind === 'edit-package') {
    return {
      jobId: String(payload.jobId || ''),
      scope: payload.scope === 'missing' ? 'missing' : 'all',
    };
  }

  if (kind === 'edit-off-file') {
    return {
      jobId: String(payload.jobId || ''),
      fileId: String(payload.fileId || ''),
    };
  }

  if (kind === 'air-package') {
    return { showDayId: String(payload.showDayId || '') };
  }

  return {};
}

function validatePayload(kind, payload) {
  if (kind === 'video-single' && !payload.videoId) return 'videoId is required.';
  if (kind === 'video-bulk' && payload.videoIds.length === 0) return 'videoIds are required.';
  if (kind === 'edit-package' && !payload.jobId) return 'jobId is required.';
  if (kind === 'edit-off-file' && (!payload.jobId || !payload.fileId)) return 'jobId and fileId are required.';
  if (kind === 'air-package' && !payload.showDayId) return 'showDayId is required.';
  return '';
}

function ticketIsExpired(ticket) {
  return !ticket?.expiresAt || new Date(ticket.expiresAt).getTime() <= Date.now();
}

router.post('/tickets', authenticateToken, async (req, res) => {
  const kind = String(req.body?.kind || '');
  if (!allowedKinds.has(kind)) {
    return res.status(400).json({ message: 'Unsupported download type.' });
  }

  const payload = sanitizePayload(kind, req.body?.payload || {});
  const validationError = validatePayload(kind, payload);
  if (validationError) {
    return res.status(400).json({ message: validationError });
  }

  try {
    const token = createToken();
    const expiresAt = new Date(Date.now() + TICKET_TTL_MINUTES * 60 * 1000);
    const ticket = await DownloadTicket.create({
      tokenHash: hashToken(token),
      createdBy: req.user.id,
      kind,
      payload,
      status: 'created',
      expiresAt,
    });

    res.status(201).json({
      ticketId: ticket._id,
      downloadUrl: getTicketUrl(req, token),
      expiresAt,
    });
  } catch (error) {
    console.error('Error creating download ticket:', error);
    res.status(500).json({ message: 'Download ticket could not be created.' });
  }
});

router.get('/tickets/:ticketId/status', authenticateToken, async (req, res) => {
  try {
    const ticket = await DownloadTicket.findById(req.params.ticketId).populate('createdBy', 'username role');
    if (!ticket) return res.status(404).json({ message: 'Download ticket not found.' });

    const ownerId = ticket.createdBy?._id?.toString() || ticket.createdBy?.toString();
    if (req.user.role !== 'Admin' && ownerId !== req.user.id) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    if (ticketIsExpired(ticket) && !['completed', 'failed', 'aborted', 'expired'].includes(ticket.status)) {
      ticket.status = 'expired';
      ticket.finishedAt = new Date();
      ticket.error = 'Download ticket expired before it was used.';
      await ticket.save();
    }

    res.json({
      ticketId: ticket._id,
      kind: ticket.kind,
      status: ticket.status,
      createdAt: ticket.createdAt,
      expiresAt: ticket.expiresAt,
      startedAt: ticket.startedAt,
      finishedAt: ticket.finishedAt,
      error: ticket.error || '',
      useCount: ticket.useCount || 0,
    });
  } catch (error) {
    console.error('Error reading download ticket status:', error);
    res.status(500).json({ message: 'Download status could not be loaded.' });
  }
});

router.get('/tickets/:token', async (req, res) => {
  const tokenHash = hashToken(req.params.token || '');

  try {
    const ticket = await DownloadTicket.findOne({ tokenHash });
    if (!ticket) return res.status(404).json({ message: 'Download link was not found.' });

    if (ticketIsExpired(ticket)) {
      ticket.status = 'expired';
      ticket.finishedAt = ticket.finishedAt || new Date();
      ticket.error = ticket.error || 'Download ticket expired.';
      await ticket.save();
      return res.status(410).json({ message: 'Download link has expired.' });
    }

    const user = await User.findById(ticket.createdBy).select('_id username role');
    if (!user) {
      ticket.status = 'failed';
      ticket.finishedAt = new Date();
      ticket.error = 'Ticket owner no longer exists.';
      await ticket.save();
      return res.status(403).json({ message: 'Download owner was not found.' });
    }

    let settled = false;
    const markSettled = async (status, error = '') => {
      if (settled) return;
      settled = true;

      try {
        const nextStatus = status === 'completed' && res.statusCode >= 400 ? 'failed' : status;
        ticket.status = nextStatus;
        ticket.finishedAt = new Date();
        if (error) ticket.error = error;
        await ticket.save();
      } catch (statusError) {
        console.error('Error updating download ticket status:', statusError);
      }
    };

    res.on('finish', () => {
      if (res.statusCode >= 400) {
        markSettled('failed', `HTTP ${res.statusCode}`);
      } else {
        markSettled('completed');
      }
    });
    res.on('close', () => {
      if (!res.writableEnded) {
        markSettled('aborted', 'Connection closed before download finished.');
      }
    });

    ticket.status = 'started';
    ticket.startedAt = ticket.startedAt || new Date();
    ticket.lastUsedAt = new Date();
    ticket.useCount = Number(ticket.useCount || 0) + 1;
    ticket.error = '';
    await ticket.save();

    await streamDownloadByKind({
      kind: ticket.kind,
      payload: ticket.payload || {},
      user,
      res,
    });
  } catch (error) {
    const statusCode = error instanceof DownloadHttpError ? error.statusCode : 500;
    const message = error.message || 'Download could not be started.';
    console.error('Error streaming download ticket:', error);

    await DownloadTicket.updateOne(
      { tokenHash },
      {
        $set: {
          status: 'failed',
          finishedAt: new Date(),
          error: message,
        },
      }
    ).catch((statusError) => {
      console.error('Error marking failed download ticket:', statusError);
    });

    if (!res.headersSent) {
      res.status(statusCode).json({ message });
    } else {
      res.destroy(error);
    }
  }
});

module.exports = router;
