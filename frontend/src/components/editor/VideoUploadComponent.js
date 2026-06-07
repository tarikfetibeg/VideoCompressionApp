import React, { useState } from 'react';
import axios from '../../axiosConfig';
import { Box, Button, TextField, Typography, LinearProgress, Alert } from '@mui/material';
import { CloudUpload } from '@mui/icons-material';

const VideoUploadComponent = () => {
  const [files, setFiles] = useState([]);
  const [eventTag, setEventTag] = useState('');
  const [location, setLocation] = useState('');
  const [date, setDate] = useState('');
  const [keywords, setKeywords] = useState('');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [message, setMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

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
    formData.append('event', eventTag);
    formData.append('location', location);
    formData.append('date', date);
    formData.append('keywords', keywords);
    // For editor uploads, we omit codec/resolution/bitrate.
    axios
      .post('/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (progressEvent) => {
          const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          setUploadProgress(percentCompleted);
        },
      })
      .then((response) => {
        setMessage(response.data?.message || 'Upload accepted for processing.');
        setUploadProgress(0);
        setFiles([]);
        setEventTag('');
        setLocation('');
        setDate('');
        setKeywords('');
        setErrorMessage('');
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
      <Typography variant="h5">Upload Edited Videos</Typography>
      {message && <Alert severity="success" sx={{ mt: 2 }}>{message}</Alert>}
      {errorMessage && <Alert severity="error" sx={{ mt: 2 }}>{errorMessage}</Alert>}
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
      <TextField label="Event" value={eventTag} onChange={(e) => setEventTag(e.target.value)} fullWidth margin="normal" required />
      <TextField label="Location" value={location} onChange={(e) => setLocation(e.target.value)} fullWidth margin="normal" required />
      <TextField label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} fullWidth margin="normal" InputLabelProps={{ shrink: true }} required />
      <TextField label="Additional Keywords" value={keywords} onChange={(e) => setKeywords(e.target.value)} fullWidth margin="normal" placeholder="Comma separated" />
      <Button variant="contained" color="primary" onClick={handleUpload} sx={{ mt: 2 }}>
        Upload
      </Button>
      {uploadProgress > 0 && (
        <Box sx={{ mt: 2 }}>
          <LinearProgress variant="determinate" value={uploadProgress} />
          <Typography variant="body2" color="textSecondary">Upload Progress: {uploadProgress}%</Typography>
        </Box>
      )}
    </Box>
  );
};

export default VideoUploadComponent;
