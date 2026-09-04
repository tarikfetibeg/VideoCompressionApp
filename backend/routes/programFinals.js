const fs = require('fs');
const path = require('path');
const express = require('express');
const mongoose = require('mongoose');
const { z } = require('zod');
const AuditLog = require('../models/AuditLog');
const BroadcastProgram = require('../models/BroadcastProgram');
const FinalIngestCandidate = require('../models/FinalIngestCandidate');
const ProgramFinal = require('../models/ProgramFinal');
const ProgramFinalMediaTicket = require('../models/ProgramFinalMediaTicket');
const ProgramFinalVersion = require('../models/ProgramFinalVersion');
const ProgramType = require('../models/ProgramType');
const MediaNode = require('../models/MediaNode');
const ShowDay = require('../models/ShowDay');
const authenticateToken = require('../middleware/authenticateToken');
const authorize = require('../middleware/authorize');
const { allowedVideoExtensions } = require('../config/mediaFormats');
const { setDownloadHeaders } = require('../utils/downloadHeaders');
const { sendFileWithRange } = require('../utils/mediaStreaming');
const { searchTokens } = require('../utils/programFinals');
const {
  ALL_ROLES,
  PRIVILEGED_ROLES,
  canEditProgramFinal,
  canViewPending,
  canViewProgramFinal,
  createProgramFinalDraft,
  getArchiveWarnings,
  idOf,
  populateProgramFinal,
  updateProgramFinalCredits,
  updateProgramFinalMetadata,
} = require('../services/programFinalService');
const { importFinalCandidate } = require('../services/finalWatchedFolderService');
const { enqueueDomainEvent } = require('../services/domainEventService');
const {
  purgeVersion,
  quarantineVersion,
  restoreVersion,
  runProgramFinalFixityCheck,
} = require('../services/programFinalProtectionService');
const { prepareProgramFinalTransfer } = require('../services/programFinalTransferService');
const {
  createProgramFinalMediaToken,
  hashProgramFinalMediaToken,
  resolveProgramFinalMedia,
} = require('../services/programFinalMediaService');

const router = express.Router();
const v2Router = express.Router();
const MEDIA_TICKET_TTL_MINUTES = Math.max(Number(process.env.PROGRAM_FINAL_TICKET_TTL_MINUTES || 120), 15);
const maximumBytes = Math.max(Number(process.env.MAX_PROGRAM_FINAL_SIZE_GB || 100), 1) * 1024 ** 3;
const workspaceStatuses = new Set([
  'draft',
  'waiting_for_file',
  'ingesting',
  'processing',
  'waiting_for_air',
  'ready_for_archive_review',
  'archived',
  'quarantined',
]);

const draftSchema = z.object({
  programTypeId: z.string().min(1),
  programId: z.string().min(1),
  airDate: z.string().min(10).max(40),
  airTime: z.string().min(4).max(8),
  editionLabel: z.string().max(160).optional(),
  title: z.string().min(1).max(500),
  showDayId: z.string().max(100).optional().nullable(),
  historical: z.boolean().optional(),
  credits: z.array(z.object({ personId: z.string(), roleId: z.string() })).min(1).max(100),
});

