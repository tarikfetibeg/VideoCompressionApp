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
import { useBackgroundDownloads } from '../../contexts/BackgroundDownloadContext';

const BulkActionsComponent = ({
  selectedVideos,
  selectedVideoObjects,
  clearSelection,
  refreshVideos,
}) => {
  const { startDownload } = useBackgroundDownloads();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [downloadQueued, setDownloadQueued] = useState(false);

  if (selectedVideos.length === 0) {
    return null;
  }

  const handleDownloadSelected = () => {
    setErrorMessage('');
    setDownloadQueued(true);

    startDownload({
      kind: 'video-bulk',
      payload: { videoIds: selectedVideos },
      label: `Materijal ZIP (${selectedVideos.length})`,
    })
      .catch((error) => {
        console.error('Error downloading videos:', error);
        setErrorMessage(error.response?.data?.message || 'Odabrani materijali se ne mogu skinuti.');
      })
      .finally(() => {
        setDownloadQueued(false);
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
        setErrorMessage('Odabrani materijali se ne mogu obrisati.');
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
      {downloadQueued && (
        <Alert severity="info" sx={{ mb: 2 }}>
          <Stack spacing={1}>
            <Typography variant="body2" sx={{ fontWeight: 700 }}>
              Pripremam ZIP paket za {selectedVideos.length} materijal(a). Status je u globalnom download panelu.
            </Typography>
          </Stack>
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
            Odabrano: {selectedVideos.length}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {previewNames.join(', ')}
            {selectedVideoObjects.length > previewNames.length ? '...' : ''}
          </Typography>
        </Box>

        <Stack direction="row" spacing={1}>
          <Button
            startIcon={<DownloadIcon />}
            variant="contained"
            onClick={handleDownloadSelected}
            disabled={downloadQueued}
          >
            {downloadQueued ? 'Pripremam ZIP...' : 'Skini'}
          </Button>
          <Button
            startIcon={<DeleteIcon />}
            variant="outlined"
            color="error"
            onClick={() => setConfirmOpen(true)}
            disabled={downloadQueued}
          >
            Obriši
          </Button>
          <Button startIcon={<CloseIcon />} variant="text" onClick={clearSelection} disabled={downloadQueued}>
            Očisti
          </Button>
        </Stack>
      </Stack>

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)}>
        <DialogTitle>Obriši odabrani materijal</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Ova akcija briše {selectedVideos.length} odabrani(h) video zapis(a) i pripadajuće fajlove.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)}>Odustani</Button>
          <Button onClick={handleDeleteConfirmed} color="error" variant="contained">
            Obriši
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
};

export default BulkActionsComponent;
