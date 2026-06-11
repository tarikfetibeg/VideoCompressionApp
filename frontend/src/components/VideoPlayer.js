import React, { useEffect, useMemo, useRef, useState } from 'react';
import axiosInstance from '../axiosConfig';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import ContentCutIcon from '@mui/icons-material/ContentCut';
import DeleteIcon from '@mui/icons-material/Delete';
import FlagIcon from '@mui/icons-material/Flag';
import NotesIcon from '@mui/icons-material/Notes';
import RadioButtonCheckedIcon from '@mui/icons-material/RadioButtonChecked';
import ReplayIcon from '@mui/icons-material/Replay';

const markerTypes = [
  {
    type: 'cut',
    label: 'Cut',
    defaultDescription: 'Cut point',
    icon: <ContentCutIcon fontSize="small" />,
    color: 'error',
  },
  {
    type: 'in',
    label: 'In',
    defaultDescription: 'In point',
    icon: <FlagIcon fontSize="small" />,
    color: 'success',
  },
  {
    type: 'out',
    label: 'Out',
    defaultDescription: 'Out point',
    icon: <FlagIcon fontSize="small" />,
    color: 'warning',
  },
  {
    type: 'note',
    label: 'Note',
    defaultDescription: 'Note',
    icon: <NotesIcon fontSize="small" />,
    color: 'primary',
  },
];

const getMarkerColor = (type) => {
  const match = markerTypes.find((markerType) => markerType.type === type);
  return match?.color || 'default';
};

const sortByTimestamp = (timecodes) =>
  [...timecodes].sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0));

