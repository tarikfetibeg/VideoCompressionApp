const mongoose = require('mongoose');
const BroadcastProgram = require('../models/BroadcastProgram');
const ProductionPerson = require('../models/ProductionPerson');
const ProductionRole = require('../models/ProductionRole');
const ProgramFinal = require('../models/ProgramFinal');
const ProgramFinalVersion = require('../models/ProgramFinalVersion');
const ProgramType = require('../models/ProgramType');
const ShowDay = require('../models/ShowDay');
const { enqueueDomainEvent } = require('./domainEventService');
const {
  buildEditionKey,
  buildProgramFinalSearch,
  normalizeAirDate,
  normalizeAirTime,
} = require('../utils/programFinals');

const ALL_ROLES = ['Reporter', 'Editor', 'VideoEditor', 'Producer', 'Realizator', 'Archivist', 'Admin'];
const PRIVILEGED_ROLES = ['Archivist', 'Admin'];

function idOf(value) {
  if (!value) return '';
  return String(value._id || value);
}

function statusError(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

function isAssignedProducer(programFinal, user) {
  if (user?.role !== 'Producer' || !programFinal?.showDay) return false;
  const producers = programFinal.showDay?.producers || [];
  return producers.some((producer) => idOf(producer) === String(user.id));
}

function canViewPending(programFinal, user) {
  if (!user || !ALL_ROLES.includes(user.role)) return false;
  if (PRIVILEGED_ROLES.includes(user.role) || user.role === 'Realizator') return true;
  return isAssignedProducer(programFinal, user);
}

function canViewProgramFinal(programFinal, user) {
  if (!user || !ALL_ROLES.includes(user.role) || !programFinal) return false;
  if (programFinal.activeVersion && ['archived', 'ready_for_archive_review', 'processing', 'waiting_for_air'].includes(programFinal.status)) {
    return true;
  }
  return canViewPending(programFinal, user);
}

function canEditProgramFinal(programFinal, user) {
  if (!user || !programFinal || programFinal.status === 'archived') return false;
  if (PRIVILEGED_ROLES.includes(user.role) || user.role === 'Realizator') return true;
  return isAssignedProducer(programFinal, user);
}

async function populateProgramFinal(query) {
  return query
    .populate('programType')
    .populate('program')
    .populate('showDay', 'airDate producers airedAt airedBy')
    .populate('showDay.producers', 'username role')
    .populate('credits.person', 'name aliases active')
    .populate('credits.role', 'name slug group active')
    .populate('activeVersion')
    .populate('pendingVersion')
    .populate('airedBy', 'username role')
    .populate('archiveConfirmedBy', 'username role')
    .populate('createdBy', 'username role')
    .populate('updatedBy', 'username role');
}

async function resolveCredits(inputCredits, { requireOne = false } = {}) {
  const unique = new Map();
  for (const credit of inputCredits || []) {
    const personId = idOf(credit.personId || credit.person);
    const roleId = idOf(credit.roleId || credit.role);
    if (!mongoose.Types.ObjectId.isValid(personId) || !mongoose.Types.ObjectId.isValid(roleId)) {
      throw statusError('Član ekipe ili njegova funkcija nisu ispravni.');
    }
    unique.set(`${personId}:${roleId}`, { personId, roleId });
  }
  if (requireOne && unique.size === 0) throw statusError('Najmanje jedan član ekipe je obavezan.');

  const entries = Array.from(unique.values());
  const [people, roles] = await Promise.all([
    ProductionPerson.find({ _id: { $in: entries.map((entry) => entry.personId) }, active: true }),
    ProductionRole.find({ _id: { $in: entries.map((entry) => entry.roleId) }, active: true }),
  ]);
  const peopleById = new Map(people.map((person) => [idOf(person), person]));
  const rolesById = new Map(roles.map((role) => [idOf(role), role]));
  if (people.length !== new Set(entries.map((entry) => entry.personId)).size) {
    throw statusError('Jedna od osoba nije aktivna ili nije pronađena.');
  }
  if (roles.length !== new Set(entries.map((entry) => entry.roleId)).size) {
    throw statusError('Jedna od funkcija nije aktivna ili nije pronađena.');
  }
  return entries.map((entry) => ({
    person: entry.personId,
    role: entry.roleId,
    personNameSnapshot: peopleById.get(entry.personId).name,
    roleNameSnapshot: rolesById.get(entry.roleId).name,
  }));
}

async function refreshSearchFields(programFinal) {
  const [program, programType] = await Promise.all([
    BroadcastProgram.findById(programFinal.program).select('name'),
    programFinal.programType ? ProgramType.findById(programFinal.programType).select('name') : null,
  ]);
  Object.assign(programFinal, buildProgramFinalSearch({
    title: programFinal.title,
    programName: program?.name,
    programTypeName: programType?.name,
    editionLabel: programFinal.editionLabel,
    credits: programFinal.credits,
  }));
  return programFinal;
}

async function createProgramFinalDraft(input, user) {
  const program = await BroadcastProgram.findOne({ _id: input.programId, active: true });
  if (!program) throw statusError('Odabrana emisija nije aktivna ili nije pronađena.', 404);
  const programTypeId = input.programTypeId || program.programType;
  const programType = programTypeId
    ? await ProgramType.findOne({ _id: programTypeId, active: true })
    : null;
  if (!programType) throw statusError('Tip programa je obavezan. Emisiju prvo klasifikuj u Admin katalogu.');
  const airDate = normalizeAirDate(input.airDate);
  const airTime = normalizeAirTime(input.airTime || program.defaultTime);
  if (!airDate || !airTime) throw statusError('Datum i termin emitovanja su obavezni.');
  const title = String(input.title || '').trim();
  if (!title) throw statusError('Naslov finala je obavezan.');
  const credits = await resolveCredits(input.credits, { requireOne: true });
  const editionKey = buildEditionKey(input.editionLabel);
  const existingEdition = await ProgramFinal.exists({
    program: program._id,
    airDate,
    airTime,
    editionKey,
  });
  if (existingEdition) throw statusError('Final za isti program, datum, termin i izdanje već postoji.', 409);

  let showDay = null;
  if (input.showDayId) {
    const dayEnd = new Date(airDate.getTime() + 24 * 60 * 60 * 1000);
    showDay = await ShowDay.findOne({
      _id: input.showDayId,
      program: program._id,
      airDate: { $gte: airDate, $lt: dayEnd },
    });
    if (!showDay) throw statusError('Odabrani rundown ne pripada ovoj emisiji.', 404);
    if (await ProgramFinal.exists({ showDay: showDay._id })) {
      throw statusError('Odabrani rundown već ima evidentiran final emisije.', 409);
    }
  } else if (input.historical !== true && normalizeAirTime(program.defaultTime) === airTime) {
    const dayEnd = new Date(airDate.getTime() + 24 * 60 * 60 * 1000);
    showDay = await ShowDay.findOne({
      program: program._id,
      airDate: { $gte: airDate, $lt: dayEnd },
    });
    if (showDay && await ProgramFinal.exists({ showDay: showDay._id })) showDay = null;
  }
  const historical = !showDay;
  const programFinal = await ProgramFinal.create({
    programType: programType._id,
    program: program._id,
    airDate,
    airTime,
    editionLabel: String(input.editionLabel || '').trim(),
    editionKey,
    title,
    showDay: showDay?._id || null,
    historical,
    credits,
    status: 'waiting_for_file',
    airedAt: showDay?.airedAt || null,
    airedBy: showDay?.airedBy || null,
    createdBy: user.id,
    updatedBy: user.id,
  });
  await refreshSearchFields(programFinal);
  await programFinal.save();
  return programFinal;
}

async function updateProgramFinalMetadata(programFinal, input, user) {
  if (!canEditProgramFinal(programFinal, user)) throw statusError('Nemaš pravo mijenjati ovaj final.', 403);
  if (programFinal.showDay && input.programId && idOf(input.programId) !== idOf(programFinal.program)) {
    throw statusError('Emisija finala povezanog sa rundownom ne može se promijeniti.', 409);
  }
  if (input.programId && idOf(input.programId) !== idOf(programFinal.program)) {
    const program = await BroadcastProgram.findOne({ _id: input.programId, active: true });
    if (!program) throw statusError('Emisija nije pronađena.', 404);
    programFinal.program = program._id;
  }
  if (input.programTypeId) {
    const programType = await ProgramType.findOne({ _id: input.programTypeId, active: true });
    if (!programType) throw statusError('Tip programa nije pronađen.', 404);
    programFinal.programType = programType._id;
  }
  if (input.airDate) {
    const airDate = normalizeAirDate(input.airDate);
    if (!airDate) throw statusError('Datum nije ispravan.');
    if (programFinal.showDay && airDate.getTime() !== new Date(programFinal.airDate).getTime()) {
      throw statusError('Datum finala povezanog sa rundownom ne može se promijeniti.', 409);
    }
    programFinal.airDate = airDate;
  }
  if (input.airTime) {
    const airTime = normalizeAirTime(input.airTime);
    if (!airTime) throw statusError('Termin nije ispravan.');
    programFinal.airTime = airTime;
  }
  if (input.title !== undefined) {
    const title = String(input.title || '').trim();
    if (!title) throw statusError('Naslov je obavezan.');
    programFinal.title = title;
  }
  if (input.editionLabel !== undefined) {
    programFinal.editionLabel = String(input.editionLabel || '').trim();
    programFinal.editionKey = buildEditionKey(programFinal.editionLabel);
  }
  const duplicate = await ProgramFinal.exists({
    _id: { $ne: programFinal._id },
    program: programFinal.program,
    airDate: programFinal.airDate,
    airTime: programFinal.airTime,
    editionKey: programFinal.editionKey,
  });
  if (duplicate) throw statusError('Final za isti program, datum, termin i izdanje već postoji.', 409);
  programFinal.updatedBy = user.id;
  await refreshSearchFields(programFinal);
  await programFinal.save();
  return programFinal;
}

async function updateProgramFinalCredits(programFinal, inputCredits, user) {
  if (!canEditProgramFinal(programFinal, user)) throw statusError('Nemaš pravo mijenjati ekipu ovog finala.', 403);
  programFinal.credits = await resolveCredits(inputCredits, { requireOne: true });
  programFinal.updatedBy = user.id;
  await refreshSearchFields(programFinal);
  await programFinal.save();
  return programFinal;
}

function getArchiveWarnings(programFinal, version, programType) {
  const warnings = [];
  if (!programFinal.programType) warnings.push({ code: 'missing_program_type', label: 'Tip programa nije postavljen.' });
  if (!programFinal.title) warnings.push({ code: 'missing_title', label: 'Naslov nije postavljen.' });
  if (!programFinal.airDate || !programFinal.airTime) warnings.push({ code: 'missing_air_slot', label: 'Datum ili termin nisu postavljeni.' });
  if (!programFinal.airedAt) warnings.push({ code: 'not_aired', label: 'Emitovanje još nije potvrđeno.', blocking: true });
  if (!programFinal.credits?.length) warnings.push({ code: 'missing_credits', label: 'Nije evidentiran nijedan član ekipe.', blocking: true });
  if (!version || version.status !== 'ready') warnings.push({ code: 'proxy_not_ready', label: 'Zaštićeni preview još nije spreman.', blocking: true });
  if (!version?.sha256) warnings.push({ code: 'missing_checksum', label: 'Checksum nije evidentiran.', blocking: true });
  const presentRoleIds = new Set((programFinal.credits || []).map((credit) => idOf(credit.role)));
  const missingRecommended = (programType?.recommendedRoles || [])
    .filter((role) => !presentRoleIds.has(idOf(role)))
    .map((role) => ({ id: idOf(role), name: role.name || role.toString() }));
  if (missingRecommended.length) {
    warnings.push({
      code: 'missing_recommended_roles',
      label: `Nedostaju preporučene funkcije: ${missingRecommended.map((item) => item.name).join(', ')}.`,
      missingRoles: missingRecommended,
    });
  }
  return warnings;
}

async function handleShowDayAired(showDay, actor) {
  const program = await BroadcastProgram.findById(showDay.program);
  if (!program) return null;
  let programFinal = await ProgramFinal.findOne({ showDay: showDay._id });
  let notification = null;
  if (!programFinal) {
    const airTime = normalizeAirTime(program.defaultTime) || '00:00';
    programFinal = await ProgramFinal.create({
      programType: program.programType || null,
      program: program._id,
      airDate: showDay.airDate,
      airTime,
      editionLabel: '',
      editionKey: 'standard',
      title: program.name,
      showDay: showDay._id,
      historical: false,
      status: 'waiting_for_file',
      airedAt: showDay.airedAt || new Date(),
      airedBy: showDay.airedBy || actor?.id || null,
      createdBy: actor?.id || null,
      updatedBy: actor?.id || null,
    });
    await refreshSearchFields(programFinal);
    notification = {
      type: 'program_final.missing_after_air',
      title: 'Nedostaje final emisije',
      versionKey: 'missing',
    };
  } else {
    programFinal.airedAt = showDay.airedAt || new Date();
    programFinal.airedBy = showDay.airedBy || actor?.id || null;
    if (programFinal.pendingVersion) {
      const pending = await ProgramFinalVersion.findById(programFinal.pendingVersion);
      if (pending?.status === 'ready') {
        programFinal.status = 'ready_for_archive_review';
        notification = {
          type: 'program_final.ready_for_archive_review',
          title: 'Final čeka arhivski pregled',
          versionKey: String(pending._id),
        };
      } else if (pending?.status === 'failed') {
        programFinal.status = programFinal.activeVersion ? 'archived' : 'waiting_for_file';
        if (!programFinal.activeVersion) {
          notification = {
            type: 'program_final.missing_after_air',
            title: 'Final emisije nije uspješno obrađen',
            versionKey: String(pending._id),
          };
        }
      }
    } else if (programFinal.activeVersion) {
      programFinal.status = 'archived';
    } else {
      programFinal.status = 'waiting_for_file';
      notification = {
        type: 'program_final.missing_after_air',
        title: 'Nedostaje final emisije',
        versionKey: 'missing',
      };
    }
  }
  await programFinal.save();

  if (notification) {
    await enqueueDomainEvent({
      type: notification.type,
      severity: 'action_required',
      actor: actor?.id || null,
      recipientRoles: ['Archivist'],
      entityType: 'program_final',
      entityId: programFinal._id,
      entityVersion: Math.floor(programFinal.updatedAt.getTime() / 1000),
      title: notification.title,
      bodyPreview: `${programFinal.title} · ${programFinal.airTime}`,
      deepLink: `vca://program-final/${programFinal._id}`,
      payload: { programFinalId: programFinal._id, showDayId: showDay._id },
      dedupeKey: `program-final:aired:${showDay._id}:${notification.versionKey}`,
    });
  }
  return programFinal;
}

module.exports = {
  ALL_ROLES,
  PRIVILEGED_ROLES,
  canEditProgramFinal,
  canViewPending,
  canViewProgramFinal,
  createProgramFinalDraft,
  getArchiveWarnings,
  idOf,
  isAssignedProducer,
  populateProgramFinal,
  refreshSearchFields,
  resolveCredits,
  statusError,
  updateProgramFinalCredits,
  updateProgramFinalMetadata,
  handleShowDayAired,
};
