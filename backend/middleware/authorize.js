function authorize(allowedRoles) {
  return (req, res, next) => {
    console.log("DEBUG: In authorize middleware, user role is:", req.user.role);
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Access Forbidden' });
    }
    next();
  };
}

module.exports = authorize;
