import React, { useCallback, useContext, useEffect, useState } from 'react';
import VideoPlayer from '../components/VideoPlayer';
import EditJobComposer from '../components/jobs/EditJobComposer';
import { useParams, useSearchParams } from 'react-router-dom';
import {
  Alert,
  Button,
  Box,
  FormControl,
  InputLabel,
  LinearProgress,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import axios from '../axiosConfig';
import { UserContext } from '../contexts/UserContext';
import {
  ACTIVE_PROCESSING_REFRESH_MS,
  isVideoProcessingActive,
} from '../utils/videoProcessing';

const VideoDetailsPage = () => {
  const { videoId } = useParams();
  const [searchParams] = useSearchParams();
  const { user } = useContext(UserContext);
  const [videoData, setVideoData] = useState(null);
  const [timecodes, setTimecodes] = useState([]);
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

  useEffect(() => {
    if (!isVideoProcessingActive(videoData)) return undefined;

    const intervalId = window.setInterval(fetchVideoData, ACTIVE_PROCESSING_REFRESH_MS);
    return () => window.clearInterval(intervalId);
  }, [fetchVideoData, videoData]);

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
  const ownerId = videoData?.uploader?._id || videoData?.uploader;
  const isOwner = ownerId && user?.id && String(ownerId) === String(user.id);
  const canManageVideo =
    user?.role === 'Admin'
    || ['Editor', 'VideoEditor', 'Producer'].includes(user?.role)
    || (user?.role === 'Reporter' && isOwner);
  const canDownloadVideo =
    user?.role === 'Admin'
    || ['Editor', 'VideoEditor', 'Producer'].includes(user?.role)
    || (user?.role === 'Reporter' && isOwner);

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

  const handleRetryProcessing = () => {
    setActionMessage('');
    setActionError('');

    axios
      .post(`/videos/${videoId}/requeue-processing`)
      .then((response) => {
        setVideoData(response.data.video);
        setActionMessage(response.data?.message || 'Video processing has been queued again.');
      })
      .catch((error) => {
        console.error('Error retrying video processing:', error);
        setActionError(error.response?.data?.message || 'Video processing could not be retried.');
      });
  };

  const sourceSummary = videoData && [
    videoData.sourceFormat,
    videoData.sourceCodec,
    videoData.sourceResolution,
    videoData.sourceFramerate ? `${videoData.sourceFramerate} fps` : null,
    videoData.sourceAudioChannels ? `${videoData.sourceAudioChannels} audio ch` : null,
  ].filter(Boolean).join(' / ');

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
          <Typography>Reporter: {videoData.reporter?.username || 'N/A'}</Typography>
          <Typography>Editor: {videoData.editor?.username || 'N/A'}</Typography>
          <Typography>
            QA responsible: {videoData.qaResponsible?.username || 'N/A'}
            {videoData.qaResponsibilityType ? ` / ${videoData.qaResponsibilityType.replace(/_/g, ' ')}` : ''}
          </Typography>
          <Typography>Program: {videoData.program?.name || 'N/A'}</Typography>
          <Typography>Content type: {videoData.contentType?.name || videoData.finalCategory || 'N/A'}</Typography>
          {isVideoProcessingActive(videoData) && (
            <Box sx={{ mt: 1, mb: 1, maxWidth: 420 }}>
              <LinearProgress
                variant="determinate"
                value={Number(videoData.processingProgress) || 0}
              />
              <Typography variant="caption" color="text.secondary">
                Compression progress: {Number(videoData.processingProgress) || 0}%
              </Typography>
            </Box>
          )}
          {videoData.processingStatus === 'failed' && videoData.processingError && (
            <Typography color="error">Processing error: {videoData.processingError}</Typography>
          )}
          {sourceSummary && <Typography>Source: {sourceSummary}</Typography>}
          <Typography>QC: {videoData.qcStatus || 'pending'}</Typography>
          <Typography>Broadcast: {videoData.broadcastStatus || 'not_ready'}</Typography>
          {canManageVideo && videoData.processingStatus === 'failed' && (
            <Button variant="outlined" sx={{ mt: 1 }} onClick={handleRetryProcessing}>
              Retry Processing
            </Button>
          )}
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

      <VideoPlayer
        videoId={videoId}
        initialStart={Number(searchParams.get('start')) || 0}
        onTimecodesChange={setTimecodes}
        readOnly={!canManageVideo}
      />

      {videoData && canManageVideo && (
        <EditJobComposer video={videoData} timecodes={timecodes} />
      )}

      {canDownloadVideo && (
        <Button variant="contained" color="primary" sx={{ mt: 2 }} onClick={handleDownload}>
          Download Video
        </Button>
      )}
    </Box>
  );
};

export default VideoDetailsPage;
