import React, { useEffect, useMemo, useRef, useState } from 'react';
import Hls from 'hls.js';
import axiosInstance from '../axiosConfig';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  FormControl,
  IconButton,
  InputLabel,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Paper,
  Select,
  MenuItem,
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

const resolveMediaUrl = (url) => {
  if (!url || /^https?:\/\//i.test(url)) return url || '';
  const baseURL = axiosInstance.defaults.baseURL || '/api';
  if (/^https?:\/\//i.test(baseURL) && url.startsWith('/')) {
    return `${new URL(baseURL).origin}${url}`;
  }
  return url;
};

const VideoPlayer = ({
  videoId,
  initialStart = 0,
  onTimecodesChange,
  onPlaybackPositionChange,
  readOnly = false,
  compact = false,
}) => {
  const [mediaTicket, setMediaTicket] = useState(null);
  const [timecodes, setTimecodes] = useState([]);
  const [loadingVideo, setLoadingVideo] = useState(true);
  const [videoError, setVideoError] = useState('');
  const [timecodeError, setTimecodeError] = useState('');
  const [markerNote, setMarkerNote] = useState('');
  const [currentTime, setCurrentTime] = useState(0);
  const [markerMessage, setMarkerMessage] = useState('');
  const [quality, setQuality] = useState(-1);
  const [qualityLevels, setQualityLevels] = useState([]);
  const [buffering, setBuffering] = useState(false);
  const playerRef = useRef(null);
  const hlsRef = useRef(null);
  const resumeTimeRef = useRef(Number(initialStart) || 0);
  const ticketRefreshAttemptsRef = useRef(0);

  const sortedTimecodes = useMemo(() => sortByTimestamp(timecodes), [timecodes]);

  useEffect(() => {
    if (onTimecodesChange) {
      onTimecodesChange(sortedTimecodes);
    }
  }, [onTimecodesChange, sortedTimecodes]);

  useEffect(() => {
    let cancelled = false;
    const fetchMediaTicket = async () => {
      setLoadingVideo(true);
      setVideoError('');

      try {
        const response = await axiosInstance.post('/media/tickets', { videoId });
        if (!cancelled) {
          setMediaTicket({
            ...response.data,
            manifestUrl: resolveMediaUrl(response.data?.manifestUrl),
            fallbackUrl: resolveMediaUrl(response.data?.fallbackUrl),
          });
        }
      } catch (error) {
        if (!cancelled) {
          console.error('Error creating media ticket:', error);
          setVideoError(error.response?.data?.message || 'Preview se ne može pokrenuti.');
          setLoadingVideo(false);
        }
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

    fetchMediaTicket();
    fetchTimecodes();

    return () => {
      cancelled = true;
    };
  }, [videoId]);

  useEffect(() => {
    const videoElement = playerRef.current;
    if (!videoElement || (!mediaTicket?.manifestUrl && !mediaTicket?.fallbackUrl)) return undefined;

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    setQualityLevels([]);
    setQuality(-1);
    setLoadingVideo(true);
    setBuffering(false);

    const restorePosition = () => {
      const target = Number(resumeTimeRef.current || initialStart) || 0;
      if (target > 0 && Number.isFinite(videoElement.duration)) {
        videoElement.currentTime = Math.min(target, videoElement.duration || target);
      }
    };
    const switchToMp4Fallback = () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      if (!mediaTicket.fallbackUrl) {
        setLoadingVideo(false);
        setVideoError('HLS stream je prekinut, a MP4 fallback nije dostupan.');
        return;
      }
      videoElement.src = mediaTicket.fallbackUrl;
      videoElement.load();
    };

    if (mediaTicket.hlsAvailable && mediaTicket.manifestUrl && Hls.isSupported()) {
      const hls = new Hls({
        startLevel: -1,
        maxBufferLength: 30,
        backBufferLength: 30,
        enableWorker: true,
      });
      hlsRef.current = hls;
      hls.attachMedia(videoElement);
      hls.on(Hls.Events.MEDIA_ATTACHED, () => hls.loadSource(mediaTicket.manifestUrl));
      hls.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
        setQualityLevels((data.levels || []).map((level, index) => ({
          index,
          height: level.height,
          bitrate: level.bitrate,
        })));
        restorePosition();
        setLoadingVideo(false);
        ticketRefreshAttemptsRef.current = 0;
      });
      hls.on(Hls.Events.ERROR, (event, data) => {
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          hls.recoverMediaError();
          return;
        }
        if (ticketRefreshAttemptsRef.current < 2) {
          ticketRefreshAttemptsRef.current += 1;
          resumeTimeRef.current = Number(videoElement.currentTime) || 0;
          axiosInstance
            .post('/media/tickets', { videoId })
            .then((response) => setMediaTicket({
              ...response.data,
              manifestUrl: resolveMediaUrl(response.data?.manifestUrl),
              fallbackUrl: resolveMediaUrl(response.data?.fallbackUrl),
            }))
            .catch(switchToMp4Fallback);
          return;
        }
        switchToMp4Fallback();
      });
    } else if (
      mediaTicket.hlsAvailable
      && mediaTicket.manifestUrl
      && videoElement.canPlayType('application/vnd.apple.mpegurl')
    ) {
      videoElement.src = mediaTicket.manifestUrl;
      videoElement.load();
    } else {
      switchToMp4Fallback();
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      videoElement.removeAttribute('src');
      videoElement.load();
    };
  }, [initialStart, mediaTicket, videoId]);

  useEffect(() => {
    if (!mediaTicket?.expiresAt) return undefined;
    const refreshIn = Math.max(new Date(mediaTicket.expiresAt).getTime() - Date.now() - 60 * 1000, 1000);
    const timeoutId = window.setTimeout(() => {
      resumeTimeRef.current = Number(playerRef.current?.currentTime) || 0;
      axiosInstance
        .post('/media/tickets', { videoId })
        .then((response) => setMediaTicket({
          ...response.data,
          manifestUrl: resolveMediaUrl(response.data?.manifestUrl),
          fallbackUrl: resolveMediaUrl(response.data?.fallbackUrl),
        }))
        .catch(() => {});
    }, refreshIn);
    return () => window.clearTimeout(timeoutId);
  }, [mediaTicket?.expiresAt, videoId]);

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

  const handleQualityChange = (event) => {
    const nextLevel = Number(event.target.value);
    setQuality(nextLevel);
    if (hlsRef.current) hlsRef.current.currentLevel = nextLevel;
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
    <Box sx={{ mt: compact ? 0 : 3 }}>
      <Paper variant="outlined" sx={{ p: { xs: 1.5, md: compact ? 2 : 3 }, borderRadius: 2 }}>
        <Stack direction={{ xs: 'column', lg: compact ? 'column' : 'row' }} spacing={compact ? 2 : 3}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              justifyContent="space-between"
              alignItems={{ xs: 'flex-start', sm: 'center' }}
              spacing={1}
              sx={{ mb: 2 }}
            >
              <Typography variant={compact ? 'h6' : 'h5'} sx={{ fontWeight: 800 }}>
                Preview
              </Typography>
              <Chip label={`Playhead ${formatTime(currentTime)}`} size="small" variant="outlined" />
              {qualityLevels.length > 0 && (
                <FormControl size="small" sx={{ minWidth: 115 }}>
                  <InputLabel>Kvalitet</InputLabel>
                  <Select value={quality} label="Kvalitet" onChange={handleQualityChange}>
                    <MenuItem value={-1}>Auto</MenuItem>
                    {qualityLevels.map((level) => (
                      <MenuItem key={level.index} value={level.index}>
                        {level.height || '?'}p
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              )}
            </Stack>

            {loadingVideo && !mediaTicket && (
              <Box
                sx={{
                  width: '100%',
                  aspectRatio: '16 / 9',
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

            {mediaTicket && !videoError && (
              <Box
                sx={{
                  position: 'relative',
                  bgcolor: 'black',
                  borderRadius: 2,
                  overflow: 'hidden',
                  width: '100%',
                  aspectRatio: '16 / 9',
                }}
              >
                <video
                  ref={playerRef}
                  controls
                  preload="metadata"
                  playsInline
                  onTimeUpdate={(event) => {
                    const nextTime = event.currentTarget.currentTime;
                    setCurrentTime(nextTime);
                    resumeTimeRef.current = nextTime;
                    if (onPlaybackPositionChange) onPlaybackPositionChange(nextTime);
                  }}
                  onLoadedMetadata={(event) => {
                    const startTime = Number(resumeTimeRef.current || initialStart) || 0;
                    event.currentTarget.currentTime = startTime;
                    setCurrentTime(startTime);
                    setLoadingVideo(false);
                  }}
                  onCanPlay={() => {
                    setLoadingVideo(false);
                    setBuffering(false);
                  }}
                  onWaiting={() => setBuffering(true)}
                  onPlaying={() => setBuffering(false)}
                  onError={(event) => {
                    console.error('Video playback error:', event);
                    setVideoError('Browser cannot play this preview.');
                  }}
                  style={{
                    display: 'block',
                    width: '100%',
                    height: '100%',
                    objectFit: 'contain',
                    backgroundColor: '#000',
                  }}
                />
                {loadingVideo && (
                  <Box
                    sx={{
                      position: 'absolute',
                      inset: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      bgcolor: 'rgba(0, 0, 0, 0.32)',
                      pointerEvents: 'none',
                    }}
                  >
                    <CircularProgress sx={{ color: 'common.white' }} />
                  </Box>
                )}
              </Box>
            )}
            {buffering && !videoError && (
              <Alert severity="info" sx={{ mt: 1 }}>
                Učitavam naredni video segment...
              </Alert>
            )}

            <Paper variant="outlined" sx={{ mt: 2, p: compact ? 1.5 : 2, borderRadius: 2 }}>
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

          <Box sx={{ width: { xs: '100%', lg: compact ? '100%' : 380 }, flexShrink: 0 }}>
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
