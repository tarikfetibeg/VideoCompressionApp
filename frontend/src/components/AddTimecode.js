import React, { useState } from 'react';
import axios from '../axiosConfig';
import {
  Box,
  TextField,
  Button,
  Typography,
  Alert,
} from '@mui/material';

const AddTimecode = ({ videoId }) => {
  const [description, setDescription] = useState('');
  const [timestamp, setTimestamp] = useState('');
  const [message, setMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const handleAddTimecode = (e) => {
    e.preventDefault();

    axios
      .post(`/videos/${videoId}/timecodes`, {
        description,
        timestamp: parseFloat(timestamp),
      })
      .then(() => {
        setMessage('Timecode added successfully.');
        setDescription('');
        setTimestamp('');
        setErrorMessage('');
      })
      .catch((error) => {
        console.error('Error adding timecode:', error);
        setErrorMessage(
          error.response && error.response.data
            ? error.response.data.message
            : 'Error adding timecode.'
        );
      });
  };

  return (
    <Box sx={{ mt: 4 }}>
      <Typography variant="h6">Add Timecode</Typography>
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
      <Box component="form" onSubmit={handleAddTimecode} sx={{ mt: 2 }}>
        <TextField
          label="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          required
          fullWidth
          margin="normal"
        />
        <TextField
          label="Timestamp (in seconds)"
          type="number"
          value={timestamp}
          onChange={(e) => setTimestamp(e.target.value)}
          required
          fullWidth
          margin="normal"
        />
        <Button type="submit" variant="contained" sx={{ mt: 2 }}>
          Add Timecode
        </Button>
      </Box>
    </Box>
  );
};

export default AddTimecode;
