const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const ProgramFinal = require('../models/ProgramFinal');
const ProgramFinalMediaTicket = require('../models/ProgramFinalMediaTicket');
const ProgramFinalVersion = require('../models/ProgramFinalVersion');
const User = require('../models/User');
const { paths } = require('../utils/storagePaths');
const { resolveSafeRelativePath } = require('../utils/programFinals');
const { canViewPending, canViewProgramFinal, idOf, populateProgramFinal } = require('./programFinalService');

const ticketUseWrites = new Map();

function createProgramFinalMediaToken() {
  return crypto.randomBytes(32).toString('hex');
}

function hashProgramFinalMediaToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function statusError(message, statusCode) {
  return Object.assign(new Error(message), { statusCode });
}

function recordTicketUse(ticketId) {
  const key = String(ticketId);
  const now = Date.now();
  if (now - Number(ticketUseWrites.get(key) || 0) < 60_000) return;
  ticketUseWrites.set(key, now);
  if (ticketUseWrites.size > 5000) ticketUseWrites.delete(ticketUseWrites.keys().next().value);
  ProgramFinalMediaTicket.updateOne(
    { _id: ticketId },
    { $set: { lastUsedAt: new Date(now) }, $inc: { useCount: 1 } }
  ).catch(() => {});
}

async function resolveProgramFinalMedia(token, requestedResource) {
  const ticket = await ProgramFinalMediaTicket.findOne({ tokenHash: hashProgramFinalMediaToken(token) });
  if (!ticket) throw statusError('Media ticket nije pronađen.', 404);
  if (ticket.expiresAt <= new Date()) throw statusError('Media ticket je istekao.', 410);

  const [user, programFinal, version] = await Promise.all([
    User.findById(ticket.createdBy).select('_id username role'),
    populateProgramFinal(ProgramFinal.findById(ticket.programFinal)),
    ProgramFinalVersion.findById(ticket.version),
  ]);
  const ticketUser = user ? { id: idOf(user), role: user.role } : null;
  if (
    !ticketUser
    || !programFinal
    || !version
    || !['ready', 'active', 'superseded'].includes(version.status)
    || !canViewProgramFinal(programFinal, ticketUser)
  ) {
    throw statusError('Pristup finalu nije dozvoljen.', 403);
  }
  const isActive = idOf(programFinal.activeVersion) === idOf(version);
  if (!isActive && !canViewPending(programFinal, ticketUser)) {
    throw statusError('Pristup ovoj verziji nije dozvoljen.', 403);
  }

  const proxyRoot = resolveSafeRelativePath(paths.programFinalPreviews, version.proxy?.rootRelativePath);
  if (!proxyRoot || !fs.existsSync(proxyRoot)) throw statusError('Proxy nije pronađen.', 404);
  const resource = String(requestedResource || 'hls/master.m3u8').replace(/\\/g, '/').replace(/^\/+/, '');
  const filePath = path.resolve(proxyRoot, resource);
  const relative = path.relative(path.resolve(proxyRoot), filePath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw statusError('Media putanja nije sigurna.', 400);
  }
  const stats = await fs.promises.stat(filePath).catch(() => null);
  if (!stats?.isFile()) throw statusError('Media resurs nije pronađen.', 404);
  recordTicketUse(ticket._id);
  return { filePath, extension: path.extname(filePath).toLowerCase(), ticket, version };
}

module.exports = {
  createProgramFinalMediaToken,
  hashProgramFinalMediaToken,
  resolveProgramFinalMedia,
};
