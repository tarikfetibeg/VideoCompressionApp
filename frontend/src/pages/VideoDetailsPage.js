import React, { useCallback, useContext, useEffect, useState } from 'react';
import VideoPlayer from '../components/VideoPlayer';
import AddTimecode from '../components/AddTimecode';
import { useParams } from 'react-router-dom';
import {
  Alert,
  Button,
  Box,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import axios from '../axiosConfig';
import { UserContext } from '../contexts/UserContext';

const VideoDetailsPage = () => {
  const { videoId } = useParams();
  const { user } = useContext(UserContext);
  const [videoData, setVideoData] = useState(null);
  const [qcStatus, setQcStatus] = useState('pending');
  const [qcNotes, setQcNotes] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [actionError, setActionError] = useState('');

  const fetchVideoData = useCallback(() => {
    axios.get(`/videos/details/${videoId}`)
      .then(response => {
        setVideoData(response.data);
        setQcStatus(response.data.qcStatus || 'pending');
        setQcNotes(response.data.qcNotes || '');
      })
      .catch(error => {
        console.error('Error fetching video details:', error);
      });
  }, [videoId]);

  useEffect(() => {
    fetchVideoData();
  }, [fetchVideoData]);

  const handleDownload = () => {
    axios
      .get(`/videos/download/${videoId}`, {
        responseType: 'blob',
      })
      .then((response) => {
        const url = window.URL.createObjectURL(new Blob([response.data]));
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', `video_${videoId}.mp4`);
        document.body.appendChild(link);
        link.click();
        link.parentNode.removeChild(link);
      })
      .catch((error) => {
        console.error('Error downloading video:', error);
      });
  };

  const canUpdateQc = ['Editor', 'VideoEditor', 'Producer', 'Admin'].includes(user?.role);
  const canUpdateBroadcastStatus = ['Producer', 'Admin'].includes(user?.role);

  const handleSaveQc = () => {
    setActionMessage('');
    setActionError('');

    axios
      .patch(`/videos/${videoId}/qc`, {
        qcStatus,
        qcNotes,
      })
      .then((response) => {
        setVideoData(response.data.video);
        setActionMessage('QC status saved.');
      })
      .catch((error) => {
        console.error('Error saving QC status:', error);
        setActionError(error.response?.data?.message || 'Error saving QC status.');
      });
  };

  const handleBroadcastStatus = (broadcastStatus) => {
    setActionMessage('');
    setActionError('');

    axios
      .patch(`/videos/${videoId}/broadcast-status`, {
        broadcastStatus,
      })
      .then((response) => {
        setVideoData(response.data.video);
        setActionMessage('Broadcast status updated.');
      })
      .catch((error) => {
        console.error('Error updating broadcast status:', error);
        setActionError(error.response?.data?.message || 'Error updating broadcast status.');
      });
  };

  return (
    <Box sx={{ mt: 4 }}>
      {actionMessage && <Alert severity="success" sx={{ mb: 2 }}>{actionMessage}</Alert>}
      {actionError && <Alert severity="error" sx={{ mb: 2 }}>{actionError}</Alert>}

      {videoData && (
        <Box sx={{ mb: 2 }}>
          <Typography variant="h6">Video Details</Typography>
          <Typography>Filename: {videoData.originalFilename || videoData.filename}</Typography>
          <Typography>Event: {videoData.event || 'N/A'}</Typography>
          <Typography>Location: {videoData.location || 'N/A'}</Typography>
          <Typography>
            Date: {videoData.tagDate ? new Date(videoData.tagDate).toLocaleDateString() : 'N/A'}
          </Typography>
          <Typography>Status: {videoData.status}</Typography>
          <Typography>Processing: {videoData.processingStatus}</Typography>
          <Typography>QC: {videoData.qcStatus || 'pending'}</Typography>
          <Typography>Broadcast: {videoData.broadcastStatus || 'not_ready'}</Typography>
        </Box>
      )}

      {videoData && (canUpdateQc || canUpdateBroadcastStatus) && (
        <Box sx={{ mb: 3 }}>
          <Typography variant="h6" sx={{ mb: 2 }}>
            QC & Broadcast Control
          </Typography>

          {canUpdateQc && (
            <Stack spacing={2} sx={{ maxWidth: 520, mb: 2 }}>
              <FormControl fullWidth>
                <InputLabel>QC Status</InputLabel>
                <Select
                  value={qcStatus}
                  label="QC Status"
                  onChange={(e) => setQcStatus(e.target.value)}
                >
                  <MenuItem value="pending">Pending</MenuItem>
                  <MenuItem value="passed">Passed</MenuItem>
                  <MenuItem value="failed">Failed</MenuItem>
                </Select>
              </FormControl>
              <TextField
                label="QC Notes"
                value={qcNotes}
                onChange={(e) => setQcNotes(e.target.value)}
                multiline
                minRows={3}
                fullWidth
              />
              <Button variant="contained" onClick={handleSaveQc}>
                Save QC
              </Button>
            </Stack>
          )}

          {canUpdateBroadcastStatus && (
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
              <Button
                variant="outlined"
                onClick={() => handleBroadcastStatus('approved_for_air')}
              >
                Approve for Air
              </Button>
              <Button
                variant="outlined"
                onClick={() => handleBroadcastStatus('aired')}
              >
                Mark Aired
              </Button>
              <Button
                variant="outlined"
                color="warning"
                onClick={() => handleBroadcastStatus('archived')}
              >
                Archive
              </Button>
            </Stack>
          )}
        </Box>
      )}

      <VideoPlayer videoId={videoId} />
      <Button variant="contained" color="primary" sx={{ mt: 2 }} onClick={handleDownload}>
        Download Video
      </Button>
      <AddTimecode videoId={videoId} />
    </Box>
  );
};

export default VideoDetailsPage;
