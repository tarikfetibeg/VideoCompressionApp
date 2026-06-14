import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import axiosInstance from '../axiosConfig';
import { Link } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Card,
  CardActions,
  CardContent,
  CardMedia,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  FormControl,
  Grid,
  InputLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import ReplayIcon from '@mui/icons-material/Replay';
import { UserContext } from '../contexts/UserContext';
import {
  ACTIVE_PROCESSING_REFRESH_MS,
  hasActiveVideoProcessing,
} from '../utils/videoProcessing';

const formatBytes = (bytes) => {
  if (!bytes || Number.isNaN(Number(bytes))) return 'N/A';

  const value = Number(bytes);
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
};

const formatDate = (value) => {
  if (!value) return 'N/A';
  return new Date(value).toLocaleDateString();
};

const getUploaderName = (video) => video.uploader?.username || 'Unknown uploader';
const getContentTypeName = (video) => video.contentType?.name || video.finalCategory || 'No category';

const shouldShowProcessingProgress = (video) =>
  ['queued', 'processing'].includes(video.processingStatus);

const VideoThumbnail = ({ videoId, title }) => {
  const [src, setSrc] = useState('');

  useEffect(() => {
    let objectUrl = '';

    axiosInstance
      .get(`/videos/thumbnail/${videoId}`, { responseType: 'blob' })
      .then((response) => {
        objectUrl = URL.createObjectURL(response.data);
        setSrc(objectUrl);
      })
      .catch(() => {
        setSrc('');
      });

    return () => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [videoId]);

  if (!src) {
    return (
      <Box
        sx={{
          height: 150,
          bgcolor: 'grey.100',
          color: 'text.secondary',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Typography variant="body2">No thumbnail</Typography>
      </Box>
    );
  }

  return (
    <CardMedia
      component="img"
      height="150"
      image={src}
      alt={title}
      sx={{ objectFit: 'cover' }}
    />
  );
};

const VideoList = ({
  scope = 'mine',
  library = 'all',
  title = 'Videos',
  description = 'Pregled, preview, skidanje i brisanje dostupnih video materijala.',
  readOnly = false,
}) => {
  const [videos, setVideos] = useState([]);
  const [selectedVideos, setSelectedVideos] = useState([]);
  const [contentTypes, setContentTypes] = useState([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [eventFilter, setEventFilter] = useState('all');
  const [contentTypeFilter, setContentTypeFilter] = useState('all');
  const [message, setMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const { user } = useContext(UserContext);
  const showContentTypeFilter = library === 'archive';

  const fetchVideos = useCallback(({ silent = false } = {}) => {
    if (!silent) {
      setMessage('');
      setErrorMessage('');
    }

    const params = new URLSearchParams();
    if (scope === 'station') params.set('scope', 'station');
    if (library === 'archive') params.set('library', 'archive');
    if (showContentTypeFilter && contentTypeFilter !== 'all') {
      params.set('contentTypeId', contentTypeFilter);
    }
    const query = params.toString() ? `?${params.toString()}` : '';

    axiosInstance
      .get(`/videos${query}`, { headers: { Accept: 'application/json' } })
      .then((response) => {
        const data = Array.isArray(response.data) ? response.data : [];
        setVideos(data);
      })
      .catch((error) => {
        console.error('Error fetching videos:', error);
        if (!silent) {
          setErrorMessage('Greška pri učitavanju videa.');
        }
      });
  }, [scope, library, showContentTypeFilter, contentTypeFilter]);

  useEffect(() => {
    fetchVideos();
  }, [fetchVideos]);

  const hasActiveProcessing = useMemo(() => hasActiveVideoProcessing(videos), [videos]);

  useEffect(() => {
    if (!hasActiveProcessing) return undefined;

    const intervalId = window.setInterval(() => {
      fetchVideos({ silent: true });
    }, ACTIVE_PROCESSING_REFRESH_MS);

    return () => window.clearInterval(intervalId);
  }, [fetchVideos, hasActiveProcessing]);

  const eventOptions = useMemo(() => {
    const events = videos.map((video) => video.event || 'No event');
    return Array.from(new Set(events)).sort();
  }, [videos]);

  const filteredVideos = useMemo(() => {
    const search = searchTerm.toLowerCase().trim();

    return videos.filter((video) => {
      const eventValue = video.event || 'No event';

      const matchesEvent = eventFilter === 'all' || eventValue === eventFilter;

      const matchesSearch =
        !search ||
        [
          video.originalFilename,
          video.filename,
          video.event,
          video.location,
          video.status,
          video.processingStatus,
          video.correctionStatus,
          video.correctionNote,
          video.correctionReportedBy?.username,
          video.finalCategory,
          video.contentType?.name,
          getUploaderName(video),
        ]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(search));

      return matchesEvent && matchesSearch;
    });
  }, [videos, searchTerm, eventFilter]);

  useEffect(() => {
    if (!showContentTypeFilter) return;

    axiosInstance
      .get('/broadcast/content-types')
      .then((response) => {
        setContentTypes(Array.isArray(response.data) ? response.data : []);
      })
      .catch((error) => {
        console.error('Error loading content types:', error);
      });
  }, [showContentTypeFilter]);

  const handleSelectVideo = (videoId) => {
    if (readOnly) return;

    setSelectedVideos((prevSelected) =>
      prevSelected.includes(videoId)
        ? prevSelected.filter((id) => id !== videoId)
        : [...prevSelected, videoId]
    );
  };

  const handleSelectAllFiltered = () => {
    if (readOnly) return;

    const filteredIds = filteredVideos.map((video) => video._id);
    const allSelected = filteredIds.every((id) => selectedVideos.includes(id));

    if (allSelected) {
      setSelectedVideos((prev) => prev.filter((id) => !filteredIds.includes(id)));
    } else {
      setSelectedVideos((prev) => Array.from(new Set([...prev, ...filteredIds])));
    }
  };

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
        link.remove();

        window.URL.revokeObjectURL(url);
      })
      .catch((error) => {
        console.error('Error downloading videos:', error);
        setErrorMessage('Greška pri skidanju odabranih videa.');
      });
  };

  const handleDownloadSingle = (video) => {
    axiosInstance
      .get(`/videos/download/${video._id}`, { responseType: 'blob' })
      .then((response) => {
        const url = window.URL.createObjectURL(new Blob([response.data]));
        const link = document.createElement('a');

        link.href = url;
        link.setAttribute('download', video.originalFilename || video.filename || `video_${video._id}`);
        document.body.appendChild(link);
        link.click();
        link.remove();

        window.URL.revokeObjectURL(url);
      })
      .catch((error) => {
        console.error('Error downloading video:', error);
        setErrorMessage('Greška pri skidanju videa.');
      });
  };

  const handleRetryProcessing = (video) => {
    setMessage('');
    setErrorMessage('');

    axiosInstance
      .post(`/videos/${video._id}/requeue-processing`)
      .then((response) => {
        setMessage(response.data?.message || 'Video processing has been queued again.');
        fetchVideos();
      })
      .catch((error) => {
        console.error('Error retrying video processing:', error);
        setErrorMessage(error.response?.data?.message || 'Greska pri ponovnom pokretanju obrade.');
      });
  };

  const handleBulkDelete = (videoIds) => {
    const endpoint = user.role === 'Admin' ? '/admin/videos' : '/videos';

    Promise.all(videoIds.map((id) => axiosInstance.delete(`${endpoint}/${id}`)))
      .then(() => {
        setVideos((prev) => prev.filter((video) => !videoIds.includes(video._id)));
        setSelectedVideos([]);
        setMessage('Odabrani video materijali su obrisani.');
        setErrorMessage('');
      })
      .catch((err) => {
        console.error('Error deleting videos:', err);
        setErrorMessage('Greška pri brisanju odabranih videa.');
      });
  };

  const handleDeleteSingle = (videoId) => {
    const endpoint = user.role === 'Admin' ? '/admin/videos' : '/videos';

    axiosInstance
      .delete(`${endpoint}/${videoId}`)
      .then(() => {
        setVideos((prev) => prev.filter((video) => video._id !== videoId));
        setSelectedVideos((prev) => prev.filter((id) => id !== videoId));
        setMessage('Video je obrisan.');
      })
      .catch((err) => {
        console.error('Error deleting video:', err);
        setErrorMessage('Greška pri brisanju videa.');
      });
  };

  return (
    <Box sx={{ mt: 4 }}>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        justifyContent="space-between"
        alignItems={{ xs: 'flex-start', md: 'center' }}
        spacing={2}
        sx={{ mb: 3 }}
      >
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 800 }}>
            {title}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {description}
          </Typography>
        </Box>

        <Button variant="outlined" onClick={fetchVideos}>
          Refresh
        </Button>
      </Stack>

      {message && <Alert severity="success" sx={{ mb: 2 }}>{message}</Alert>}
      {errorMessage && <Alert severity="error" sx={{ mb: 2 }}>{errorMessage}</Alert>}

      <Paper variant="outlined" sx={{ p: 2, mb: 3, borderRadius: 3 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} md={showContentTypeFilter ? 4 : 6}>
            <TextField
              label="Search"
              fullWidth
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Filename, event..."
            />
          </Grid>

          <Grid item xs={12} md={4}>
            <FormControl fullWidth>
              <InputLabel>Event</InputLabel>
              <Select
                value={eventFilter}
                label="Event"
                onChange={(e) => setEventFilter(e.target.value)}
              >
                <MenuItem value="all">All events</MenuItem>
                {eventOptions.map((eventName) => (
                  <MenuItem key={eventName} value={eventName}>
                    {eventName}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>

          {showContentTypeFilter && (
            <Grid item xs={12} md={readOnly ? 4 : 2}>
              <FormControl fullWidth>
                <InputLabel>Video category</InputLabel>
                <Select
                  value={contentTypeFilter}
                  label="Video category"
                  onChange={(event) => {
                    setContentTypeFilter(event.target.value);
                    setEventFilter('all');
                  }}
                >
                  <MenuItem value="all">All categories</MenuItem>
                  {contentTypes.map((type) => (
                    <MenuItem key={type._id} value={type._id}>
                      {type.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
          )}

          {!readOnly && (
            <Grid item xs={12} md={2}>
              <Button fullWidth variant="outlined" onClick={handleSelectAllFiltered}>
                Select
              </Button>
            </Grid>
          )}
        </Grid>
      </Paper>

      {!readOnly && selectedVideos.length > 0 && (
        <Paper variant="outlined" sx={{ p: 2, mb: 3, borderRadius: 3 }}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems="center">
            <Typography sx={{ fontWeight: 700 }}>
              Selected: {selectedVideos.length}
            </Typography>
            <Button variant="contained" onClick={handleDownloadSelected}>
              Download Selected
            </Button>
            <Button
              variant="outlined"
              color="error"
              onClick={() => setConfirmOpen(true)}
            >
              Delete Selected
            </Button>
          </Stack>
        </Paper>
      )}

      {filteredVideos.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 4, borderRadius: 3, textAlign: 'center' }}>
          <Typography variant="h6">No videos available</Typography>
          <Typography variant="body2" color="text.secondary">
            Nema video materijala za trenutni prikaz.
          </Typography>
        </Paper>
      ) : (
        <Grid container spacing={3}>
          {filteredVideos.map((video) => {
            const selected = selectedVideos.includes(video._id);

            return (
              <Grid item xs={12} md={6} lg={4} key={video._id}>
                <Card
                  variant="outlined"
                  sx={{
                    borderRadius: 3,
                    overflow: 'hidden',
                    height: '100%',
                    borderColor: selected ? 'primary.main' : 'divider',
                    boxShadow: selected ? 3 : 0,
                  }}
                >
                  <Box sx={{ position: 'relative' }}>
                    <VideoThumbnail
                      videoId={video._id}
                      title={video.originalFilename || video.filename}
                    />
                    {!readOnly && (
                      <Checkbox
                        checked={selected}
                        onChange={() => handleSelectVideo(video._id)}
                        sx={{
                          position: 'absolute',
                          top: 8,
                          left: 8,
                          bgcolor: 'background.paper',
                          borderRadius: 1,
                        }}
                      />
                    )}
                  </Box>

                  <CardContent>
                    <Typography variant="h6" sx={{ fontWeight: 800 }} noWrap>
                      {video.originalFilename || video.filename}
                    </Typography>

                    <Typography variant="body2" color="text.secondary" noWrap>
                      {[video.event || 'No event', video.location].filter(Boolean).join(' / ')}
                    </Typography>

                    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
                      <Chip label={video.status || 'N/A'} size="small" />
                      {showContentTypeFilter && (
                        <Chip label={getContentTypeName(video)} size="small" color="secondary" variant="outlined" />
                      )}
                      {video.correctionStatus === 'needs_correction' && (
                        <Chip label="Potrebna ispravka" size="small" color="error" />
                      )}
                      <Chip
                        label={video.processingStatus || 'N/A'}
                        size="small"
                        color={
                          video.processingStatus === 'completed'
                            ? 'success'
                            : video.processingStatus === 'failed'
                              ? 'error'
                              : 'default'
                        }
                      />
                      {video.previewPath && <Chip label="Preview ready" size="small" color="primary" />}
                    </Stack>

                    {shouldShowProcessingProgress(video) && (
                      <Box sx={{ mt: 1.5 }}>
                        <LinearProgress
                          variant="determinate"
                          value={Number(video.processingProgress) || 0}
                        />
                        <Typography variant="caption" color="text.secondary">
                          Processing: {Number(video.processingProgress) || 0}%
                        </Typography>
                      </Box>
                    )}

                    {video.processingStatus === 'failed' && video.processingError && (
                      <Typography variant="caption" color="error" sx={{ display: 'block', mt: 1 }}>
                        {video.processingError}
                      </Typography>
                    )}

                    <Divider sx={{ my: 2 }} />

                    <Grid container spacing={1}>
                      <Grid item xs={6}>
                        <Typography variant="caption" color="text.secondary">Date</Typography>
                        <Typography variant="body2">{formatDate(video.tagDate || video.uploadDate)}</Typography>
                      </Grid>
                      <Grid item xs={6}>
                        <Typography variant="caption" color="text.secondary">Uploader</Typography>
                        <Typography variant="body2" noWrap>{getUploaderName(video)}</Typography>
                      </Grid>
                      <Grid item xs={6}>
                        <Typography variant="caption" color="text.secondary">Master</Typography>
                        <Typography variant="body2">{formatBytes(video.sizeCompressed)}</Typography>
                      </Grid>
                      <Grid item xs={6}>
                        <Typography variant="caption" color="text.secondary">Preview</Typography>
                        <Typography variant="body2">{formatBytes(video.sizePreview)}</Typography>
                      </Grid>
                      <Grid item xs={6}>
                        <Typography variant="caption" color="text.secondary">Codec</Typography>
                        <Typography variant="body2" noWrap>{video.codec || 'N/A'}</Typography>
                      </Grid>
                      <Grid item xs={6}>
                        <Typography variant="caption" color="text.secondary">Resolution</Typography>
                        <Typography variant="body2">{video.resolution || 'N/A'}</Typography>
                      </Grid>
                    </Grid>
                  </CardContent>

                  <CardActions sx={{ px: 2, pb: 2 }}>
                    <Button
                      size="small"
                      variant="contained"
                      component={Link}
                      to={`/video-details/${video._id}`}
                    >
                      Preview
                    </Button>
                    {!readOnly && (
                      <Button size="small" variant="outlined" onClick={() => handleDownloadSingle(video)}>
                        Download
                      </Button>
                    )}
                    {!readOnly && video.processingStatus === 'failed' && (
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={<ReplayIcon />}
                        onClick={() => handleRetryProcessing(video)}
                      >
                        Retry
                      </Button>
                    )}
                    {!readOnly && (
                      <Button size="small" color="error" onClick={() => handleDeleteSingle(video._id)}>
                        Delete
                      </Button>
                    )}
                  </CardActions>
                </Card>
              </Grid>
            );
          })}
        </Grid>
      )}

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)}>
        <DialogTitle>Confirm Deletion</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to delete {selectedVideos.length} selected video(s)?
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => {
              handleBulkDelete(selectedVideos);
              setConfirmOpen(false);
            }}
          >
            Confirm Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default VideoList;
