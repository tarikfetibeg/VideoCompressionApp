const fs = require('fs');
const path = require('path');
const AuditLog = require('../models/AuditLog');
const ProgramFinal = require('../models/ProgramFinal');
const ProgramFinalVersion = require('../models/ProgramFinalVersion');
const { enqueueDomainEvent } = require('./domainEventService');
const { sha256File } = require('./programFinalIngestService');
const { paths, ensureFolderExists } = require('../utils/storagePaths');
const { isPathInside, resolveSafeRelativePath, safeRelativePath } = require('../utils/programFinals');

const QUARANTINE_DAYS = Math.max(Number(process.env.PROGRAM_FINAL_QUARANTINE_DAYS || 30), 1);

function statusError(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

async function quarantineVersion(versionOrId, { actorId = null, reason, source = 'admin', computedHash = '' }) {
  const version = typeof versionOrId === 'object' ? versionOrId : await ProgramFinalVersion.findById(versionOrId);
  if (!version) throw statusError('Verzija finala nije pronađena.', 404);
  if (version.status === 'purged') throw statusError('Obrisana verzija se ne može staviti u karantin.', 409);
  if (version.status === 'quarantined') throw statusError('Verzija je već u karantinu.', 409);
  if (!['ready', 'active', 'superseded'].includes(version.status)) {
    throw statusError('Karantin je dostupan tek nakon završene obrade proxyja.', 409);
  }
  const normalizedReason = String(reason || '').trim();
  if (normalizedReason.length < 5) throw statusError('Razlog karantina mora imati najmanje 5 znakova.');
  const programFinal = await ProgramFinal.findById(version.programFinal);
  if (!programFinal) throw statusError('Final emisije nije pronađen.', 404);
  const originalPath = resolveSafeRelativePath(paths.root, version.masterRelativePath);
  if (originalPath && fs.existsSync(originalPath) && !isPathInside(paths.programFinalQuarantine, originalPath)) {
    const quarantineFolder = path.join(paths.programFinalQuarantine, String(version._id));
    ensureFolderExists(quarantineFolder);
    const quarantinePath = path.join(quarantineFolder, path.basename(originalPath));
    const otherReferences = await ProgramFinalVersion.countDocuments({
      _id: { $ne: version._id },
      masterRelativePath: version.masterRelativePath,
      status: { $ne: 'purged' },
    });
    version.quarantineOriginalRelativePath = version.masterRelativePath;
    if (otherReferences > 0) {
      await fs.promises.copyFile(originalPath, quarantinePath);
    } else {
      await fs.promises.rename(originalPath, quarantinePath).catch(async (error) => {
        if (error.code !== 'EXDEV') throw error;
        await fs.promises.copyFile(originalPath, quarantinePath);
        await fs.promises.rm(originalPath, { force: true });
      });
    }
    version.masterRelativePath = safeRelativePath(paths.root, quarantinePath);
  }
  version.statusBeforeQuarantine = version.status;
  version.status = 'quarantined';
  version.quarantinedAt = new Date();
  version.quarantinedBy = actorId;
  version.quarantineReason = normalizedReason;
  version.purgeEligibleAt = new Date(Date.now() + QUARANTINE_DAYS * 24 * 60 * 60 * 1000);
  if (computedHash) {
    version.fixity.lastComputedHash = computedHash;
    version.fixity.lastResult = 'mismatch';
    version.fixity.lastCheckedAt = new Date();
  }
  await version.save();
  const activeVersion = String(programFinal.activeVersion || '') === String(version._id);
  const pendingVersion = String(programFinal.pendingVersion || '') === String(version._id);
  if (activeVersion || (pendingVersion && !programFinal.activeVersion)) programFinal.status = 'quarantined';
  else if (pendingVersion && programFinal.activeVersion) programFinal.status = 'archived';
  await programFinal.save();

  await AuditLog.create({
    action: 'Quarantine Program Final Version',
    performedBy: actorId || null,
    systemSource: actorId ? '' : 'program-final-fixity',
    details: {
      programFinalId: programFinal._id,
      versionId: version._id,
      reason: normalizedReason,
      source,
      expectedSha256: version.sha256,
      computedSha256: computedHash || '',
    },
  });
  await enqueueDomainEvent({
    type: source === 'fixity' ? 'program_final.fixity_mismatch' : 'program_final.quarantined',
    severity: 'critical',
    actor: actorId,
    recipientRoles: ['Archivist', 'Admin'],
    entityType: 'program_final',
    entityId: programFinal._id,
    entityVersion: version.versionNumber,
    title: source === 'fixity' ? 'Integritet finalnog mastera je narušen' : 'Final je stavljen u karantin',
    bodyPreview: `${programFinal.title}: ${normalizedReason}`,
    deepLink: `vca://program-final/${programFinal._id}`,
    payload: { programFinalId: programFinal._id, versionId: version._id, reason: normalizedReason },
    dedupeKey: `program-final:quarantine:${version._id}:${version.quarantinedAt.getTime()}`,
  });
  return { programFinal, version };
}

async function restoreVersion(versionOrId, { actorId, reason }) {
  const version = typeof versionOrId === 'object'
    ? versionOrId
    : await ProgramFinalVersion.findById(versionOrId);
  if (!version || version.status !== 'quarantined') throw statusError('Verzija nije u karantinu.', 409);
  const normalizedReason = String(reason || '').trim();
  if (normalizedReason.length < 5) throw statusError('Razlog vraćanja mora imati najmanje 5 znakova.');
  const currentPath = resolveSafeRelativePath(paths.root, version.masterRelativePath);
  const originalPath = resolveSafeRelativePath(paths.root, version.quarantineOriginalRelativePath);
  if (!currentPath || !fs.existsSync(currentPath) || !originalPath || !isPathInside(paths.programFinalMasters, originalPath)) {
    throw statusError('Master nije moguće sigurno vratiti iz karantina.', 409);
  }
  ensureFolderExists(path.dirname(originalPath));
  if (!fs.existsSync(originalPath)) {
    await fs.promises.rename(currentPath, originalPath).catch(async (error) => {
      if (error.code !== 'EXDEV') throw error;
      await fs.promises.copyFile(currentPath, originalPath);
      await fs.promises.rm(currentPath, { force: true });
    });
  } else if (currentPath !== originalPath) {
    const [existingHash, quarantineHash] = await Promise.all([
      sha256File(originalPath),
      sha256File(currentPath),
    ]);
    if (existingHash !== version.sha256 || quarantineHash !== version.sha256) {
      throw statusError('Master u karantinu ili postojeći dijeljeni master nema očekivani checksum.', 409);
    }
    await fs.promises.rm(currentPath, { force: true });
  }
  const programFinal = await ProgramFinal.findById(version.programFinal);
  const restoredStatus = version.statusBeforeQuarantine
    || (String(programFinal?.activeVersion || '') === String(version._id)
      ? 'active'
      : (String(programFinal?.pendingVersion || '') === String(version._id)
        ? 'ready'
        : (version.activatedAt ? 'superseded' : 'ready')));
  version.masterRelativePath = version.quarantineOriginalRelativePath;
  version.quarantineOriginalRelativePath = '';
  version.status = restoredStatus;
  version.statusBeforeQuarantine = '';
  version.quarantinedAt = null;
  version.quarantinedBy = null;
  version.quarantineReason = '';
  version.purgeEligibleAt = null;
  await version.save();
  if (String(programFinal?.activeVersion || '') === String(version._id)) programFinal.status = 'archived';
  else if (String(programFinal?.pendingVersion || '') === String(version._id)) {
    programFinal.status = programFinal.airedAt ? 'ready_for_archive_review' : 'waiting_for_air';
  }
  await programFinal?.save();
  await AuditLog.create({
    action: 'Restore Program Final Version',
    performedBy: actorId,
    details: { programFinalId: programFinal?._id, versionId: version._id, reason: normalizedReason },
  });
  return { programFinal, version };
}

async function purgeVersion(versionOrId, { actorId, confirmation, reason }) {
  const version = typeof versionOrId === 'object'
    ? versionOrId
    : await ProgramFinalVersion.findById(versionOrId);
  if (!version || version.status !== 'quarantined') throw statusError('Samo verzija u karantinu može biti trajno uklonjena.', 409);
  if (!version.purgeEligibleAt || version.purgeEligibleAt > new Date()) {
    throw statusError('Obavezni period karantina još nije istekao.', 409);
  }
  const programFinal = await ProgramFinal.findById(version.programFinal);
  const expected = [String(programFinal?._id || ''), String(programFinal?.title || '').trim()];
  if (!expected.includes(String(confirmation || '').trim())) {
    throw statusError('Potvrda ne odgovara ID-u ili naslovu finala.');
  }
  const normalizedReason = String(reason || '').trim();
  if (normalizedReason.length < 5) throw statusError('Razlog trajnog uklanjanja mora imati najmanje 5 znakova.');
  const masterPath = resolveSafeRelativePath(paths.root, version.masterRelativePath);
  const otherReferences = await ProgramFinalVersion.countDocuments({
    _id: { $ne: version._id },
    masterRelativePath: version.masterRelativePath,
    status: { $ne: 'purged' },
  });
  if (masterPath && isPathInside(paths.programFinalQuarantine, masterPath) && otherReferences === 0) {
    await fs.promises.rm(masterPath, { force: true });
  }
  const proxyRelativePath = String(version.proxy?.rootRelativePath || '').trim();
  const proxyRoot = proxyRelativePath
    ? resolveSafeRelativePath(paths.programFinalPreviews, proxyRelativePath)
    : null;
  if (
    proxyRoot
    && path.resolve(proxyRoot) !== path.resolve(paths.programFinalPreviews)
    && isPathInside(paths.programFinalPreviews, proxyRoot)
  ) {
    await fs.promises.rm(proxyRoot, { recursive: true, force: true });
  }
  version.status = 'purged';
  version.purgedAt = new Date();
  version.purgedBy = actorId;
  version.proxy = {};
  await version.save();
  if (programFinal) {
    if (String(programFinal.activeVersion || '') === String(version._id)) programFinal.activeVersion = null;
    if (String(programFinal.pendingVersion || '') === String(version._id)) programFinal.pendingVersion = null;
    programFinal.status = programFinal.activeVersion ? 'archived' : 'waiting_for_file';
    programFinal.tombstone = {
      purgedAt: version.purgedAt,
      purgedBy: actorId,
      reason: normalizedReason,
      checksum: version.sha256,
    };
    await programFinal.save();
  }
  await AuditLog.create({
    action: 'Purge Program Final Version',
    performedBy: actorId,
    details: {
      programFinalId: programFinal?._id,
      versionId: version._id,
      sha256: version.sha256,
      reason: normalizedReason,
      masterDeleted: otherReferences === 0,
    },
  });
  return { programFinal, version };
}

async function verifyVersionFixity(version, { actorId = null } = {}) {
  const masterPath = resolveSafeRelativePath(paths.root, version.masterRelativePath);
  if (!masterPath || !fs.existsSync(masterPath)) {
    version.fixity = { algorithm: 'sha256', lastCheckedAt: new Date(), lastResult: 'missing', error: 'Master nije pronađen.' };
    await version.save();
    return quarantineVersion(version, {
      actorId,
      reason: 'Master fajl nedostaje tokom fixity provjere.',
      source: 'fixity',
    });
  }
  try {
    const computedHash = await sha256File(masterPath);
    if (computedHash !== version.sha256) {
      return quarantineVersion(version, {
        actorId,
        reason: 'SHA-256 checksum se ne podudara sa evidentiranim masterom.',
        source: 'fixity',
        computedHash,
      });
    }
    version.fixity = {
      algorithm: 'sha256',
      lastCheckedAt: new Date(),
      lastResult: 'ok',
      lastComputedHash: computedHash,
      error: '',
    };
    await version.save();
    await AuditLog.create({
      action: 'Verify Program Final Fixity',
      performedBy: actorId || null,
      systemSource: actorId ? '' : 'program-final-fixity',
      details: {
        programFinalId: version.programFinal,
        versionId: version._id,
        result: 'ok',
        sha256: computedHash,
      },
    });
    return { version, ok: true };
  } catch (error) {
    version.fixity = {
      algorithm: 'sha256',
      lastCheckedAt: new Date(),
      lastResult: 'error',
      lastComputedHash: '',
      error: error.message,
    };
    await version.save();
    throw error;
  }
}

async function runProgramFinalFixityCheck({ force = false, actorId = null } = {}) {
  const now = new Date();
  const configuredHour = Math.min(Math.max(Number(process.env.PROGRAM_FINAL_FIXITY_HOUR || 3), 0), 23);
  if (!force && now.getHours() !== configuredHour) return { skipped: true, reason: 'outside_window' };
  if (!force) {
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    const alreadyCheckedToday = await ProgramFinalVersion.exists({
      'fixity.lastCheckedAt': { $gte: dayStart },
    });
    if (alreadyCheckedToday) return { skipped: true, reason: 'daily_limit' };
  }
  const previousDay = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const version = await ProgramFinalVersion.findOne({
    status: { $in: ['ready', 'active', 'superseded'] },
    $or: [
      { 'fixity.lastCheckedAt': null },
      { 'fixity.lastCheckedAt': { $lte: previousDay } },
    ],
  }).sort({ 'fixity.lastCheckedAt': 1, createdAt: 1 });
  if (!version) return { checked: 0 };
  const result = await verifyVersionFixity(version, { actorId });
  return { checked: 1, versionId: version._id, ok: result.ok === true };
}

module.exports = {
  QUARANTINE_DAYS,
  purgeVersion,
  quarantineVersion,
  restoreVersion,
  runProgramFinalFixityCheck,
  verifyVersionFixity,
};