function parseDate(value, endOfDay = false) {
  const raw = String(value || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const date = new Date(`${raw}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function sanitizeVersion(version, { includeProtected = false } = {}) {
  if (!version) return null;
  const source = version.toObject ? version.toObject() : version;
  return {
    _id: source._id,
    versionNumber: source.versionNumber,
    originalFilename: source.originalFilename,
    size: source.size,
    sha256: includeProtected ? source.sha256 : undefined,
    codecMetadata: source.codecMetadata,
    ingestSource: source.ingestSource,
    status: source.status,
    replacementReason: source.replacementReason,
    proxy: {
      duration: source.proxy?.duration,
      scrubFrameCount: source.proxy?.scrubFrameCount,
      scrubWidth: source.proxy?.scrubWidth,
      scrubHeight: source.proxy?.scrubHeight,
      profileVersions: source.proxy?.profileVersions,
      encoder: source.proxy?.encoder,
      fallbackReason: source.proxy?.fallbackReason,
      size: source.proxy?.size,
      processingMs: source.proxy?.processingMs,
      error: source.proxy?.error,
      createdAt: source.proxy?.createdAt,
    },
    fixity: includeProtected ? source.fixity : undefined,
    quarantinedAt: includeProtected ? source.quarantinedAt : undefined,
    quarantineReason: includeProtected ? source.quarantineReason : undefined,
    statusBeforeQuarantine: includeProtected ? source.statusBeforeQuarantine : undefined,
    purgeEligibleAt: includeProtected ? source.purgeEligibleAt : undefined,
    createdAt: source.createdAt,
    activatedAt: source.activatedAt,
  };
}

function serializeProgramFinal(programFinal, user, versions = []) {
  const item = programFinal.toObject ? programFinal.toObject() : programFinal;
  const privileged = PRIVILEGED_ROLES.includes(user.role);
  const canEdit = canEditProgramFinal(programFinal, user);
  const canPending = canViewPending(programFinal, user);
  return {
    ...item,
    activeVersion: sanitizeVersion(item.activeVersion, { includeProtected: privileged }),
    pendingVersion: canPending ? sanitizeVersion(item.pendingVersion, { includeProtected: privileged }) : null,
    versions: privileged ? versions.map((version) => sanitizeVersion(version, { includeProtected: true })) : undefined,
    searchText: undefined,
    searchPrefixes: undefined,
    tombstone: privileged ? item.tombstone : undefined,
    permissions: {
      canEdit,
      canEditCredits: canEdit,
      canUpload: privileged,
      canArchive: privileged,
      canConfirmAir: ['Archivist', 'Admin', 'Realizator'].includes(user.role)
        && !item.showDay
        && !item.airedAt
        && item.status !== 'archived',
      canManageProtection: user.role === 'Admin',
      canViewPending: canPending,
      canDownload: false,
    },
  };
}

async function loadProgramFinal(id) {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  return populateProgramFinal(ProgramFinal.findById(id));
}

function privileged(req) {
  return PRIVILEGED_ROLES.includes(req.user.role);
}

function ensureAdmin(req, res, next) {
  if (req.user.role !== 'Admin') return res.status(403).json({ message: 'Samo Admin može izvršiti ovu akciju.' });
  next();
}

async function streamProgramFinalMedia(req, res) {
  try {
    const { filePath, extension } = await resolveProgramFinalMedia(req.params.token, req.params[0]);
    if (extension === '.mp4') {
      setDownloadHeaders(res, 'final-preview.mp4', { type: 'inline' });
      return sendFileWithRange(req, res, filePath, 'video/mp4');
    }
    const contentTypes = {
      '.m3u8': 'application/vnd.apple.mpegurl',
      '.ts': 'video/mp2t',
      '.jpg': 'image/jpeg',
    };
    res.setHeader('Content-Type', contentTypes[extension] || 'application/octet-stream');
    res.setHeader('Cache-Control', extension === '.m3u8' ? 'private, no-store' : 'private, max-age=3600, immutable');
    res.setHeader('Referrer-Policy', 'same-origin');
    fs.createReadStream(filePath).pipe(res);
  } catch (error) {
    if (!res.headersSent) res.status(error.statusCode || 500).json({ message: error.message });
  }
}

// HLS and MP4 proxy requests are authenticated by the short-lived ticket in the path.
router.get('/media/:token/*', streamProgramFinalMedia);

router.use(authenticateToken);
router.use(authorize(ALL_ROLES));

router.get('/workspace', async (req, res) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);
    const filter = {};
    const scope = String(req.query.scope || 'archive');
    if (!privileged(req) && !['Producer', 'Realizator'].includes(req.user.role)) {
      filter.status = { $in: ['archived', 'ready_for_archive_review', 'processing', 'waiting_for_air'] };
      filter.activeVersion = { $ne: null };
    } else if (scope === 'archive') {
      filter.activeVersion = { $ne: null };
      filter.status = { $in: ['archived', 'ready_for_archive_review', 'processing', 'waiting_for_air'] };
    } else if (scope === 'work') {
      filter.status = { $ne: 'archived' };
    }
    if (req.query.status && (privileged(req) || ['Producer', 'Realizator'].includes(req.user.role))) {
      const statuses = String(req.query.status).split(',').map((value) => value.trim()).filter(Boolean);
      if (!statuses.length || statuses.some((status) => !workspaceStatuses.has(status))) {
        return res.status(400).json({ message: 'Status filter nije ispravan.' });
      }
      filter.status = statuses.length === 1 ? statuses[0] : { $in: statuses };
    }
    if (mongoose.Types.ObjectId.isValid(req.query.programTypeId)) filter.programType = req.query.programTypeId;
    if (mongoose.Types.ObjectId.isValid(req.query.programId)) filter.program = req.query.programId;
    const personId = mongoose.Types.ObjectId.isValid(req.query.personId) ? req.query.personId : null;
    const roleId = mongoose.Types.ObjectId.isValid(req.query.roleId) ? req.query.roleId : null;
    if (personId && roleId) filter.credits = { $elemMatch: { person: personId, role: roleId } };
    else if (personId) filter['credits.person'] = personId;
    else if (roleId) filter['credits.role'] = roleId;
    if (req.query.airTime) filter.airTime = String(req.query.airTime);
    const from = parseDate(req.query.dateFrom);
    const to = parseDate(req.query.dateTo, true);
    if (from || to) filter.airDate = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
    const tokens = searchTokens(req.query.q);
    if (tokens.length) filter.searchPrefixes = { $all: tokens };

    if (req.user.role === 'Producer' && scope !== 'archive') {
      const assignedShowDays = await ShowDay.find({ producers: req.user.id }).distinct('_id');
      filter.$or = [
        { status: 'archived', activeVersion: { $ne: null } },
        { showDay: { $in: assignedShowDays } },
      ];
    }

    const [items, total, statusCounts, typeFacets] = await Promise.all([
      populateProgramFinal(ProgramFinal.find(filter).sort({ airDate: -1, airTime: -1 }).skip((page - 1) * limit).limit(limit)),
      ProgramFinal.countDocuments(filter),
      ProgramFinal.aggregate([{ $match: filter }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
      ProgramFinal.aggregate([{ $match: filter }, { $group: { _id: '$programType', count: { $sum: 1 } } }]),
    ]);
    res.json({
      items: items.filter((item) => canViewProgramFinal(item, req.user)).map((item) => serializeProgramFinal(item, req.user)),
      total,
      page,
      limit,
      totalPages: Math.max(Math.ceil(total / limit), 1),
      summary: Object.fromEntries(statusCounts.map((item) => [item._id, item.count])),
      facets: { programTypes: typeFacets },
    });
  } catch (error) {
    console.error('Program Final workspace failed:', error);
    res.status(500).json({ message: 'Finali emisija se ne mogu učitati.' });
  }
});

router.get('/ingest-candidates', authorize(['Archivist', 'Admin']), async (req, res) => {
  const page = Math.max(Number(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);
  const filter = req.query.status ? { status: req.query.status } : {};
  const [items, total] = await Promise.all([
    FinalIngestCandidate.find(filter)
      .populate('mediaNode', 'nodeId name status')
      .populate('mappedProgram', 'name slug')
      .populate('importedFinal', 'title status airDate airTime')
      .sort({ updatedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    FinalIngestCandidate.countDocuments(filter),
  ]);
  res.json({ items, total, page, limit, totalPages: Math.max(Math.ceil(total / limit), 1) });
});

router.post('/ingest-candidates/:candidateId/import', authorize(['Archivist', 'Admin']), async (req, res) => {
  try {
    const result = await importFinalCandidate(req.params.candidateId, {
      actorId: req.user.id,
      mapping: {
        programId: req.body?.programId,
        airDate: req.body?.airDate,
        airTime: req.body?.airTime,
        title: req.body?.title,
        editionLabel: req.body?.editionLabel,
        replacementReason: req.body?.replacementReason,
      },
    });
    res.json({ message: result.status === 'duplicate' ? 'Fajl je već evidentiran.' : 'Import je pokrenut.', ...result });
  } catch (error) {
    res.status(error.statusCode || 500).json({ message: error.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const item = await loadProgramFinal(req.params.id);
    if (!item || !canViewProgramFinal(item, req.user)) return res.status(404).json({ message: 'Final emisije nije pronađen.' });
    const versions = privileged(req)
      ? await ProgramFinalVersion.find({ programFinal: item._id }).sort({ versionNumber: -1 })
      : [];
    const programType = item.programType
      ? await ProgramType.findById(idOf(item.programType)).populate('recommendedRoles')
      : null;
    const pending = item.pendingVersion?._id ? item.pendingVersion : item.pendingVersion;
    res.json({
      item: serializeProgramFinal(item, req.user, versions),
      archiveWarnings: privileged(req) ? getArchiveWarnings(item, pending, programType) : [],
    });
  } catch (error) {
    res.status(500).json({ message: 'Detalji finala se ne mogu učitati.' });
  }
});

router.post('/', authorize(['Archivist', 'Admin']), async (req, res) => {
  const parsed = draftSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Podaci finala nisu potpuni.', issues: parsed.error.issues });
  try {
    const item = await createProgramFinalDraft(parsed.data, req.user);
    await AuditLog.create({
      action: 'Create Program Final Draft',
      performedBy: req.user.id,
      details: { programFinalId: item._id, programId: item.program, airDate: item.airDate, airTime: item.airTime },
    });
    res.status(201).json({ item: serializeProgramFinal(await loadProgramFinal(item._id), req.user) });
  } catch (error) {
    res.status(error.code === 11000 ? 409 : error.statusCode || 500).json({
      message: error.code === 11000 ? 'Final za isti program, datum, termin i izdanje već postoji.' : error.message,
    });
  }
});

router.patch('/:id/metadata', async (req, res) => {
  try {
    const item = await loadProgramFinal(req.params.id);
    if (!item) return res.status(404).json({ message: 'Final emisije nije pronađen.' });
    await updateProgramFinalMetadata(item, req.body || {}, req.user);
    await AuditLog.create({
      action: 'Update Program Final Metadata',
      performedBy: req.user.id,
      details: { programFinalId: item._id, fields: Object.keys(req.body || {}) },
    });
    res.json({ item: serializeProgramFinal(await loadProgramFinal(item._id), req.user) });
  } catch (error) {
    res.status(error.code === 11000 ? 409 : error.statusCode || 500).json({ message: error.message });
  }
});

router.put('/:id/credits', async (req, res) => {
  try {
    const item = await loadProgramFinal(req.params.id);
    if (!item) return res.status(404).json({ message: 'Final emisije nije pronađen.' });
    await updateProgramFinalCredits(item, req.body?.credits || [], req.user);
    await AuditLog.create({
      action: 'Update Program Final Credits',
      performedBy: req.user.id,
      details: { programFinalId: item._id, creditsCount: item.credits.length },
    });
    res.json({ item: serializeProgramFinal(await loadProgramFinal(item._id), req.user) });
  } catch (error) {
    res.status(error.statusCode || 500).json({ message: error.message });
  }
});

router.post('/:id/media-ticket', async (req, res) => {
  try {
    const item = await loadProgramFinal(req.params.id);
    if (!item || !canViewProgramFinal(item, req.user)) return res.status(404).json({ message: 'Final emisije nije pronađen.' });
    const requestedVersionId = req.body?.versionId;
    let versionId = idOf(item.activeVersion);
    if (requestedVersionId) {
      const requested = String(requestedVersionId);
      const isOperationalVersion = [idOf(item.activeVersion), idOf(item.pendingVersion)].filter(Boolean).includes(requested);
      if (privileged(req)) versionId = requested;
      else if (canViewPending(item, req.user) && isOperationalVersion) versionId = requested;
      else return res.status(403).json({ message: 'Pristup traženoj verziji nije dozvoljen.' });
    }
    if (!versionId) versionId = idOf(item.pendingVersion);
    const version = await ProgramFinalVersion.findOne({
      _id: versionId,
      programFinal: item._id,
      status: { $in: ['ready', 'active', 'superseded'] },
    });
    if (!version?.proxy?.hlsMaster) return res.status(409).json({ message: 'Zaštićeni preview još nije spreman.' });
    const token = createProgramFinalMediaToken();
    const expiresAt = new Date(Date.now() + MEDIA_TICKET_TTL_MINUTES * 60 * 1000);
    const ticket = await ProgramFinalMediaTicket.create({
      tokenHash: hashProgramFinalMediaToken(token),
      createdBy: req.user.id,
      programFinal: item._id,
      version: version._id,
      expiresAt,
    });
    const mediaNode = version.mediaNode ? await MediaNode.findById(version.mediaNode).select('baseUrl') : null;
    const baseUrl = mediaNode?.baseUrl
      ? `${mediaNode.baseUrl.replace(/\/$/, '')}/api/edge/program-finals/${token}`
      : `/api/program-finals/media/${token}`;
    res.status(201).json({
      ticketId: ticket._id,
      versionId: version._id,
      manifestUrl: `${baseUrl}/${version.proxy.hlsMaster}`,
      fallbackUrl: version.proxy.accessMp4 ? `${baseUrl}/${version.proxy.accessMp4}` : '',
      thumbnailUrl: version.proxy.thumbnail ? `${baseUrl}/${version.proxy.thumbnail}` : '',
      scrubManifest: version.proxy.scrubFrameCount ? {
        frameCount: version.proxy.scrubFrameCount,
        frameWidth: version.proxy.scrubWidth,
        frameHeight: version.proxy.scrubHeight,
        duration: version.proxy.duration,
        frameUrlTemplate: `${baseUrl}/${version.proxy.scrubFolder}/frame-{index}.jpg`,
      } : null,
      expiresAt,
      hlsAvailable: true,
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ message: error.message });
  }
});

router.post('/:id/air-confirmation', authorize(['Archivist', 'Admin', 'Realizator']), async (req, res) => {
  try {
    const item = await loadProgramFinal(req.params.id);
    if (!item) return res.status(404).json({ message: 'Final emisije nije pronađen.' });
    if (item.showDay) {
      return res.status(409).json({ message: 'Emitovanje povezanog izdanja potvrđuje se kroz rundown.' });
    }
    if (item.status === 'archived') {
      return res.status(409).json({ message: 'Arhivirani final je zaključan.' });
    }
    if (!item.airedAt) {
      item.airedAt = new Date();
      item.airedBy = req.user.id;
      const pending = item.pendingVersion
        ? await ProgramFinalVersion.findById(idOf(item.pendingVersion))
        : null;
      if (pending?.status === 'ready') item.status = 'ready_for_archive_review';
      else if (!pending || pending.status === 'failed') item.status = 'waiting_for_file';
      item.updatedBy = req.user.id;
      await item.save();
      await AuditLog.create({
        action: 'Confirm Historical Program Final Aired',
        performedBy: req.user.id,
        details: { programFinalId: item._id, pendingVersionId: pending?._id || null },
      });
      await enqueueDomainEvent({
        type: pending?.status === 'ready'
          ? 'program_final.ready_for_archive_review'
          : 'program_final.missing_after_air',
        severity: 'action_required',
        actor: req.user.id,
        recipientRoles: ['Archivist'],
        entityType: 'program_final',
        entityId: item._id,
        entityVersion: pending?.versionNumber || item.versionSequence,
        title: pending?.status === 'ready' ? 'Final čeka arhivski pregled' : 'Nedostaje final emisije',
        bodyPreview: `${item.title} · ${item.airTime}`,
        deepLink: `vca://program-final/${item._id}`,
        payload: { programFinalId: item._id, versionId: pending?._id || null },
        dedupeKey: `program-final:manual-air:${item._id}:${pending?._id || 'missing'}`,
      });
    }
    return res.json({ item: serializeProgramFinal(await loadProgramFinal(item._id), req.user) });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ message: error.message });
  }
});

