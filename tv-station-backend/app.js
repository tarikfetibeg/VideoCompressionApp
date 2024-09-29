const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();

// Import Routes
const authRoutes = require('./routes/auth');
const uploadRoutes = require('./routes/upload');
const videoRoutes = require('./routes/videos');

const fs = require('fs');

// Create directories if they don't exist
const directories = ['uploads/raw', 'uploads/compressed'];

directories.forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});


// Middleware
app.use(cors({
    origin: 'http://localhost:3000', // Your frontend URL
    credentials: true,
  }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));


// Connect to MongoDB
mongoose
  .connect('mongodb://localhost:27017/tv_station_app', {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log('MongoDB connected'))
  .catch((err) => console.error('MongoDB connection error:', err));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/videos', videoRoutes);
app.use('/uploads', express.static('uploads'));

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
