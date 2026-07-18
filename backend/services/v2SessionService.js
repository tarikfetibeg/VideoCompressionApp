const Device = require('../models/Device');
const Session = require('../models/Session');
const {
  createFamilyId,
  createOpaqueToken,
  createRefreshExpiry,
  hashOpaqueToken,
  signAccessToken,
} = require('../utils/v2Security');

async function upsertDevice(userId, input = {}) {
  if (!input.deviceId) return null;

  return Device.findOneAndUpdate(
    { deviceId: String(input.deviceId) },
    {
      $set: {
        user: userId,
        hostname: String(input.hostname || 'Windows računar').slice(0, 160),
        platform: String(input.platform || 'windows').slice(0, 50),
        platformVersion: String(input.platformVersion || '').slice(0, 80),
        appVersion: String(input.appVersion || '2.0.0').slice(0, 40),
        updateChannel: input.updateChannel === 'pilot' ? 'pilot' : 'stable',
        notificationPermission: ['granted', 'denied'].includes(input.notificationPermission)
          ? input.notificationPermission
          : 'unknown',
        lastSeenAt: new Date(),
        revokedAt: null,
      },
      $setOnInsert: { site: String(input.site || 'primary').slice(0, 80) },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

async function issueSession(user, options = {}) {
  const refreshToken = createOpaqueToken();
  const device = await upsertDevice(user._id, options.device);
  const session = await Session.create({
    user: user._id,
    device: device?._id,
    tokenHash: hashOpaqueToken(refreshToken),
    familyId: options.familyId || createFamilyId(),
    expiresAt: createRefreshExpiry(),
    createdByIp: options.ip || '',
    userAgent: String(options.userAgent || '').slice(0, 500),
  });

  return {
    accessToken: signAccessToken(user, session._id, device?.deviceId),
    refreshToken,
    accessTokenExpiresIn: process.env.ACCESS_TOKEN_TTL || '10m',
    refreshTokenExpiresAt: session.expiresAt,
    sessionId: session._id,
    device,
  };
}

async function rotateSession(refreshToken, options = {}) {
  const now = new Date();
  const previous = await Session.findOneAndUpdate(
    {
      tokenHash: hashOpaqueToken(refreshToken),
      revokedAt: null,
      expiresAt: { $gt: now },
    },
    {
      $set: {
        revokedAt: now,
        rotatedAt: now,
        revokeReason: 'rotated',
        lastUsedAt: now,
      },
    },
    { new: true }
  ).populate('user');

  if (!previous?.user) return null;

  const next = await issueSession(previous.user, {
    familyId: previous.familyId,
    device: options.device,
    ip: options.ip,
    userAgent: options.userAgent,
  });
  previous.replacedBy = next.sessionId;
  await previous.save();
  return next;
}

async function revokeSession(refreshToken, reason = 'logout') {
  if (!refreshToken) return 0;
  const result = await Session.updateOne(
    { tokenHash: hashOpaqueToken(refreshToken), revokedAt: null },
    { $set: { revokedAt: new Date(), revokeReason: reason } }
  );
  return result.modifiedCount;
}

async function revokeDevice(deviceId, performedBy) {
  const device = await Device.findOneAndUpdate(
    { deviceId },
    { $set: { revokedAt: new Date() } },
    { new: true }
  );
  if (!device) return null;

  await Session.updateMany(
    { device: device._id, revokedAt: null },
    { $set: { revokedAt: new Date(), revokeReason: `device_revoked:${performedBy || 'admin'}` } }
  );
  return device;
}

module.exports = {
  issueSession,
  revokeDevice,
  revokeSession,
  rotateSession,
  upsertDevice,
};
