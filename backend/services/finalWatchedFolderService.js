const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const BroadcastProgram = require('../models/BroadcastProgram');
const FinalIngestCandidate = require('../models/FinalIngestCandidate');
const MediaNode = require('../models/MediaNode');
const ProductionPerson = require('../models/ProductionPerson');
const ProductionRole = require('../models/ProductionRole');
const ProgramFinal = require('../models/ProgramFinal');
const ShowDay = require('../models/ShowDay');
const { allowedVideoExtensions } = require('../config/mediaFormats');
const { ensureProgramFinalDefaults, ensureBroadcastProgramSlugs } = require('./programFinalCatalogService');
const { ingestProgramFinalMaster } = require('./programFinalIngestService');
const { refreshSearchFields } = require('./programFinalService');
const { paths, ensureFolderExists } = require('../utils/storagePaths');
const {
  buildEditionKey,
  normalizeAirDate,
  normalizeAirTime,
  normalizeText,
  parseWatchedFinalFilename,
  slugify,
} = require('../utils/programFinals');

const observedFiles = new Map();
let activeScan = null;
let catalogPreparation = null;

function watchedRoot() {
  return path.resolve(process.env.FINAL_PROGRAM_WATCH_ROOT || paths.programFinalInbox);
}

function prepareCatalog() {
  if (!catalogPreparation) {
    catalogPreparation = ensureBroadcastProgramSlugs().catch((error) => {
      catalogPreparation = null;
      throw error;
    });
  }
  return catalogPreparation;
}

function stableMs() {
  return Math.max(Number(process.env.FINAL_PROGRAM_STABLE_SECONDS || 60), 10) * 1000;
}

function candidateKey(nodeId, filePath) {
  return crypto.createHash('sha256').update(`${nodeId}:${path.resolve(filePath).toLowerCase()}`).digest('hex');
}

async function readSidecar(filePath) {
  const sidecarPath = `${filePath.slice(0, -path.extname(filePath).length)}.json`;
  if (!fs.existsSync(sidecarPath)) return { data: {}, path: '' };
  try {
    return { data: JSON.parse(await fs.promises.readFile(sidecarPath, 'utf8')), path: sidecarPath };
  } catch (error) {
    return { data: {}, path: sidecarPath, error: `JSON sidecar nije ispravan: ${error.message}` };
  }
}

function parsedCandidate(filename, sidecar = {}) {
  const fromName = parseWatchedFinalFilename(filename) || {};
  const airDate = String(sidecar.airDate || sidecar.date || fromName.airDate || '').slice(0, 10);
  const airTime = normalizeAirTime(sidecar.airTime || sidecar.time || fromName.airTime);
  return {
    programSlug: slugify(sidecar.programSlug || sidecar.program || fromName.programSlug || ''),
    airDate: normalizeAirDate(airDate) ? airDate : '',
    airTime,
    title: String(sidecar.title || fromName.title || '').trim(),
    editionLabel: String(sidecar.editionLabel || fromName.editionLabel || '').trim(),
  };
}

