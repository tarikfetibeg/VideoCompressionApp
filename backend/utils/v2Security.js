const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const ACCESS_TOKEN_TTL = process.env.ACCESS_TOKEN_TTL || '10m';
const REFRESH_TOKEN_DAYS = Math.max(Number(process.env.REFRESH_TOKEN_DAYS || 30), 1);

function createOpaqueToken() {
  return crypto.randomBytes(48).toString('base64url');
}

function hashOpaqueToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function createFamilyId() {
  return crypto.randomUUID();
}

function createRefreshExpiry() {
  return new Date(Date.now() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000);
}

function signAccessToken(user, sessionId, deviceId) {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is required.');
  return jwt.sign(
    {
      id: user._id || user.id,
      role: user.role,
      sessionId,
      deviceId: deviceId || undefined,
      tokenType: 'access',
    },
    process.env.JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_TTL }
  );
}

function getClientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.socket?.remoteAddress || '';
}

module.exports = {
  ACCESS_TOKEN_TTL,
  REFRESH_TOKEN_DAYS,
  createFamilyId,
  createOpaqueToken,
  createRefreshExpiry,
  getClientIp,
  hashOpaqueToken,
  signAccessToken,
};
