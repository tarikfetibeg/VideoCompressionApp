const jwt = require('jsonwebtoken');

const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) {
  console.error('Error: JWT_SECRET is not defined');
  process.exit(1); // Exit ako token nije definiran
}

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ code: 'AUTH_TOKEN_MISSING', message: 'Prijava je potrebna.' });
  }

  jwt.verify(token, jwtSecret, (err, user) => {
    if (err) {
      const expired = err.name === 'TokenExpiredError';
      return res.status(403).json({
        code: expired ? 'AUTH_TOKEN_EXPIRED' : 'AUTH_TOKEN_INVALID',
        message: expired ? 'Sesija je istekla. Prijavi se ponovo.' : 'Prijava nije validna. Prijavi se ponovo.',
      });
    }
    req.user = user;
    next();
  });
}

module.exports = authenticateToken;