const VideoPlayer = ({ videoId, initialStart = 0, onTimecodesChange, readOnly = false }) => {
  const [videoBlobUrl, setVideoBlobUrl] = useState('');
  const [timecodes, setTimecodes] = useState([]);
  const [loadingVideo, setLoadingVideo] = useState(false);
  const [videoError, setVideoError] = useState('');
  const [timecodeError, setTimecodeError] = useState('');
  const [markerNote, setMarkerNote] = useState('');
  const [currentTime, setCurrentTime] = useState(0);
  const [markerMessage, setMarkerMessage] = useState('');
  const playerRef = useRef(null);

  const sortedTimecodes = useMemo(() => sortByTimestamp(timecodes), [timecodes]);

  useEffect(() => {
    if (onTimecodesChange) {
      onTimecodesChange(sortedTimecodes);
    }
  }, [onTimecodesChange, sortedTimecodes]);

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
        setVideoError('Preview could not be loaded.');
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
        console.error('Error fetching markers:', error);
        setTimecodeError('Markers could not be loaded.');
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

  const getPlayheadTime = () => {
    if (!playerRef.current) return 0;
    return Number(playerRef.current.currentTime) || 0;
  };

  const handleTimecodeClick = (timestamp) => {
    if (playerRef.current) {
      playerRef.current.currentTime = Number(timestamp) || 0;
      setCurrentTime(Number(timestamp) || 0);
      playerRef.current.play().catch(() => {});
    }
  };

  const handleAddMarker = (markerType) => {
    const timestamp = getPlayheadTime();
    const description = markerNote.trim() || markerType.defaultDescription;

    setTimecodeError('');
    setMarkerMessage('');

    axiosInstance
      .post(`/videos/${videoId}/timecodes`, {
        description,
        timestamp,
        type: markerType.type,
      })
      .then((response) => {
        setTimecodes(Array.isArray(response.data.timecodes) ? response.data.timecodes : []);
        setMarkerNote('');
        setMarkerMessage(`${markerType.label} marker added at ${formatTime(timestamp)}.`);
      })
      .catch((error) => {
        console.error('Error adding marker:', error);
        setTimecodeError(error.response?.data?.message || 'Marker could not be saved.');
      });
  };

  const handleDeleteMarker = (timecodeId) => {
    setTimecodeError('');
    setMarkerMessage('');

    axiosInstance
      .delete(`/videos/${videoId}/timecodes/${timecodeId}`)
      .then((response) => {
        setTimecodes(Array.isArray(response.data.timecodes) ? response.data.timecodes : []);
        setMarkerMessage('Marker deleted.');
      })
      .catch((error) => {
        console.error('Error deleting marker:', error);
        setTimecodeError(error.response?.data?.message || 'Marker could not be deleted.');
      });
  };

  return (
    <Box sx={{ mt: 3 }}>
      <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 }, borderRadius: 2 }}>
        <Stack direction={{ xs: 'column', lg: 'row' }} spacing={3}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              justifyContent="space-between"
              alignItems={{ xs: 'flex-start', sm: 'center' }}
              spacing={1}
              sx={{ mb: 2 }}
            >
              <Typography variant="h5" sx={{ fontWeight: 800 }}>
                Preview
              </Typography>
              <Chip label={`Playhead ${formatTime(currentTime)}`} size="small" variant="outlined" />
            </Stack>

            {loadingVideo && (
              <Box
                sx={{
                  height: 300,
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
                  onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
                  onLoadedMetadata={(event) => {
                    const startTime = Number(initialStart) || 0;
                    event.currentTarget.currentTime = startTime;
                    setCurrentTime(startTime);
                  }}
                  onError={(event) => {
                    console.error('Video playback error:', event);
                    setVideoError('Browser cannot play this preview.');
                  }}
                  style={{ display: 'block' }}
                />
              </Box>
            )}

            <Paper variant="outlined" sx={{ mt: 2, p: 2, borderRadius: 2 }}>
              <Stack spacing={2}>
                {!readOnly && (
                  <>
                    <Stack
                      direction={{ xs: 'column', md: 'row' }}
                      spacing={1}
                      alignItems={{ xs: 'stretch', md: 'center' }}
                    >
                      <TextField
                        label="Marker note"
                        value={markerNote}
                        onChange={(event) => setMarkerNote(event.target.value)}
                        fullWidth
                        size="small"
                      />
                      <Button
                        variant="outlined"
                        startIcon={<ReplayIcon />}
                        onClick={() => {
                          if (playerRef.current) {
                            playerRef.current.currentTime = 0;
                            setCurrentTime(0);
                          }
                        }}
                        sx={{ minWidth: 120 }}
                      >
                        Reset
                      </Button>
                    </Stack>

                    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                      {markerTypes.map((markerType) => (
                        <Button
                          key={markerType.type}
                          variant={markerType.type === 'cut' ? 'contained' : 'outlined'}
                          color={markerType.color}
                          startIcon={markerType.icon}
                          onClick={() => handleAddMarker(markerType)}
                        >
                          {markerType.label}
                        </Button>
                      ))}
                    </Stack>
                  </>
                )}

                {markerMessage && <Alert severity="success">{markerMessage}</Alert>}
                {timecodeError && <Alert severity="warning">{timecodeError}</Alert>}
              </Stack>
            </Paper>
          </Box>

          <Box sx={{ width: { xs: '100%', lg: 380 }, flexShrink: 0 }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
              <Typography variant="h6" sx={{ fontWeight: 800 }}>
                Markers
              </Typography>
              <Chip label={sortedTimecodes.length} size="small" />
            </Stack>

            <Divider sx={{ mb: 1 }} />

            {sortedTimecodes.length === 0 ? (
              <Box sx={{ py: 4, textAlign: 'center' }}>
                <RadioButtonCheckedIcon color="disabled" />
                <Typography variant="body2" color="text.secondary">
                  No markers.
                </Typography>
              </Box>
            ) : (
              <List dense disablePadding>
                {sortedTimecodes.map((tc, index) => (
                  <ListItem
                    key={tc._id || `${tc.timestamp}-${index}`}
                    disablePadding
                    secondaryAction={
                      !readOnly && tc._id ? (
                        <Tooltip title="Delete marker">
                          <IconButton
                            edge="end"
                            size="small"
                            onClick={(event) => {
                              event.stopPropagation();
                              handleDeleteMarker(tc._id);
                            }}
                          >
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      ) : null
                    }
                    sx={{ mb: 0.75 }}
                  >
                    <ListItemButton
                      onClick={() => handleTimecodeClick(tc.timestamp)}
                      sx={{
                        border: '1px solid',
                        borderColor: 'divider',
                        borderRadius: 1,
                        pr: tc._id ? 6 : 2,
                      }}
                    >
                      <ListItemText
                        primary={
                          <Stack direction="row" spacing={1} alignItems="center">
                            <Chip
                              label={tc.type || 'marker'}
                              size="small"
                              color={getMarkerColor(tc.type)}
                              sx={{ textTransform: 'capitalize' }}
                            />
                            <Typography variant="body2" sx={{ fontWeight: 800 }}>
                              {formatTime(tc.timestamp)}
                            </Typography>
                          </Stack>
                        }
                        secondary={tc.description || `Marker ${index + 1}`}
                      />
                    </ListItemButton>
                  </ListItem>
                ))}
              </List>
            )}
          </Box>
        </Stack>
      </Paper>
    </Box>
  );
};

const formatTime = (seconds) => {
  const totalSeconds = Math.max(0, Number(seconds) || 0);
  const wholeSeconds = Math.floor(totalSeconds);
  const milliseconds = Math.round((totalSeconds - wholeSeconds) * 1000);
  const date = new Date(0);
  date.setSeconds(wholeSeconds);
  return `${date.toISOString().substr(11, 8)}.${String(milliseconds).padStart(3, '0')}`;
};

export default VideoPlayer;
