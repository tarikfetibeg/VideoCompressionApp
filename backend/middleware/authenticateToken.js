const jwt = require('jsonwebtoken');

const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) {
  console.error('Error: JWT_SECRET is not defined');
  process.exit(1); // Exit the application if JWT_SECRET is not set
}

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.sendStatus(401); // Unauthorized
  }

  jwt.verify(token, jwtSecret, (err, user) => {
    if (err) {
      console.error("JWT verification error:", err);
      return res.sendStatus(403); // Forbidden
    }
    console.log("Decoded JWT payload:", user); // Debug log to show decoded token
    req.user = user;
    next();
  });
}

module.exports = authenticateToken;
