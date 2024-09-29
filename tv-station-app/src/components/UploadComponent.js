import React, { useState } from 'react';
import axios from '../axiosConfig';
import {
  Box,
  Button,
  TextField,
  Typography,
  LinearProgress,
  Alert,
  MenuItem,
  Select,
  InputLabel,
  FormControl,
  Slider,
} from '@mui/material';
import { CloudUpload } from '@mui/icons-material';

const UploadComponent = () => {
  const [file, setFile] = useState(null);
  const [events, setEvents] = useState('');
  const [codec, setCodec] = useState('h264');
  const [resolution, setResolution] = useState('1080');
  const [bitrate, setBitrate] = useState(10); // in Mbps
  const framerate = 30; // Fixed at 30 fps
  const [uploadProgress, setUploadProgress] = useState(0);
  const [message, setMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const handleFileChange = (e) => {
    setFile(e.target.files[0]);
  };

  const handleEventsChange = (e) => {
    setEvents(e.target.value);
  };

  const handleUpload = () => {
    if (!file) {
      setErrorMessage('Please select a file to upload.');
      return;
    }

    const formData = new FormData();
    formData.append('video', file);
    formData.append('events', events);
    formData.append('codec', codec);
    formData.append('resolution', resolution);
    formData.append('bitrate', bitrate);
    formData.append('framerate', framerate);

    axios
      .post('/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        onUploadProgress: (progressEvent) => {
          const percentCompleted = Math.round(
            (progressEvent.loaded * 100) / progressEvent.total
          );
          setUploadProgress(percentCompleted);
        },
      })
      .then((response) => {
        setMessage('Upload successful.');
        setUploadProgress(0);
        setFile(null);
        setEvents('');
        setErrorMessage('');
        setCodec('h264');
        setResolution('1080');
        setBitrate(10);
      })
      .catch((error) => {
        console.error('Error uploading file:', error);
        setErrorMessage(
          error.response && error.response.data
            ? error.response.data.message
            : 'Error uploading file.'
        );
      });
  };

  return (
    <Box sx={{ mt: 4 }}>
      <Typography variant="h5">Upload Video</Typography>
      {message && (
        <Alert severity="success" sx={{ mt: 2 }}>
          {message}
        </Alert>
      )}
      {errorMessage && (
        <Alert severity="error" sx={{ mt: 2 }}>
          {errorMessage}
        </Alert>
      )}
      <Box sx={{ mt: 2 }}>
        <Button variant="contained" component="label" startIcon={<CloudUpload />}>
          Select File
          <input type="file" hidden onChange={handleFileChange} />
        </Button>
        {file && (
          <Typography variant="body1" sx={{ mt: 1 }}>
            Selected File: {file.name}
          </Typography>
        )}
      </Box>
      <TextField
        label="Event Tags (comma-separated)"
        value={events}
        onChange={handleEventsChange}
        fullWidth
        margin="normal"
      />

      {/* Codec Selection */}
      <FormControl fullWidth sx={{ mt: 2 }}>
        <InputLabel>Codec</InputLabel>
        <Select
          value={codec}
          label="Codec"
          onChange={(e) => setCodec(e.target.value)}
        >
          <MenuItem value="h264">H.264 (Software)</MenuItem>
          <MenuItem value="h265">H.265 (Software)</MenuItem>
          <MenuItem value="h264_nvenc">H.264 (NVENC)</MenuItem>
          <MenuItem value="h265_nvenc">H.265 (NVENC)</MenuItem>
        </Select>
      </FormControl>

      {/* Resolution Selection */}
      <FormControl fullWidth sx={{ mt: 2 }}>
        <InputLabel>Resolution</InputLabel>
        <Select
          value={resolution}
          label="Resolution"
          onChange={(e) => setResolution(e.target.value)}
        >
          <MenuItem value="720">1280x720 (HD)</MenuItem>
          <MenuItem value="1080">1920x1080 (Full HD)</MenuItem>
          <MenuItem value="1440">2560x1440 (2K)</MenuItem>
          <MenuItem value="2160">3840x2160 (4K)</MenuItem>
        </Select>
      </FormControl>

      {/* Bitrate Slider */}
      <Typography gutterBottom sx={{ mt: 2 }}>
        Bitrate: {bitrate} Mbps
      </Typography>
      <Slider
        value={bitrate}
        min={1}
        max={20}
        step={1}
        onChange={(e, newValue) => setBitrate(newValue)}
        valueLabelDisplay="auto"
      />

      {/* Framerate Display */}
      <Typography sx={{ mt: 2 }}>
        Framerate: {framerate} fps (fixed)
      </Typography>

      <Button
        variant="contained"
        color="primary"
        onClick={handleUpload}
        sx={{ mt: 2 }}
      >
        Upload
      </Button>
      {uploadProgress > 0 && (
        <Box sx={{ mt: 2 }}>
          <LinearProgress variant="determinate" value={uploadProgress} />
          <Typography variant="body2" color="textSecondary">
            Upload Progress: {uploadProgress}%
          </Typography>
        </Box>
      )}
    </Box>
  );
};

export default UploadComponent;