async function creditsFromSidecar(sidecar) {
  const values = Array.isArray(sidecar?.credits) ? sidecar.credits : [];
  if (!values.length) return [];
  await ensureProgramFinalDefaults();
  const result = [];
  for (const entry of values) {
    const personName = String(entry.name || entry.person || '').trim();
    const roleSlug = slugify(entry.roleSlug || entry.role || '');
    if (!personName || !roleSlug) continue;
    const role = await ProductionRole.findOne({ slug: roleSlug, active: true });
    if (!role) continue;
    const person = await ProductionPerson.findOneAndUpdate(
      { normalizedName: normalizeText(personName) },
      { $setOnInsert: { name: personName, normalizedName: normalizeText(personName), active: true } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    result.push({
      person: person._id,
      role: role._id,
      personNameSnapshot: person.name,
      roleNameSnapshot: role.name,
    });
  }
  return result;
}

async function findShowDay(programId, airDate) {
  const start = normalizeAirDate(airDate);
  if (!start) return null;
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return ShowDay.findOne({ program: programId, airDate: { $gte: start, $lt: end } });
}

async function ensureLogicalFinal(candidate, input = {}) {
  const parsed = { ...(candidate.parsed?.toObject?.() || candidate.parsed || {}), ...input };
  const program = input.programId
    ? await BroadcastProgram.findById(input.programId)
    : await BroadcastProgram.findOne({ slug: parsed.programSlug, active: true });
  if (!program || !parsed.airDate || !parsed.airTime) return null;
  const airDate = normalizeAirDate(parsed.airDate);
  const editionKey = buildEditionKey(parsed.editionLabel);
  let programFinal = await ProgramFinal.findOne({
    program: program._id,
    airDate,
    airTime: parsed.airTime,
    editionKey,
  });
  if (programFinal) return programFinal;
  const normalizedTerm = normalizeAirTime(parsed.airTime);
  let showDay = normalizeAirTime(program.defaultTime) === normalizedTerm
    ? await findShowDay(program._id, parsed.airDate)
    : null;
  if (showDay && await ProgramFinal.exists({ showDay: showDay._id })) showDay = null;
  const credits = input.credits || await creditsFromSidecar(candidate.sidecar);
  programFinal = await ProgramFinal.create({
    programType: program.programType || null,
    program: program._id,
    airDate,
    airTime: normalizedTerm,
    editionLabel: parsed.editionLabel || '',
    editionKey,
    title: String(parsed.title || path.parse(candidate.filename).name).trim(),
    showDay: showDay?._id || null,
    historical: !showDay,
    credits,
    status: 'ingesting',
    airedAt: showDay?.airedAt || null,
    airedBy: showDay?.airedBy || null,
  });
  await refreshSearchFields(programFinal);
  await programFinal.save();
  return programFinal;
}

async function moveProcessed(sourcePath, sidecarPath = '') {
  const root = watchedRoot();
  const targetFolder = path.join(root, '.processed', new Date().toISOString().slice(0, 10));
  ensureFolderExists(targetFolder);
  async function moveOne(filePath) {
    if (!filePath || !fs.existsSync(filePath)) return '';
    let target = path.join(targetFolder, path.basename(filePath));
    if (fs.existsSync(target)) {
      target = path.join(targetFolder, `${Date.now()}_${path.basename(filePath)}`);
    }
    try {
      await fs.promises.rename(filePath, target);
    } catch (error) {
      if (error.code !== 'EXDEV') throw error;
      await fs.promises.copyFile(filePath, target);
      await fs.promises.rm(filePath, { force: true });
    }
    return target;
  }
  return { source: await moveOne(sourcePath), sidecar: await moveOne(sidecarPath) };
}

async function importFinalCandidate(candidateOrId, { actorId = null, mapping = {}, automatic = false } = {}) {
  const candidate = typeof candidateOrId === 'object'
    ? candidateOrId
    : await FinalIngestCandidate.findById(candidateOrId).select('+sourcePath +processedPath');
  if (!candidate) throw Object.assign(new Error('Watched-folder kandidat nije pronađen.'), { statusCode: 404 });
  const sourcePath = candidate.sourcePath;
  if (!sourcePath || !fs.existsSync(sourcePath)) throw Object.assign(new Error('Izvorni watched-folder fajl nedostaje.'), { statusCode: 404 });
  const programFinal = await ensureLogicalFinal(candidate, mapping);
  if (!programFinal) {
    candidate.status = 'needs_mapping';
    candidate.error = automatic ? '' : 'Program, datum ili termin nisu ispravno povezani.';
    await candidate.save();
    return { status: 'needs_mapping', candidate };
  }
  candidate.mappedProgram = programFinal.program;
  candidate.status = 'importing';
  candidate.error = '';
  await candidate.save();

  try {
    const result = await ingestProgramFinalMaster({
      programFinalId: programFinal._id,
      sourcePath,
      originalFilename: candidate.filename,
      ingestSource: 'watched_folder',
      actorId,
      mediaNodeId: candidate.mediaNode,
      sourceCandidateId: candidate._id,
      replacementReason: String(mapping.replacementReason || candidate.sidecar?.replacementReason || '').trim(),
      removeSourceAfterCopy: false,
    });
    const sidecar = await readSidecar(sourcePath);
    const moved = await moveProcessed(sourcePath, sidecar.path);
    candidate.status = result.duplicate ? 'duplicate' : 'imported';
    candidate.importedFinal = programFinal._id;
    candidate.importedVersion = result.version?._id || null;
    candidate.sha256 = result.checksum;
    candidate.processedPath = moved.source;
    candidate.error = '';
    await candidate.save();
    observedFiles.delete(String(candidate.candidateKey));
    return { status: candidate.status, candidate, programFinal, version: result.version };
  } catch (error) {
    candidate.status = 'failed';
    candidate.error = String(error.message || error).slice(0, 2000);
    await candidate.save();
    throw error;
  }
}

async function inspectFile(node, filePath, stats) {
  const now = Date.now();
  const key = candidateKey(node.nodeId, filePath);
  const fingerprint = `${stats.size}:${stats.mtimeMs}`;
  const previous = observedFiles.get(key);
  if (!previous || previous.fingerprint !== fingerprint) {
    observedFiles.set(key, { fingerprint, stableSince: now, lastSeenAt: now });
  } else {
    previous.lastSeenAt = now;
  }
  const observation = observedFiles.get(key);
  const sidecar = await readSidecar(filePath);
  const parsed = parsedCandidate(path.basename(filePath), sidecar.data);
  const existingCandidate = await FinalIngestCandidate.findOne({ candidateKey: key }).select('status updatedAt');
  const staleImport = existingCandidate?.status === 'importing'
    && now - new Date(existingCandidate.updatedAt || 0).getTime() >= 10 * 60 * 1000;
  if (existingCandidate?.status === 'importing' && !staleImport) return existingCandidate;
  const resetTerminalCandidate = ['imported', 'duplicate'].includes(existingCandidate?.status);
  const resetCandidate = resetTerminalCandidate || staleImport;
  const candidate = await FinalIngestCandidate.findOneAndUpdate(
    { candidateKey: key },
    {
      $set: {
        mediaNode: node._id,
        sourcePath: filePath,
        relativePath: path.relative(watchedRoot(), filePath).replace(/\\/g, '/'),
        filename: path.basename(filePath),
        size: stats.size,
        modifiedAt: stats.mtime,
        stableSince: new Date(observation.stableSince),
        parsed,
        sidecar: sidecar.data,
        error: sidecar.error || '',
        ...(resetCandidate ? {
          status: 'observing',
          importedFinal: null,
          importedVersion: null,
          sha256: '',
          processedPath: '',
          ...(staleImport ? { error: 'Prethodni import je prekinut; kandidat je vraćen u red.' } : {}),
        } : {}),
      },
      $setOnInsert: { status: 'observing' },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).select('+sourcePath');
  if (['imported', 'duplicate'].includes(candidate.status)) return candidate;
  if (sidecar.error) {
    candidate.status = 'needs_mapping';
    await candidate.save();
    return candidate;
  }
  if (now - observation.stableSince < stableMs()) {
    candidate.status = 'observing';
    await candidate.save();
    return candidate;
  }
  candidate.status = parsed.programSlug && parsed.airDate && parsed.airTime ? 'ready' : 'needs_mapping';
  await candidate.save();
  if (candidate.status === 'ready') await importFinalCandidate(candidate, { automatic: true });
  return candidate;
}

async function performScan(nodeId) {
  const root = watchedRoot();
  ensureFolderExists(root);
  await prepareCatalog();
  const node = await MediaNode.findOne({ nodeId });
  if (!node) throw new Error('Media Edge nije registrovan.');
  const entries = await fs.promises.readdir(root, { withFileTypes: true });
  let inspected = 0;
  let failed = 0;
  for (const entry of entries) {
    if (!entry.isFile() || entry.name.startsWith('.')) continue;
    const extension = path.extname(entry.name).toLowerCase();
    if (!allowedVideoExtensions.includes(extension)) continue;
    const filePath = path.join(root, entry.name);
    try {
      const stats = await fs.promises.stat(filePath);
      await inspectFile(node, filePath, stats);
      inspected += 1;
    } catch (error) {
      failed += 1;
      console.error(`Program Final watched kandidat nije obrađen (${entry.name}):`, error.message);
    }
  }
  const staleObservationMs = Math.max(stableMs() * 2, 60 * 60 * 1000);
  for (const [key, observation] of observedFiles.entries()) {
    if (Date.now() - Number(observation.lastSeenAt || observation.stableSince || 0) > staleObservationMs) {
      observedFiles.delete(key);
    }
  }
  return { inspected, failed, root };
}

function scanFinalWatchedFolder(nodeId) {
  if (activeScan) return activeScan;
  activeScan = performScan(nodeId).finally(() => { activeScan = null; });
  return activeScan;
}

module.exports = {
  candidateKey,
  importFinalCandidate,
  parsedCandidate,
  scanFinalWatchedFolder,
  watchedRoot,
};
