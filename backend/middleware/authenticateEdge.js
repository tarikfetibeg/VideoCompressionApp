const crypto = require('crypto');

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function authenticateEdge(req, res, next) {
  const provided = req.get('x-edge-secret') || '';
  const expected = process.env.EDGE_REGISTRATION_SECRET || '';
  if (!expected || !safeEqual(provided, expected)) {
    return res.status(401).json({ message: 'Media Edge autentifikacija nije uspjela.' });
  }
  return next();
}

module.exports = authenticateEdge;
