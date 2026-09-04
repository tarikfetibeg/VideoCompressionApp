const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const AuditLog = require('../models/AuditLog');
const ProgramFinal = require('../models/ProgramFinal');
const ProgramFinalVersion = require('../models/ProgramFinalVersion');
const { enqueueProgramFinalProcessing } = require('../queues/programFinalQueue');
const { ensureFolderExists, paths, sanitizeFileName } = require('../utils/storagePaths');
const { resolveSafeRelativePath, safeRelativePath } = require('../utils/programFinals');

function statusError(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', resolve);
    stream.on('error', reject);
  });
  return hash.digest('hex');
}

async function copyAndVerify(sourcePath, targetPath, expectedHash) {
  const temporaryPath = `${targetPath}.copying-${crypto.randomBytes(4).toString('hex')}`;
  ensureFolderExists(path.dirname(targetPath));
  try {
    await fs.promises.copyFile(sourcePath, temporaryPath, fs.constants.COPYFILE_EXCL);
    const copiedHash = await sha256File(temporaryPath);
    if (copiedHash !== expectedHash) throw new Error('Checksum kopiranog mastera se ne podudara sa izvorom.');
    await fs.promises.rename(temporaryPath, targetPath);
  } catch (error) {
    await fs.promises.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function reserveVersionNumber(programFinalId) {
  const programFinal = await ProgramFinal.findOneAndUpdate(
    { _id: programFinalId },
    { $inc: { versionSequence: 1 }, $set: { status: 'ingesting' } },
    { new: true }
  );
  if (!programFinal) throw statusError('Final emisije nije pronađen.', 404);
  return programFinal;
}

async function ingestProgramFinalMaster({
  programFinalId,
  sourcePath,
  originalFilename,
  ingestSource,
  actorId = null,
  mediaNodeId = null,
  sourceCandidateId = null,
  replacementReason = '',
  removeSourceAfterCopy = false,
}) {
  const source = path.resolve(sourcePath);
  const stats = await fs.promises.stat(source).catch(() => null);
  if (!stats?.isFile()) throw statusError('Izvorni master nije pronađen.', 404);
  const checksum = await sha256File(source);
  const sameFinalVersion = await ProgramFinalVersion.findOne({
    programFinal: programFinalId,
    sha256: checksum,
    status: { $nin: ['purged', 'failed'] },
  });
  if (sameFinalVersion) {
    if (removeSourceAfterCopy) await fs.promises.rm(source, { force: true }).catch(() => {});
    return { duplicate: true, version: sameFinalVersion, checksum };
  }

  const programFinal = await reserveVersionNumber(programFinalId);
  const versionNumber = programFinal.versionSequence;
  let masterRelativePath = '';
  let sharedFromVersion = null;
  let version = null;

  try {
    const sharedVersion = await ProgramFinalVersion.findOne({
      sha256: checksum,
      status: { $nin: ['purged', 'failed'] },
    }).sort({ createdAt: 1 });

    if (sharedVersion) {
      const sharedPath = resolveSafeRelativePath(paths.root, sharedVersion.masterRelativePath);
      if (sharedPath && fs.existsSync(sharedPath)) {
        masterRelativePath = sharedVersion.masterRelativePath;
        sharedFromVersion = sharedVersion._id;
      }
    }

    if (!masterRelativePath) {
      const safe = sanitizeFileName(originalFilename || path.basename(source));
      const storedName = `v${String(versionNumber).padStart(3, '0')}_${safe.baseName}${safe.extension}`;
      const target = path.join(paths.programFinalMasters, String(programFinal._id), storedName);
      await copyAndVerify(source, target, checksum);
      masterRelativePath = safeRelativePath(paths.root, target);
    }

    version = await ProgramFinalVersion.create({
      programFinal: programFinal._id,
      versionNumber,
      originalFilename: String(originalFilename || path.basename(source)).slice(0, 500),
      masterRelativePath,
      mediaNode: mediaNodeId || null,
      size: stats.size,
      sha256: checksum,
      sharedFromVersion,
      ingestSource,
      sourceCandidate: sourceCandidateId || null,
      replacementReason: String(replacementReason || '').trim(),
      status: 'processing',
      createdBy: actorId,
    });

    programFinal.pendingVersion = version._id;
    programFinal.status = 'processing';
    programFinal.updatedBy = actorId || programFinal.updatedBy;
    await programFinal.save();
  } catch (error) {
    if (version) {
      version.status = 'failed';
      version.proxy.error = error.message;
      await version.save().catch(() => {});
    }
    programFinal.status = programFinal.activeVersion ? 'archived' : 'waiting_for_file';
    await programFinal.save().catch(() => {});
    throw error;
  }

  try {
    await enqueueProgramFinalProcessing(version._id);
  } catch (error) {
    version.status = 'failed';
    version.proxy.error = error.message;
    await version.save();
    programFinal.status = programFinal.activeVersion ? 'archived' : 'waiting_for_file';
    await programFinal.save();
    throw error;
  } finally {
    if (removeSourceAfterCopy) await fs.promises.rm(source, { force: true }).catch(() => {});
  }

  if (actorId) {
    await AuditLog.create({
      action: 'Ingest Program Final Master',
      performedBy: actorId,
      details: {
        programFinalId: programFinal._id,
        versionId: version._id,
        versionNumber,
        ingestSource,
        filename: version.originalFilename,
        size: version.size,
        sha256: checksum,
        sharedFromVersion,
      },
    });
  }
  return { duplicate: false, programFinal, version, checksum };
}

module.exports = {
  copyAndVerify,
  ingestProgramFinalMaster,
  sha256File,
};
