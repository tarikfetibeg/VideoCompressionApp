import React, { useEffect, useRef, useState } from 'react';
import axiosInstance from '../axiosConfig';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Divider,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Paper,
  Stack,
  Typography,
} from '@mui/material';

const VideoPlayer = ({ videoId }) => {
  const [videoBlobUrl, setVideoBlobUrl] = useState('');
  const [timecodes, setTimecodes] = useState([]);
  const [loadingVideo, setLoadingVideo] = useState(false);
  const [videoError, setVideoError] = useState('');
  const [timecodeError, setTimecodeError] = useState('');
  const playerRef = useRef(null);

  useEffect(() => {
    let objectUrl = '';

    const fetchVideo = async () => {
      setLoadingVideo(true);
      setVideoError('');

      try {
        const response = await axiosInstance.get(`/videos/preview/${videoId}`, {
          responseType: 'blob',
        });

        objectUrl = URL.createObjectURL(response.data);
        setVideoBlobUrl(objectUrl);
      } catch (error) {
        console.error('Error fetching video preview:', error);
        setVideoError('Preview se ne može učitati.');
      } finally {
        setLoadingVideo(false);
      }
    };

    const fetchTimecodes = async () => {
      setTimecodeError('');

      try {
        const response = await axiosInstance.get(`/videos/${videoId}/timecodes`);
        setTimecodes(Array.isArray(response.data) ? response.data : []);
      } catch (error) {
        console.error('Error fetching timecodes:', error);
        setTimecodeError('Timecode podaci se ne mogu učitati.');
      }
    };

    fetchVideo();
    fetchTimecodes();

    return () => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [videoId]);

  const handleTimecodeClick = (timestamp) => {
    if (playerRef.current) {
      playerRef.current.currentTime = timestamp;
      playerRef.current.play().catch(() => {});
    }
  };

  return (
    <Box sx={{ mt: 3 }}>
      <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 }, borderRadius: 3 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={3}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="h5" sx={{ fontWeight: 800, mb: 2 }}>
              Preview
            </Typography>

            {loadingVideo && (
              <Box
                sx={{
                  height: 260,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  bgcolor: 'grey.100',
                  borderRadius: 2,
                }}
              >
                <CircularProgress />
              </Box>
            )}

            {videoError && <Alert severity="error">{videoError}</Alert>}

            {!loadingVideo && !videoError && (
              <Box
                sx={{
                  bgcolor: 'black',
                  borderRadius: 2,
                  overflow: 'hidden',
                }}
              >
                <video
                  ref={playerRef}
                  controls
                  width="100%"
                  height="auto"
                  src={videoBlobUrl}
                  onError={(e) => {
                    console.error('Video playback error:', e);
                    setVideoError('Browser ne može reproducirati ovaj preview.');
                  }}
                  style={{ display: 'block' }}
                />
              </Box>
            )}
          </Box>

          <Box sx={{ width: { xs: '100%', md: 340 } }}>
            <Typography variant="h6" sx={{ fontWeight: 800, mb: 1 }}>
              Timecodes
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Klik na timecode pomjera video na označeno vrijeme.
            </Typography>

            {timecodeError && <Alert severity="warning" sx={{ mb: 2 }}>{timecodeError}</Alert>}

            <Divider sx={{ mb: 1 }} />

            {timecodes.length === 0 ? (
              <Box sx={{ py: 3, textAlign: 'center' }}>
                <Typography variant="body2" color="text.secondary">
                  Nema timecode oznaka.
                </Typography>
              </Box>
            ) : (
              <List dense>
                {timecodes.map((tc, index) => (
                  <ListItem key={`${tc.timestamp}-${index}`} disablePadding>
                    <ListItemButton onClick={() => handleTimecodeClick(tc.timestamp)}>
                      <ListItemText
                        primary={tc.description || `Timecode ${index + 1}`}
                        secondary={formatTime(tc.timestamp)}
                      />
                    </ListItemButton>
                  </ListItem>
                ))}
              </List>
            )}

            <Button
              variant="outlined"
              fullWidth
              sx={{ mt: 2 }}
              onClick={() => {
                if (playerRef.current) {
                  playerRef.current.currentTime = 0;
                }
              }}
            >
              Reset playback
            </Button>
          </Box>
        </Stack>
      </Paper>
    </Box>
  );
};

const formatTime = (seconds) => {
  const date = new Date(0);
  date.setSeconds(Number(seconds) || 0);
  return date.toISOString().substr(11, 8);
};

export default VideoPlayer;