router.post('/:id/archive-confirmation', authorize(['Archivist', 'Admin']), async (req, res) => {
  try {
    const item = await loadProgramFinal(req.params.id);
    if (!item) return res.status(404).json({ message: 'Final emisije nije pronađen.' });
    const version = await ProgramFinalVersion.findById(idOf(item.pendingVersion));
    if (!version || version.status !== 'ready' || idOf(version.programFinal) !== idOf(item)) {
      return res.status(409).json({ message: 'Pending verzija nije spremna za arhiviranje.' });
    }
    const programType = item.programType
      ? await ProgramType.findById(idOf(item.programType)).populate('recommendedRoles')
      : null;
    const warnings = getArchiveWarnings(item, version, programType);
    const blocking = warnings.filter((warning) => warning.blocking);
    if (blocking.length) return res.status(409).json({ message: 'Final još nije spreman za arhiviranje.', warnings });
    if (warnings.length && req.body?.overrideWarnings !== true) {
      return res.status(409).json({ message: 'Potrebna je potvrda arhivskih upozorenja.', warnings });
    }
    const overrideReason = String(req.body?.overrideReason || '').trim();
    if (warnings.length && overrideReason.length < 5) {
      return res.status(400).json({ message: 'Kratko obrazloženje je obavezno kada upozorenja ostaju otvorena.' });
    }
    const previousActiveVersionId = idOf(item.activeVersion);
    version.status = 'active';
    version.activatedAt = new Date();
    version.activatedBy = req.user.id;
    await version.save();
    const archivedAt = new Date();
    const activation = await ProgramFinal.updateOne(
      {
        _id: item._id,
        pendingVersion: version._id,
        status: 'ready_for_archive_review',
      },
      {
        $set: {
          activeVersion: version._id,
          pendingVersion: null,
          status: 'archived',
          archiveConfirmedAt: archivedAt,
          archiveConfirmedBy: req.user.id,
          archiveWarnings: warnings.map((warning) => warning.code),
          archiveOverrideReason: overrideReason,
          updatedBy: req.user.id,
        },
      }
    );
    if (activation.modifiedCount !== 1) {
      const current = await ProgramFinal.findById(item._id).select('status activeVersion');
      if (current?.status === 'archived' && idOf(current.activeVersion) === idOf(version)) {
        return res.json({ item: serializeProgramFinal(await loadProgramFinal(item._id), req.user) });
      }
      await ProgramFinalVersion.updateOne(
        { _id: version._id, status: 'active', activatedBy: req.user.id },
        { $set: { status: 'ready', activatedAt: null, activatedBy: null } }
      );
      return res.status(409).json({ message: 'Final je u međuvremenu promijenjen. Osvježi pregled.' });
    }
    if (previousActiveVersionId && previousActiveVersionId !== idOf(version)) {
      await ProgramFinalVersion.updateOne(
        { _id: previousActiveVersionId, status: 'active' },
        { $set: { status: 'superseded' } }
      );
    }
    await AuditLog.create({
      action: 'Archive Program Final',
      performedBy: req.user.id,
      details: {
        programFinalId: item._id,
        versionId: version._id,
        versionNumber: version.versionNumber,
        warnings: warnings.map((warning) => warning.code),
        overrideReason,
        sha256: version.sha256,
      },
    });
    await enqueueDomainEvent({
      type: 'program_final.archived',
      severity: 'info',
      actor: req.user.id,
      recipients: [
        ...(item.showDay?.producers || []).map(idOf),
        idOf(item.airedBy),
      ].filter(Boolean),
      recipientRoles: ['Archivist', 'Admin'],
      entityType: 'program_final',
      entityId: item._id,
      entityVersion: version.versionNumber,
      title: 'Final emisije je arhiviran',
      bodyPreview: `${item.title} · ${item.airTime}`,
      deepLink: `vca://program-final/${item._id}`,
      payload: { programFinalId: item._id, versionId: version._id },
      dedupeKey: `program-final:archived:${version._id}`,
    });
    res.json({ item: serializeProgramFinal(await loadProgramFinal(item._id), req.user) });
  } catch (error) {
    res.status(error.statusCode || 500).json({ message: error.message });
  }
});

