const path = require('path');
const dotenvFlow = require('dotenv-flow');

dotenvFlow.config({
  cwd: path.resolve(__dirname, '..', '..'),
});

const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const User = require('../models/User');

const mongoURI = process.env.MONGODB_URI;
const username = process.env.ADMIN_USERNAME;
const password = process.env.ADMIN_PASSWORD;

async function main() {
  if (!mongoURI) {
    throw new Error('MONGODB_URI is required.');
  }

  if (!username || !password || password.length < 8) {
    throw new Error('ADMIN_USERNAME and ADMIN_PASSWORD with at least 8 characters are required.');
  }

  await mongoose.connect(mongoURI);

  const existingUser = await User.findOne({ username });
  if (existingUser) {
    existingUser.role = 'Admin';
    if (process.env.ADMIN_RESET_PASSWORD === 'true') {
      existingUser.password = await bcrypt.hash(password, 10);
    }
    await existingUser.save();
    console.log(`Admin user ensured: ${username}`);
    return;
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  await User.create({
    username,
    password: hashedPassword,
    role: 'Admin',
  });

  console.log(`Admin user created: ${username}`);
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
