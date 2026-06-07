import React, { useEffect, useMemo, useState } from 'react';
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
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import axiosInstance from '../../axiosConfig';

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

const formatDateTime = (value) => {
  if (!value) return 'N/A';
  return new Date(value).toLocaleString();
};

const getUploaderName = (video) => video.uploader?.username || 'Unknown uploader';

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
          height: 160,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: 'grey.100',
          color: 'text.secondary',
        }}
      >
        <Typography variant="body2">No thumbnail</Typography>
      </Box>
    );
  }

  return (
    <CardMedia
      component="img"
      height="160"
      image={src}
      alt={title}
      sx={{ objectFit: 'cover' }}
    />
  );
};

const VideoManagement = () => {
  const [videos, setVideos] = useState([]);
  const [selectedVideos, setSelectedVideos] = useState([]);
  const [message, setMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [uploaderFilter, setUploaderFilter] = useState('all');
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    fetchVideos();
  }, []);

  const fetchVideos = () => {
    setMessage('');
    setErrorMessage('');

    axiosInstance
      .get('/videos', { headers: { Accept: 'application/json' } })
      .then((response) => {
        setVideos(Array.isArray(response.data) ? response.data : []);
      })
      .catch((err) => {
        console.error('Error fetching videos:', err);
        setErrorMessage('Greška pri učitavanju videa.');
      });
  };

  const uploaderOptions = useMemo(() => {
    const uploaders = videos.map(getUploaderName);
    return Array.from(new Set(uploaders)).sort();
  }, [videos]);

  const filteredVideos = useMemo(() => {
    const search = searchTerm.toLowerCase().trim();

    return videos.filter((video) => {
      const matchesSearch =
        !search ||
        [
          video.originalFilename,
          video.filename,
          video.event,
          video.location,
          video.status,
          video.processingStatus,
          getUploaderName(video),
        ]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(search));

      const matchesStatus =
        statusFilter === 'all' ||
        video.processingStatus === statusFilter ||
        video.status === statusFilter;

      const matchesUploader =
        uploaderFilter === 'all' || getUploaderName(video) === uploaderFilter;

      return matchesSearch && matchesStatus && matchesUploader;
    });
  }, [videos, searchTerm, statusFilter, uploaderFilter]);

  const stats = useMemo(() => {
    const total = videos.length;
    const completed = videos.filter((video) => video.processingStatus === 'completed').length;
    const failed = videos.filter((video) => video.processingStatus === 'failed').length;
    const previewReady = videos.filter((video) => Boolean(video.previewPath)).length;
    const thumbnails = videos.filter((video) => Boolean(video.thumbnailPath)).length;

    return {
      total,
      completed,
      failed,
      previewReady,
      thumbnails,
    };
  }, [videos]);

  const handleSelectVideo = (videoId) => {
    setSelectedVideos((prev) =>
      prev.includes(videoId)
        ? prev.filter((id) => id !== videoId)
        : [...prev, videoId]
    );
  };

  const handleSelectAllFiltered = () => {
    const filteredIds = filteredVideos.map((video) => video._id);
    const allSelected = filteredIds.every((id) => selectedVideos.includes(id));

    if (allSelected) {
      setSelectedVideos((prev) => prev.filter((id) => !filteredIds.includes(id)));
    } else {
      setSelectedVideos((prev) => Array.from(new Set([...prev, ...filteredIds])));
    }
  };

  const handleDelete = (videoId) => {
    axiosInstance
      .delete(`/admin/videos/${videoId}`)
      .then(() => {
        setVideos((prev) => prev.filter((video) => video._id !== videoId));
        setSelectedVideos((prev) => prev.filter((id) => id !== videoId));
        setMessage('Video je uspješno obrisan.');
        setErrorMessage('');
      })
      .catch((err) => {
        console.error('Error deleting video:', err);
        setErrorMessage('Greška pri brisanju videa.');
      });
  };

  const handleBulkDelete = () => {
    Promise.all(selectedVideos.map((id) => axiosInstance.delete(`/admin/videos/${id}`)))
      .then(() => {
        setVideos((prev) => prev.filter((video) => !selectedVideos.includes(video._id)));
        setSelectedVideos([]);
        setMessage('Odabrani video materijali su obrisani.');
        setErrorMessage('');
        setConfirmOpen(false);
      })
      .catch((err) => {
        console.error('Error deleting videos:', err);
        setErrorMessage('Greška pri brisanju odabranih videa.');
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
        console.error('Error downloading selected videos:', error);
        setErrorMessage('Greška pri skidanju odabranih videa.');
      });
  };

  return (
    <Box>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        justifyContent="space-between"
        alignItems={{ xs: 'flex-start', md: 'center' }}
        spacing={2}
        sx={{ mb: 3 }}
      >
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 800 }}>
            Video Management
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Pregled, filtriranje, skidanje i brisanje video materijala.
          </Typography>
        </Box>

        <Button variant="outlined" onClick={fetchVideos}>
          Refresh
        </Button>
      </Stack>

      {message && <Alert severity="success" sx={{ mb: 2 }}>{message}</Alert>}
      {errorMessage && <Alert severity="error" sx={{ mb: 2 }}>{errorMessage}</Alert>}

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={6} md={2.4}>
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 3 }}>
            <Typography variant="overline" color="text.secondary">Total</Typography>
            <Typography variant="h5" sx={{ fontWeight: 800 }}>{stats.total}</Typography>
          </Paper>
        </Grid>
        <Grid item xs={6} md={2.4}>
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 3 }}>
            <Typography variant="overline" color="text.secondary">Completed</Typography>
            <Typography variant="h5" sx={{ fontWeight: 800 }}>{stats.completed}</Typography>
          </Paper>
        </Grid>
        <Grid item xs={6} md={2.4}>
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 3 }}>
            <Typography variant="overline" color="text.secondary">Failed</Typography>
            <Typography variant="h5" sx={{ fontWeight: 800 }}>{stats.failed}</Typography>
          </Paper>
        </Grid>
        <Grid item xs={6} md={2.4}>
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 3 }}>
            <Typography variant="overline" color="text.secondary">Preview</Typography>
            <Typography variant="h5" sx={{ fontWeight: 800 }}>{stats.previewReady}</Typography>
          </Paper>
        </Grid>
        <Grid item xs={6} md={2.4}>
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 3 }}>
            <Typography variant="overline" color="text.secondary">Thumbnails</Typography>
            <Typography variant="h5" sx={{ fontWeight: 800 }}>{stats.thumbnails}</Typography>
          </Paper>
        </Grid>
      </Grid>

      <Paper variant="outlined" sx={{ p: 2, mb: 3, borderRadius: 3 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} md={5}>
            <TextField
              label="Search videos"
              fullWidth
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Filename, event, location, uploader..."
            />
          </Grid>

          <Grid item xs={12} md={3}>
            <FormControl fullWidth>
              <InputLabel>Status</InputLabel>
              <Select
                value={statusFilter}
                label="Status"
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <MenuItem value="all">All statuses</MenuItem>
                <MenuItem value="completed">Completed</MenuItem>
                <MenuItem value="processing">Processing</MenuItem>
                <MenuItem value="failed">Failed</MenuItem>
                <MenuItem value="raw">Raw</MenuItem>
                <MenuItem value="edited">Edited</MenuItem>
              </Select>
            </FormControl>
          </Grid>

          <Grid item xs={12} md={3}>
            <FormControl fullWidth>
              <InputLabel>Uploader</InputLabel>
              <Select
                value={uploaderFilter}
                label="Uploader"
                onChange={(e) => setUploaderFilter(e.target.value)}
              >
                <MenuItem value="all">All uploaders</MenuItem>
                {uploaderOptions.map((uploader) => (
                  <MenuItem key={uploader} value={uploader}>{uploader}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>

          <Grid item xs={12} md={1}>
            <Button fullWidth variant="outlined" onClick={handleSelectAllFiltered}>
              Select
            </Button>
          </Grid>
        </Grid>
      </Paper>

      {selectedVideos.length > 0 && (
        <Paper variant="outlined" sx={{ p: 2, mb: 3, borderRadius: 3 }}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems="center">
            <Typography sx={{ fontWeight: 700 }}>
              Selected: {selectedVideos.length}
            </Typography>
            <Button variant="contained" onClick={handleDownloadSelected}>
              Download Selected
            </Button>
            <Button variant="outlined" color="error" onClick={() => setConfirmOpen(true)}>
              Delete Selected
            </Button>
          </Stack>
        </Paper>
      )}

      {filteredVideos.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 4, borderRadius: 3, textAlign: 'center' }}>
          <Typography variant="h6">No videos found</Typography>
          <Typography variant="body2" color="text.secondary">
            Nema video materijala koji odgovaraju trenutnom filteru.
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
                  </Box>

                  <CardContent>
                    <Typography variant="h6" sx={{ fontWeight: 800 }} noWrap>
                      {video.originalFilename || video.filename}
                    </Typography>

                    <Typography variant="body2" color="text.secondary" noWrap>
                      {video.event || 'No event'} • {video.location || 'No location'}
                    </Typography>

                    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
                      <Chip label={video.status || 'N/A'} size="small" />
                      <Chip
                        label={video.processingStatus || 'N/A'}
                        size="small"
                        color={video.processingStatus === 'completed' ? 'success' : 'default'}
                      />
                      {video.previewPath && <Chip label="Preview" size="small" color="primary" />}
                      {video.thumbnailPath && <Chip label="Thumb" size="small" />}
                    </Stack>

                    <Divider sx={{ my: 2 }} />

                    <Grid container spacing={1}>
                      <Grid item xs={6}>
                        <Typography variant="caption" color="text.secondary">Uploader</Typography>
                        <Typography variant="body2" noWrap>{getUploaderName(video)}</Typography>
                      </Grid>
                      <Grid item xs={6}>
                        <Typography variant="caption" color="text.secondary">Date</Typography>
                        <Typography variant="body2">{formatDate(video.tagDate || video.uploadDate)}</Typography>
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
                      <Grid item xs={12}>
                        <Typography variant="caption" color="text.secondary">Raw retention</Typography>
                        <Typography variant="body2">
                          {video.rawRetentionDays || 0} days • Raw deleted: {video.rawDeleted ? 'Yes' : 'No'}
                        </Typography>
                        {video.rawExpiresAt && (
                          <Typography variant="caption" color="text.secondary">
                            Expires: {formatDateTime(video.rawExpiresAt)}
                          </Typography>
                        )}
                      </Grid>
                    </Grid>
                  </CardContent>

                  <CardActions sx={{ px: 2, pb: 2 }}>
                    <Button
                      size="small"
                      variant="contained"
                      href={`/video-details/${video._id}`}
                    >
                      Preview
                    </Button>
                    <Button size="small" variant="outlined" onClick={() => handleDownloadSingle(video)}>
                      Download
                    </Button>
                    <Button size="small" color="error" onClick={() => handleDelete(video._id)}>
                      Delete
                    </Button>
                  </CardActions>
                </Card>
              </Grid>
            );
          })}
        </Grid>
      )}

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)}>
        <DialogTitle>Confirm bulk delete</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to delete {selectedVideos.length} selected video(s)?
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={handleBulkDelete}>
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default VideoManagement;