router.post('/:id/versions/:versionId/quarantine', ensureAdmin, async (req, res) => {
  try {
    const version = await ProgramFinalVersion.findOne({ _id: req.params.versionId, programFinal: req.params.id });
    if (!version) return res.status(404).json({ message: 'Verzija finala nije pronađena.' });
    const result = await quarantineVersion(version, {
      actorId: req.user.id,
      reason: req.body?.reason,
      source: 'admin',
    });
    res.json({ item: serializeProgramFinal(await loadProgramFinal(result.programFinal._id), req.user) });
  } catch (error) {
    res.status(error.statusCode || 500).json({ message: error.message });
  }
});

router.post('/:id/versions/:versionId/restore', ensureAdmin, async (req, res) => {
  try {
    const version = await ProgramFinalVersion.findOne({ _id: req.params.versionId, programFinal: req.params.id });
    if (!version) return res.status(404).json({ message: 'Verzija finala nije pronađena.' });
    const result = await restoreVersion(version, { actorId: req.user.id, reason: req.body?.reason });
    res.json({ item: serializeProgramFinal(await loadProgramFinal(result.programFinal._id), req.user) });
  } catch (error) {
    res.status(error.statusCode || 500).json({ message: error.message });
  }
});

router.post('/:id/versions/:versionId/purge', ensureAdmin, async (req, res) => {
  try {
    const version = await ProgramFinalVersion.findOne({ _id: req.params.versionId, programFinal: req.params.id });
    if (!version) return res.status(404).json({ message: 'Verzija finala nije pronađena.' });
    const result = await purgeVersion(version, {
      actorId: req.user.id,
      confirmation: req.body?.confirmation,
      reason: req.body?.reason,
    });
    res.json({ item: serializeProgramFinal(await loadProgramFinal(result.programFinal._id), req.user) });
  } catch (error) {
    res.status(error.statusCode || 500).json({ message: error.message });
  }
});

