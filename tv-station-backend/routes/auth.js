const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

const router = express.Router();

// User Registration
router.post('/register', async (req, res) => {
  const { username, password, role } = req.body;

  // Basic validation (add more as needed)
  if (!username || !password || !role) {
    return res.status(400).json({ message: 'Please enter all fields' });
  }

  // Check if user exists
  const existingUser = await User.findOne({ username });
  if (existingUser) return res.status(400).json({ message: 'User already exists' });

  // Create new user
  const hashedPassword = await bcrypt.hash(password, 10);

  const newUser = new User({
    username,
    password: hashedPassword,
    role,
  });

  await newUser.save();

  res.status(201).json({ message: 'User registered successfully' });
});

// User Login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  // Basic validation
  if (!username || !password) {
    return res.status(400).json({ message: 'Please enter all fields' });
  }

  // Check for user
  const user = await User.findOne({ username });
  if (!user) return res.status(400).json({ message: 'User does not exist' });

  // Validate password
  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) return res.status(400).json({ message: 'Invalid credentials' });

  // Generate JWT
  const token = jwt.sign({ id: user._id, role: user.role }, 'your_secret_key', {
    expiresIn: '1h',
  });

  res.json({
    token,
    user: {
      id: user._id,
      username: user.username,
      role: user.role,
    },
  });
});

module.exports = router;
