import React, { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import DownloadIcon from '@mui/icons-material/Download';
import CloseIcon from '@mui/icons-material/Close';
import axiosInstance from '../../axiosConfig';

const BulkActionsComponent = ({
  selectedVideos,
  selectedVideoObjects,
  clearSelection,
  refreshVideos,
}) => {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  if (selectedVideos.length === 0) {
    return null;
  }

  const handleDownloadSelected = () => {
    setErrorMessage('');

    axiosInstance
      .post('/videos/download', { videoIds: selectedVideos }, { responseType: 'blob' })
      .then((response) => {
        const url = window.URL.createObjectURL(new Blob([response.data]));
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', `production_selection_${Date.now()}.zip`);
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.URL.revokeObjectURL(url);
      })
      .catch((error) => {
        console.error('Error downloading videos:', error);
        setErrorMessage('Selected videos could not be downloaded.');
      });
  };

  const handleDeleteConfirmed = () => {
    setErrorMessage('');

    Promise.all(selectedVideos.map((id) => axiosInstance.delete(`/videos/${id}`)))
      .then(() => {
        clearSelection();
        refreshVideos();
      })
      .catch((err) => {
        console.error('Error deleting videos:', err);
        setErrorMessage('Selected videos could not be deleted.');
      })
      .finally(() => setConfirmOpen(false));
  };

  const previewNames = selectedVideoObjects
    .slice(0, 4)
    .map((video) => video.originalFilename || video.filename)
    .filter(Boolean);

  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 2, borderRadius: 2 }}>
      {errorMessage && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {errorMessage}
        </Alert>
      )}

      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={2}
        alignItems={{ xs: 'flex-start', md: 'center' }}
        justifyContent="space-between"
      >
        <Box>
          <Typography sx={{ fontWeight: 800 }}>
            {selectedVideos.length} selected
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {previewNames.join(', ')}
            {selectedVideoObjects.length > previewNames.length ? '...' : ''}
          </Typography>
        </Box>

        <Stack direction="row" spacing={1}>
          <Button startIcon={<DownloadIcon />} variant="contained" onClick={handleDownloadSelected}>
            Download
          </Button>
          <Button startIcon={<DeleteIcon />} variant="outlined" color="error" onClick={() => setConfirmOpen(true)}>
            Delete
          </Button>
          <Button startIcon={<CloseIcon />} variant="text" onClick={clearSelection}>
            Clear
          </Button>
        </Stack>
      </Stack>

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)}>
        <DialogTitle>Delete selected material</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This will delete {selectedVideos.length} selected video record(s) and their stored files.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)}>Cancel</Button>
          <Button onClick={handleDeleteConfirmed} color="error" variant="contained">
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
};

export default BulkActionsComponent;
