import React, { useEffect, useState } from 'react';
import {
  Box,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  TextField,
  Button,
  Typography,
  Slider,
  Alert,
} from '@mui/material';
import axiosInstance from '../../axiosConfig';

const codecOptions = [
  { value: 'libx264', label: 'H.264 (libx264)' },
  { value: 'libx265', label: 'H.265 (libx265)' },
  { value: 'h264_nvenc', label: 'H.264 (NVENC)' },
  { value: 'hevc_nvenc', label: 'H.265 (NVENC)' },
];

const resolutionOptions = [
  { value: '1280x720', label: '1280x720 (HD)' },
  { value: '1920x1080', label: '1920x1080 (Full HD)' },
  { value: '2560x1440', label: '2560x1440 (2K)' },
  { value: '3840x2160', label: '3840x2160 (4K)' },
];

const FfmpegSettings = () => {
  const [settings, setSettings] = useState({
    codec: '',
    resolution: '',
    bitrate: 0,
    framerate: 30,
  });
  const [message, setMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    axiosInstance.get('/admin/ffmpeg-settings')
      .then(response => setSettings(response.data))
      .catch(err => {
        console.error('Error fetching FFmpeg settings:', err);
        setErrorMessage('Error fetching FFmpeg settings.');
      });
  }, []);

  const handleChange = (e) => {
    setSettings({
      ...settings,
      [e.target.name]: e.target.value,
    });
  };

  const handleBitrateChange = (event, newValue) => {
    setSettings({
      ...settings,
      bitrate: newValue,
    });
  };

  const handleUpdate = () => {
    axiosInstance.put('/admin/ffmpeg-settings', settings)
      .then(response => {
        setSettings(response.data.settings);
        setMessage('Settings updated successfully.');
        setErrorMessage('');
      })
      .catch(err => {
        console.error('Error updating settings:', err);
        setErrorMessage('Failed to update settings.');
      });
  };

  return (
    <Box>
      <Typography variant="h5" gutterBottom>
        FFmpeg Settings
      </Typography>
      {message && <Alert severity="success" sx={{ mb: 2 }}>{message}</Alert>}
      {errorMessage && <Alert severity="error" sx={{ mb: 2 }}>{errorMessage}</Alert>}
      <FormControl fullWidth margin="normal">
        <InputLabel id="codec-label">Codec</InputLabel>
        <Select
          labelId="codec-label"
          name="codec"
          value={settings.codec || ''}
          label="Codec"
          onChange={handleChange}
        >
          {codecOptions.map(option => (
            <MenuItem key={option.value} value={option.value}>
              {option.label}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      <FormControl fullWidth margin="normal">
        <InputLabel id="resolution-label">Resolution</InputLabel>
        <Select
          labelId="resolution-label"
          name="resolution"
          value={settings.resolution || ''}
          label="Resolution"
          onChange={handleChange}
        >
          {resolutionOptions.map(option => (
            <MenuItem key={option.value} value={option.value}>
              {option.label}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      <TextField
        label="Frame Rate (fps)"
        name="framerate"
        type="number"
        fullWidth
        margin="normal"
        value={settings.framerate || 30}
        onChange={handleChange}
      />
      <Typography gutterBottom sx={{ mt: 2 }}>
        Bitrate: {settings.bitrate} Kbps
      </Typography>
      <Slider
        value={settings.bitrate}
        min={1}
        max={50000}
        step={1}
        onChange={handleBitrateChange}
        valueLabelDisplay="auto"
      />
      <Button variant="contained" onClick={handleUpdate} sx={{ mt: 2 }}>
        Update Settings
      </Button>
    </Box>
  );
};

export default FfmpegSettings;
