import React, { useState } from 'react';
import { Box, Button, Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions } from '@mui/material';
import axiosInstance from '../../axiosConfig';

const BulkActionsComponent = ({ selectedVideos, clearSelection, refreshVideos }) => {
  const [confirmOpen, setConfirmOpen] = useState(false);

  const handleDownloadSelected = () => {
    axiosInstance
      .post('/videos/download', { videoIds: selectedVideos }, { responseType: 'blob' })
      .then((response) => {
        const url = window.URL.createObjectURL(new Blob([response.data]));
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', `videos_${Date.now()}.zip`);
        document.body.appendChild(link);
        link.click();
        link.parentNode.removeChild(link);
      })
      .catch((error) => {
        console.error('Error downloading videos:', error);
      });
  };

  const handleDeleteConfirmed = () => {
    Promise.all(selectedVideos.map(id => axiosInstance.delete(`/videos/${id}`)))
      .then(() => {
        clearSelection();
        refreshVideos();
      })
      .catch(err => {
        console.error('Error deleting videos:', err);
      });
    setConfirmOpen(false);
  };

  return (
    <Box sx={{ mb: 2 }}>
      <Button variant="contained" color="primary" onClick={handleDownloadSelected}>
        Bulk Download ({selectedVideos.length})
      </Button>
      <Button variant="contained" color="error" sx={{ ml: 2 }} onClick={() => setConfirmOpen(true)}>
        Bulk Delete ({selectedVideos.length})
      </Button>
      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)}>
        <DialogTitle>Confirm Bulk Deletion</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to delete the following videos?
          </DialogContentText>
          <ul>
            {selectedVideos.map(id => (
              <li key={id}>
                {id}
                {/* In practice, replace id with a friendly filename if available */}
              </li>
            ))}
          </ul>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)}>Cancel</Button>
          <Button onClick={handleDeleteConfirmed} color="error">
            Confirm Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default BulkActionsComponent;
