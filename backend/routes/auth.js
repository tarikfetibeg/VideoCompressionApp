const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const User = require('../models/User');

const jwtSecret = process.env.JWT_SECRET;

// Login Route
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    return res.status(400).json({ code: 'AUTH_INVALID_INPUT', message: 'Unesi korisničko ime i lozinku.' });
  }
  if (User.db.readyState !== 1) {
    return res.status(503).json({ code: 'DATABASE_UNAVAILABLE', message: 'Baza podataka trenutno nije dostupna. Pokušaj ponovo.' });
  }

  try {
    // Find user by username
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(400).json({ code: 'AUTH_BAD_CREDENTIALS', message: 'Korisničko ime ili lozinka nisu ispravni.' });
    }

    // Compare passwords
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ code: 'AUTH_BAD_CREDENTIALS', message: 'Korisničko ime ili lozinka nisu ispravni.' });
    }

    // Generate JWT token
    if (!jwtSecret) {
      console.error('Error: JWT_SECRET is not defined');
      return res.status(500).json({ message: 'Server configuration error.' });
    }

    const token = jwt.sign(
      { id: user._id, role: user.role },
      jwtSecret,
      { expiresIn: '1h' }
    );

    res.json({
      token,
      user: { id: user._id, username: user.username, role: user.role },
    });
  } catch (error) {
    const unavailable = User.db.readyState !== 1 || /ServerSelection|Network|Topology/i.test(error.name || '');
    console.error('Login failed:', error.name || 'UnknownError');
    res.status(unavailable ? 503 : 500).json({
      code: unavailable ? 'DATABASE_UNAVAILABLE' : 'LOGIN_SERVER_ERROR',
      message: unavailable ? 'Baza podataka trenutno nije dostupna. Pokušaj ponovo.' : 'Serverska greška pri prijavi. Pokušaj ponovo.',
    });
  }
});

// Register Route
router.post('/register', async (req, res) => {
  const { username, password } = req.body;

  if (process.env.ALLOW_PUBLIC_REGISTRATION !== 'true') {
    return res.status(403).json({ message: 'Public registration is disabled.' });
  }

  if (!username || !password || password.length < 8) {
    return res.status(400).json({ message: 'Username and password with at least 8 characters are required.' });
  }

  try {
    // Check if username already exists
    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(400).json({ message: 'Username already taken.' });
    }

    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create new user (role defaults to 'Reporter')
    const user = new User({
      username,
      password: hashedPassword,
      // No need to set 'role' explicitly here
    });

    await user.save();

    res.status(201).json({ message: 'Registration successful.' });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ message: 'Server error during registration.' });
  }
});

module.exports = router;
