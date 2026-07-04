const crypto = require('crypto');
const express = require('express');
const fs = require('fs');
const path = require('path');
const MediaTicket = require('../models/MediaTicket');
const User = require('../models/User');
const Video = require('../models/Video');
const authenticateToken = require('../middleware/authenticateToken');
const { hasReadyHlsPreview, resolveHlsResource } = require('../services/hlsPreviewService');
const { sendFileWithRange } = require('../utils/mediaStreaming');

const router = express.Router();
const MEDIA_TICKET_TTL_MINUTES = Math.max(
  parseInt(process.env.MEDIA_TICKET_TTL_MINUTES || '120', 10) || 120,
  5
);
const allowedMediaRoles = ['Reporter', 'Editor', 'VideoEditor', 'Producer', 'Realizator', 'Archivist', 'Admin'];
const MEDIA_TICKET_CACHE_TTL_MS = Math.max(
  parseInt(process.env.MEDIA_TICKET_CACHE_TTL_SECONDS || '15', 10) || 15,
  1
) * 1000;
const MEDIA_TICKET_USAGE_WRITE_INTERVAL_MS = Math.max(
  parseInt(process.env.MEDIA_TICKET_USAGE_WRITE_INTERVAL_SECONDS || '60', 10) || 60,
  5
) * 1000;
const MEDIA_TICKET_CACHE_MAX = Math.min(
  Math.max(parseInt(process.env.MEDIA_TICKET_CACHE_MAX || '5000', 10) || 5000, 100),
  20000
);
const ticketCache = new Map();

function createToken() {
  return crypto.randomBytes(32).toString('hex');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function getVideoSourcePath(video) {
  const candidates = [video.previewPath, video.compressedPath, video.filepath];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const resolved = path.resolve(candidate);
    if (fs.existsSync(resolved)) return resolved;
  }
  return null;
}

function canReadMedia(user) {
  return Boolean(user && allowedMediaRoles.includes(user.role));
}

async function loadTicket(token) {
  const tokenHash = hashToken(token);
  const now = Date.now();
  const cached = ticketCache.get(tokenHash);
  let ticket;
  let user;
  let video;

  if (
    cached
    && cached.cachedUntil > now
    && new Date(cached.ticket.expiresAt).getTime() > now
  ) {
    ({ ticket, user, video } = cached);
  } else {
    if (cached) ticketCache.delete(tokenHash);
    ticket = await MediaTicket.findOne({ tokenHash });
    if (ticket) {
      [user, video] = await Promise.all([
        User.findById(ticket.createdBy).select('_id username role'),
        Video.findById(ticket.video),
      ]);
      if (ticketCache.size >= MEDIA_TICKET_CACHE_MAX) {
        ticketCache.delete(ticketCache.keys().next().value);
      }
      ticketCache.set(tokenHash, {
        ticket,
        user,
        video,
        cachedUntil: now + MEDIA_TICKET_CACHE_TTL_MS,
        lastUsageWriteAt: cached?.lastUsageWriteAt || 0,
      });
    }
  }
  if (!ticket) {
    const error = new Error('Media link nije pronadjen.');
    error.statusCode = 404;
    throw error;
  }
  if (new Date(ticket.expiresAt).getTime() <= Date.now()) {
    const error = new Error('Media link je istekao.');
    error.statusCode = 410;
    throw error;
  }

  if (!user || !canReadMedia(user)) {
    const error = new Error('Pristup media sadržaju nije dozvoljen.');
    error.statusCode = 403;
    throw error;
  }
  if (!video) {
    const error = new Error('Video nije pronadjen.');
    error.statusCode = 404;
    throw error;
  }

  const cacheEntry = ticketCache.get(tokenHash);
  if (!cacheEntry || now - Number(cacheEntry.lastUsageWriteAt || 0) >= MEDIA_TICKET_USAGE_WRITE_INTERVAL_MS) {
    if (cacheEntry) cacheEntry.lastUsageWriteAt = now;
    MediaTicket.updateOne(
      { _id: ticket._id },
      { $set: { lastUsedAt: new Date(now) }, $inc: { useCount: 1 } }
    ).catch((error) => console.warn('Media ticket usage update failed:', error.message));
  }

  return { ticket, user, video };
}

router.post('/tickets', authenticateToken, async (req, res) => {
  if (!canReadMedia(req.user)) {
    return res.status(403).json({ message: 'Pristup media sadržaju nije dozvoljen.' });
  }

  try {
    const video = await Video.findById(req.body?.videoId);
    if (!video) return res.status(404).json({ message: 'Video nije pronadjen.' });

    const fallbackPath = getVideoSourcePath(video);
    const hlsAvailable = hasReadyHlsPreview(video);
    if (!fallbackPath && !hlsAvailable) {
      return res.status(404).json({ message: 'Preview fajl nije pronadjen na serveru.' });
    }

    const token = createToken();
    const expiresAt = new Date(Date.now() + MEDIA_TICKET_TTL_MINUTES * 60 * 1000);
    const ticket = await MediaTicket.create({
      tokenHash: hashToken(token),
      createdBy: req.user.id,
      video: video._id,
      expiresAt,
    });
    const baseUrl = `/api/media/${token}`;

    res.status(201).json({
      ticketId: ticket._id,
      manifestUrl: hlsAvailable ? `${baseUrl}/master.m3u8` : '',
      fallbackUrl: fallbackPath ? `${baseUrl}/fallback.mp4` : '',
      expiresAt,
      hlsAvailable,
    });
  } catch (error) {
    console.error('Error creating media ticket:', error);
    res.status(500).json({ message: 'Media ticket nije moguće kreirati.' });
  }
});

router.get('/:token/fallback.mp4', async (req, res) => {
  try {
    const { video } = await loadTicket(req.params.token);
    const sourcePath = getVideoSourcePath(video);
    if (!sourcePath) return res.status(404).json({ message: 'Preview fajl nije pronadjen.' });
    return sendFileWithRange(req, res, sourcePath, 'video/mp4');
  } catch (error) {
    if (!res.headersSent) {
      res.status(error.statusCode || 500).json({ message: error.message });
    }
  }
});

router.head('/:token/fallback.mp4', async (req, res) => {
  try {
    const { video } = await loadTicket(req.params.token);
    const sourcePath = getVideoSourcePath(video);
    if (!sourcePath) return res.sendStatus(404);
    return sendFileWithRange(req, res, sourcePath, 'video/mp4');
  } catch (error) {
    res.sendStatus(error.statusCode || 500);
  }
});

router.get('/:token/*', async (req, res) => {
  try {
    const { video } = await loadTicket(req.params.token);
    const resourcePath = req.params[0] || 'master.m3u8';
    const filePath = resolveHlsResource(video, resourcePath);
    if (!filePath) return res.status(404).json({ message: 'HLS resurs nije pronadjen.' });

    const extension = path.extname(filePath).toLowerCase();
    const contentType = extension === '.m3u8'
      ? 'application/vnd.apple.mpegurl'
      : extension === '.ts'
        ? 'video/mp2t'
        : 'application/octet-stream';
    res.setHeader('Content-Type', contentType);
    res.setHeader(
      'Cache-Control',
      extension === '.m3u8' ? 'private, no-store' : 'private, max-age=3600, immutable'
    );
    res.setHeader('Referrer-Policy', 'same-origin');
    fs.createReadStream(filePath).pipe(res);
  } catch (error) {
    if (!res.headersSent) {
      res.status(error.statusCode || 500).json({ message: error.message });
    }
  }
});

module.exports = router;