router.post('/maintenance/fixity/run', ensureAdmin, async (req, res) => {
  try {
    res.json(await runProgramFinalFixityCheck({ force: true, actorId: req.user.id }));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

v2Router.use(authenticateToken);
v2Router.use(authorize(['Archivist', 'Admin']));
v2Router.post('/:id/upload-session', async (req, res) => {
  try {
    const originalFilename = String(req.body?.originalFilename || '').trim();
    const totalBytes = Number(req.body?.totalBytes);
    const idempotencyKey = String(req.body?.idempotencyKey || '').trim();
    if (idempotencyKey.length < 8 || !originalFilename || !Number.isInteger(totalBytes) || totalBytes <= 0 || totalBytes > maximumBytes) {
      return res.status(400).json({ message: 'Podaci resumable uploada nisu ispravni.' });
    }
    if (!allowedVideoExtensions.includes(path.extname(originalFilename).toLowerCase())) {
      return res.status(400).json({ message: 'Format finalnog mastera nije podržan.' });
    }
    const result = await prepareProgramFinalTransfer({
      user: req.user,
      programFinalId: req.params.id,
      idempotencyKey,
      originalFilename,
      totalBytes,
      replacementReason: req.body?.replacementReason,
    });
    res.status(result.existing ? 200 : 201).json({
      transferId: result.transfer.transferId,
      programFinalId: result.transfer.entityId,
      status: result.transfer.status,
      resumableUrl: result.transfer.resumableUrl,
      authorization: result.authorization,
      expiresAt: result.transfer.expiresAt,
      existing: result.existing,
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ message: error.message });
  }
});

module.exports = { router, v2Router };
