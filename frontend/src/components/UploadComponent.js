import React, { useState, useEffect } from 'react';
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
  const [files, setFiles] = useState([]);
  const [eventTag, setEventTag] = useState('');
  const [location, setLocation] = useState('');
  const [date, setDate] = useState('');
  // Temporary defaults – will be updated from backend endpoint.
  const [codec, setCodec] = useState('h264');
  const [resolution, setResolution] = useState('1080');
  const [bitrate, setBitrate] = useState(10); // in Mbps
  const [framerate, setFramerate] = useState(30);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [message, setMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  // Fetch admin-defined default FFmpeg settings on mount.
  useEffect(() => {
    axios
      .get('/admin/ffmpeg-settings-default', {
        headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
      })
      .then((response) => {
        console.log('DEBUG: Fetched default FFmpeg settings:', response.data);
        const defaults = response.data;
        // Map backend "hevc_nvenc" to frontend "h265_nvenc"
        const defaultCodec = defaults.codec === 'hevc_nvenc' ? 'h265_nvenc' : defaults.codec;
        setCodec(defaultCodec || 'h264');
        const resVal = defaults.resolution || '1920x1080';
        if (resVal.includes('720')) {
          setResolution('720');
        } else if (resVal.includes('1080')) {
          setResolution('1080');
        } else if (resVal.includes('1440')) {
          setResolution('1440');
        } else if (resVal.includes('2160') || resVal.includes('3840')) {
          setResolution('2160');
        } else {
          setResolution('1080');
        }
        setBitrate(Math.round((defaults.bitrate || 1500) / 1000));
        setFramerate(defaults.framerate || 30);
      })
      .catch((err) => {
        console.error('Error fetching default FFmpeg settings:', err);
        // Fallback defaults remain in place.
      });
  }, []);
  
  const handleFileChange = (e) => {
    setFiles(Array.from(e.target.files));
  };

  const handleUpload = () => {
    if (files.length === 0) {
      setErrorMessage('Please select at least one file to upload.');
      return;
    }
    if (!eventTag || !location || !date) {
      setErrorMessage('Please provide event, location, and date.');
      return;
    }

    const formData = new FormData();
    files.forEach(file => {
      formData.append('videos', file);
    });
    // Append additional tagging and FFmpeg settings information
    formData.append('event', eventTag);
    formData.append('location', location);
    formData.append('date', date);
    formData.append('codec', codec);
    formData.append('resolution', resolution);
    formData.append('bitrate', bitrate);
    formData.append('framerate', framerate);

    axios
      .post('/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (progressEvent) => {
          const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          setUploadProgress(percentCompleted);
        },
      })
      .then((response) => {
        setMessage('Upload successful.');
        setUploadProgress(0);
        setFiles([]);
        setEventTag('');
        setLocation('');
        setDate('');
        setErrorMessage('');
        // Optionally, you could re-fetch defaults here, or simply reset to our current values.
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
      <Typography variant="h5">Upload Video Clips</Typography>
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
          Select Files
          <input type="file" hidden multiple onChange={handleFileChange} />
        </Button>
        {files.length > 0 && (
          <Typography variant="body1" sx={{ mt: 1 }}>
            Selected Files: {files.map(f => f.name).join(', ')}
          </Typography>
        )}
      </Box>
      {/* Mandatory Tag Inputs */}
      <TextField
        label="Event"
        value={eventTag}
        onChange={(e) => setEventTag(e.target.value)}
        fullWidth
        margin="normal"
        required
      />
      <TextField
        label="Location"
        value={location}
        onChange={(e) => setLocation(e.target.value)}
        fullWidth
        margin="normal"
        required
      />
      <TextField
        label="Date"
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        fullWidth
        margin="normal"
        InputLabelProps={{ shrink: true }}
        required
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
      {/* Frame Rate Input */}
      <TextField
        label="Frame Rate (fps)"
        type="number"
        fullWidth
        margin="normal"
        value={framerate}
        onChange={(e) => setFramerate(parseInt(e.target.value))}
      />
      <Typography gutterBottom sx={{ mt: 2 }}>
        Bitrate: {bitrate} Mbps
      </Typography>
      <Slider
        value={bitrate}
        min={1}
        max={50}
        step={1}
        onChange={(e, newValue) => setBitrate(newValue)}
        valueLabelDisplay="auto"
      />
      <Button variant="contained" color="primary" onClick={handleUpload} sx={{ mt: 2 }}>
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
