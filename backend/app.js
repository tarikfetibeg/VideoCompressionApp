const express = require('express');
const app = express(); // Initialize Express app
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

// Load environment variables in development only
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

// Import Routes
const authRoutes = require('./routes/auth');
const uploadRoutes = require('./routes/upload');
const videoRoutes = require('./routes/videos');

const fs = require('fs');

// Middleware
app.use(cors({
  origin: 'https://videocompressionapp-e38d94e99592.herokuapp.com', // Your frontend URL
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Create directories if they don't exist
const directories = ['uploads/raw', 'uploads/compressed'];

directories.forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Connect to MongoDB
const mongoURI = process.env.MONGODB_URI;

if (!mongoURI) {
  console.error('Error: MONGODB_URI is not defined');
} else {
  console.log('MONGODB_URI is defined');
}

mongoose
  .connect(mongoURI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log('MongoDB connected successfully'))
  .catch((err) => console.error('MongoDB connection error:', err));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/videos', videoRoutes);
app.use('/uploads', express.static('uploads'));

// Serve static files from the React app (after API routes)
app.use(express.static(path.join(__dirname, '..', 'frontend', 'build')));

// The "catchall" handler: for any request that doesn't
// match one above, send back React's index.html file.
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'build', 'index.html'));
});

// Error Handling Middleware (optional)
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Something broke!');
});

// Start the Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
