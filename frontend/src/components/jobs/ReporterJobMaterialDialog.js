import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  IconButton,
  InputLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import axiosInstance from '../../axiosConfig';
import { ACCEPTED_VIDEO_FILE_TYPES } from '../../constants/videoFormats';
import { getSearchParam } from '../../utils/searchParams';
import VideoThumbnailPreview from '../common/VideoThumbnailPreview';

const getClipName = (video) => (
  video?.originalFilename || video?.filename || `Video ${video?._id || ''}`
);

const formatDuration = (seconds) => {
  const value = Number(seconds);
  if (!Number.isFinite(value)) return 'N/A';
  const minutes = Math.floor(Math.max(value, 0) / 60);
  const remaining = Math.floor(Math.max(value, 0) % 60);
  return `${minutes}:${String(remaining).padStart(2, '0')}`;
};

const formatBytes = (bytes) => {
  const value = Number(bytes);
  if (!Number.isFinite(value)) return 'N/A';
  if (value >= 1024 ** 3) return `${(value / (1024 ** 3)).toFixed(1)} GB`;
  if (value >= 1024 ** 2) return `${(value / (1024 ** 2)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(value / 1024))} KB`;
};

const toDateInput = (value) => {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return '';
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
};

const ReporterJobMaterialDialog = ({ open, job, onClose, onUpdated }) => {
  const [sourceTab, setSourceTab] = useState('server');
  const [videos, setVideos] = useState([]);
  const [contentTypes, setContentTypes] = useState([]);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [contentTypeId, setContentTypeId] = useState('all');
  const [selectedIds, setSelectedIds] = useState([]);
  const [notes, setNotes] = useState({});
  const [files, setFiles] = useState([]);
  const [fileNotes, setFileNotes] = useState({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const existingVideoIds = useMemo(
    () => new Set((job?.segments || []).map((segment) => segment.video?._id || segment.video).filter(Boolean)),
    [job]
  );

  const fetchVideos = useCallback(() => {
    if (!open || !job?._id) return;

    setLoading(true);
    setErrorMessage('');
    const params = {
      q: getSearchParam(debouncedSearch),
      contentTypeId: contentTypeId !== 'all' ? contentTypeId : undefined,
      limit: 100,
      sortBy: 'uploadDate',
      sortOrder: 'desc',
    };

    Promise.all([
      axiosInstance.get('/videos/workspace', { params }),
      axiosInstance.get('/videos/workspace', {
        params: { ...params, scope: 'station', library: 'archive' },
      }),
    ])
      .then(([ownResponse, archiveResponse]) => {
        const merged = new Map();
        const ownItems = Array.isArray(ownResponse.data?.items) ? ownResponse.data.items : [];
        const archiveItems = Array.isArray(archiveResponse.data?.items) ? archiveResponse.data.items : [];

        ownItems.forEach((video) => {
          if (video?._id) merged.set(video._id, { ...video, materialSource: 'Moji materijali' });
        });
        archiveItems.forEach((video) => {
          if (video?._id && !merged.has(video._id)) {
            merged.set(video._id, { ...video, materialSource: 'TV arhiva' });
          }
        });

        setVideos(Array.from(merged.values()).filter((video) => !existingVideoIds.has(video._id)));
      })
      .catch((error) => {
        console.error('Error loading job material:', error);
        setErrorMessage(error.response?.data?.message || 'Materijal se ne može učitati.');
      })
      .finally(() => setLoading(false));
  }, [contentTypeId, debouncedSearch, existingVideoIds, job?._id, open]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (!open) return;
    axiosInstance
      .get('/broadcast/content-types')
      .then((response) => setContentTypes(Array.isArray(response.data) ? response.data : []))
      .catch((error) => console.error('Error loading content types:', error));
  }, [open]);

  useEffect(() => {
    fetchVideos();
  }, [fetchVideos]);

  useEffect(() => {
    if (!open) {
      setSourceTab('server');
      setSearch('');
      setDebouncedSearch('');
      setContentTypeId('all');
      setSelectedIds([]);
      setNotes({});
      setFiles([]);
      setFileNotes({});
      setMessage('');
      setErrorMessage('');
      setProgress(0);
    }
  }, [open]);

  const selectedVideos = useMemo(
    () => videos.filter((video) => selectedIds.includes(video._id)),
    [selectedIds, videos]
  );

  const toggleVideo = (videoId) => {
    setSelectedIds((current) => (
      current.includes(videoId)
        ? current.filter((id) => id !== videoId)
        : [...current, videoId]
    ));
  };

  const handleAddServerMaterial = () => {
    if (selectedVideos.length === 0) {
      setErrorMessage('Odaberi barem jedan klip.');
      return;
    }

    const baseOrder = (job?.segments || []).length;
    const segments = selectedVideos.map((video, index) => ({
      video: video._id,
      order: baseOrder + index,
      title: getClipName(video),
      notes: notes[video._id] || '',
      type: video.isBroll ? 'broll' : 'other',
      startTime: 0,
      endTime: Number(video.duration) || null,
      required: true,
    }));
    const formData = new FormData();
    formData.append('segments', JSON.stringify(segments));

    setSaving(true);
    setMessage('');
    setErrorMessage('');
    axiosInstance
      .patch(`/edit-jobs/${job._id}/reporter-update`, formData)
      .then((response) => {
        setMessage(`${segments.length} klip(ova) je dodano u job.`);
        setSelectedIds([]);
        setNotes({});
        if (onUpdated) onUpdated(response.data?.job);
        fetchVideos();
      })
      .catch((error) => {
        console.error('Error adding server material:', error);
        setErrorMessage(error.response?.data?.message || 'Klipovi se ne mogu dodati u job.');
      })
      .finally(() => setSaving(false));
  };

  const handleFileSelection = (event) => {
    const nextFiles = Array.from(event.target.files || []);
    if (nextFiles.length > 0) setFiles((current) => [...current, ...nextFiles]);
    event.target.value = '';
  };

  const removeFile = (indexToRemove) => {
    setFiles((current) => current.filter((file, index) => index !== indexToRemove));
    setFileNotes((current) => {
      const next = {};
      Object.entries(current).forEach(([key, value]) => {
        const index = Number(key);
        if (index < indexToRemove) next[index] = value;
        if (index > indexToRemove) next[index - 1] = value;
      });
      return next;
    });
  };

  const handleUpload = () => {
    if (files.length === 0) {
      setErrorMessage('Odaberi barem jedan video fajl.');
      return;
    }

    const firstVideo = (job?.segments || []).find((segment) => segment.video)?.video || {};
    const formData = new FormData();
    files.forEach((file) => formData.append('videos', file, file.name));
    formData.append('event', firstVideo.event || job.title || '');
    formData.append('location', firstVideo.location || '');
    formData.append('date', toDateInput(firstVideo.tagDate));
    formData.append('notes', JSON.stringify(files.map((file, index) => fileNotes[index] || '')));

    setSaving(true);
    setProgress(0);
    setMessage('');
    setErrorMessage('');
    axiosInstance
      .post(`/edit-jobs/${job._id}/material-upload`, formData, {
        onUploadProgress: (progressEvent) => {
          const total = progressEvent.total || files.reduce((sum, file) => sum + file.size, 0) || 1;
          setProgress(Math.round((progressEvent.loaded * 100) / total));
        },
      })
      .then((response) => {
        setMessage(response.data?.message || 'Materijal je dodan u job.');
        setFiles([]);
        setFileNotes({});
        setProgress(0);
        if (onUpdated) onUpdated(response.data?.job);
        fetchVideos();
      })
      .catch((error) => {
        console.error('Error uploading job material:', error);
        setErrorMessage(error.response?.data?.message || 'Upload materijala nije uspio.');
      })
      .finally(() => setSaving(false));
  };

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} fullWidth maxWidth="lg">
      <DialogTitle>
        <Typography variant="h6" sx={{ fontWeight: 900 }}>
          Dodaj klipove u job
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {job?.title || ''}
        </Typography>
      </DialogTitle>
      <DialogContent dividers sx={{ p: 0 }}>
        <Tabs
          value={sourceTab}
          onChange={(event, value) => setSourceTab(value)}
          sx={{ px: 2, borderBottom: 1, borderColor: 'divider' }}
        >
          <Tab value="server" label="Sa servera" />
          <Tab value="computer" label="Sa kompjutera" />
        </Tabs>

        <Stack spacing={2} sx={{ p: 2 }}>
          {message && <Alert severity="success">{message}</Alert>}
          {errorMessage && <Alert severity="error">{errorMessage}</Alert>}

          {sourceTab === 'server' && (
            <>
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
                <TextField
                  label="Pretraži materijal"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  fullWidth
                />
                <FormControl sx={{ minWidth: { xs: '100%', md: 240 } }}>
                  <InputLabel>Kategorija</InputLabel>
                  <Select
                    value={contentTypeId}
                    label="Kategorija"
                    onChange={(event) => setContentTypeId(event.target.value)}
                  >
                    <MenuItem value="all">Sve kategorije</MenuItem>
                    {contentTypes.map((type) => (
                      <MenuItem key={type._id} value={type._id}>{type.name}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Stack>

              <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 440, borderRadius: 1 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell padding="checkbox">Izbor</TableCell>
                      <TableCell>Materijal</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell>Trajanje</TableCell>
                      <TableCell>Napomena</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {loading && (
                      <TableRow>
                        <TableCell colSpan={5} align="center" sx={{ py: 4 }}>
                          <CircularProgress size={28} />
                        </TableCell>
                      </TableRow>
                    )}
                    {!loading && videos.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} align="center" sx={{ py: 4 }}>
                          Nema dostupnog materijala za ovu pretragu.
                        </TableCell>
                      </TableRow>
                    )}
                    {!loading && videos.map((video) => {
                      const selected = selectedIds.includes(video._id);
                      return (
                        <TableRow key={video._id} hover selected={selected}>
                          <TableCell padding="checkbox">
                            <Checkbox checked={selected} onChange={() => toggleVideo(video._id)} />
                          </TableCell>
                          <TableCell sx={{ minWidth: 310 }}>
                            <Stack direction="row" spacing={1.25} alignItems="center">
                              <VideoThumbnailPreview
                                videoId={video._id}
                                title={getClipName(video)}
                                width={112}
                                height={63}
                                enableScrubPreview
                              />
                              <Box sx={{ flex: 1, minWidth: 0 }}>
                                <Typography variant="body2" sx={{ fontWeight: 850 }} noWrap>
                                  {getClipName(video)}
                                </Typography>
                                <Typography variant="caption" color="text.secondary" component="div" noWrap>
                                  {video.event || 'Bez eventa'} / {video.materialSource}
                                </Typography>
                              </Box>
                              <Tooltip title="Otvori Video Details">
                                <IconButton component={Link} to={`/video-details/${video._id}`} size="small">
                                  <OpenInNewIcon fontSize="small" />
                                </IconButton>
                              </Tooltip>
                            </Stack>
                          </TableCell>
                          <TableCell>
                            <Chip size="small" label={video.processingStatus || 'N/A'} />
                          </TableCell>
                          <TableCell>{formatDuration(video.duration)}</TableCell>
                          <TableCell sx={{ minWidth: 210 }}>
                            <TextField
                              size="small"
                              label="Napomena"
                              value={notes[video._id] || ''}
                              onChange={(event) => setNotes((current) => ({
                                ...current,
                                [video._id]: event.target.value,
                              }))}
                              disabled={!selected}
                              fullWidth
                            />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>

              <Button
                variant="contained"
                onClick={handleAddServerMaterial}
                disabled={saving || selectedVideos.length === 0}
                sx={{ alignSelf: 'flex-start' }}
              >
                {saving ? 'Dodajem...' : `Dodaj odabrano (${selectedVideos.length})`}
              </Button>
            </>
          )}

          {sourceTab === 'computer' && (
            <>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }}>
                <Box sx={{ flex: 1 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 850 }}>
                    Direktni upload u postojeći job
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Event, datum i lokacija preuzet će se iz joba.
                  </Typography>
                </Box>
                <Button component="label" variant="outlined" startIcon={<CloudUploadIcon />} disabled={saving}>
                  Odaberi video
                  <input
                    hidden
                    type="file"
                    multiple
                    accept={ACCEPTED_VIDEO_FILE_TYPES}
                    onChange={handleFileSelection}
                  />
                </Button>
              </Stack>

              {files.length === 0 ? (
                <Alert severity="info">Nema odabranih fajlova.</Alert>
              ) : (
                <Stack spacing={1}>
                  {files.map((file, index) => (
                    <Paper key={`${file.name}-${file.lastModified}-${index}`} variant="outlined" sx={{ p: 1.25, borderRadius: 1 }}>
                      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Typography variant="body2" sx={{ fontWeight: 800 }} noWrap>{file.name}</Typography>
                          <Typography variant="caption" color="text.secondary">{formatBytes(file.size)}</Typography>
                        </Box>
                        <TextField
                          size="small"
                          label="Napomena"
                          value={fileNotes[index] || ''}
                          onChange={(event) => setFileNotes((current) => ({
                            ...current,
                            [index]: event.target.value,
                          }))}
                          disabled={saving}
                          sx={{ minWidth: { sm: 260 } }}
                        />
                        <Tooltip title="Ukloni fajl">
                          <span>
                            <IconButton onClick={() => removeFile(index)} disabled={saving} size="small">
                              <DeleteOutlineIcon fontSize="small" />
                            </IconButton>
                          </span>
                        </Tooltip>
                      </Stack>
                    </Paper>
                  ))}
                </Stack>
              )}

              {saving && (
                <Box>
                  <LinearProgress variant="determinate" value={progress} />
                  <Typography variant="caption" color="text.secondary">Upload {progress}%</Typography>
                </Box>
              )}

              <Button
                variant="contained"
                startIcon={<CloudUploadIcon />}
                onClick={handleUpload}
                disabled={saving || files.length === 0}
                sx={{ alignSelf: 'flex-start' }}
              >
                {saving ? 'Upload u toku...' : `Uploaduj i dodaj (${files.length})`}
              </Button>
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>Zatvori</Button>
      </DialogActions>
    </Dialog>
  );
};

export default ReporterJobMaterialDialog;
