const express = require('express');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const User = require('../../models/User');
const {
  issueSession,
  revokeSession,
  rotateSession,
} = require('../../services/v2SessionService');
const { getClientIp } = require('../../utils/v2Security');

const router = express.Router();

const deviceSchema = z.object({
  deviceId: z.string().min(8).max(200).optional(),
  hostname: z.string().min(1).max(160).optional(),
  platform: z.string().max(50).optional(),
  platformVersion: z.string().max(80).optional(),
  appVersion: z.string().max(40).optional(),
  updateChannel: z.enum(['pilot', 'stable']).optional(),
  notificationPermission: z.enum(['unknown', 'granted', 'denied']).optional(),
  site: z.string().max(80).optional(),
}).optional();

const loginSchema = z.object({
  username: z.string().trim().min(1).max(160),
  password: z.string().min(1).max(500),
  device: deviceSchema,
});

const refreshSchema = z.object({
  refreshToken: z.string().min(32).max(500),
  device: deviceSchema,
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Previše pokušaja prijave. Pokušaj ponovo za nekoliko minuta.' },
});

function sessionResponse(user, session) {
  return {
    accessToken: session.accessToken,
    token: session.accessToken,
    refreshToken: session.refreshToken,
    accessTokenExpiresIn: session.accessTokenExpiresIn,
    refreshTokenExpiresAt: session.refreshTokenExpiresAt,
    sessionId: session.sessionId,
    device: session.device,
    user: {
      id: user._id,
      username: user.username,
      role: user.role,
    },
  };
}

router.post('/login', loginLimiter, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Nedostaju podaci za prijavu.' });

  try {
    const user = await User.findOne({ username: parsed.data.username });
    const matches = user && await bcrypt.compare(parsed.data.password, user.password);
    if (!matches) return res.status(401).json({ message: 'Pogrešno korisničko ime ili lozinka.' });

    const session = await issueSession(user, {
      device: parsed.data.device,
      ip: getClientIp(req),
      userAgent: req.get('user-agent'),
    });
    return res.json(sessionResponse(user, session));
  } catch (error) {
    console.error('V2 login failed:', error);
    return res.status(500).json({ message: 'Prijava trenutno nije dostupna.' });
  }
});

router.post('/refresh', async (req, res) => {
  const parsed = refreshSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Refresh token nije ispravan.' });

  try {
    const session = await rotateSession(parsed.data.refreshToken, {
      device: parsed.data.device,
      ip: getClientIp(req),
      userAgent: req.get('user-agent'),
    });
    if (!session) return res.status(401).json({ message: 'Sesija je istekla ili je opozvana.' });

    const decoded = require('jsonwebtoken').decode(session.accessToken);
    const user = await User.findById(decoded.id);
    if (!user) return res.status(401).json({ message: 'Korisnik više nije dostupan.' });
    return res.json(sessionResponse(user, session));
  } catch (error) {
    console.error('V2 refresh failed:', error);
    return res.status(500).json({ message: 'Sesija se ne može obnoviti.' });
  }
});

router.post('/logout', async (req, res) => {
  try {
    await revokeSession(req.body?.refreshToken, 'logout');
    return res.json({ message: 'Odjava je završena.' });
  } catch (error) {
    console.error('V2 logout failed:', error);
    return res.status(500).json({ message: 'Odjava nije mogla biti završena.' });
  }
});

module.exports = router;
