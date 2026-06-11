import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  FormControl,
  Grid,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EventAvailableIcon from '@mui/icons-material/EventAvailable';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import RefreshIcon from '@mui/icons-material/Refresh';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import { Link } from 'react-router-dom';
import axiosInstance from '../axiosConfig';
import { UserContext } from '../contexts/UserContext';

const getTodayInputValue = () => {
  const today = new Date();
  today.setMinutes(today.getMinutes() - today.getTimezoneOffset());
  return today.toISOString().slice(0, 10);
};

const formatDate = (value) => {
  if (!value) return 'N/A';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'N/A';
  return date.toLocaleDateString();
};

const formatLabel = (value) => String(value || 'N/A').replace(/_/g, ' ');
const getPersonName = (person) => person?.username || 'N/A';

const ProducerDashboard = () => {
  const { user } = useContext(UserContext);
  const [programs, setPrograms] = useState([]);
  const [contentTypes, setContentTypes] = useState([]);
  const [selectedProgramId, setSelectedProgramId] = useState('');
  const [selectedDate, setSelectedDate] = useState(getTodayInputValue);
  const [showDay, setShowDay] = useState(null);
  const [libraryVideos, setLibraryVideos] = useState([]);
  const [selectedContentTypeId, setSelectedContentTypeId] = useState('all');
  const [librarySearch, setLibrarySearch] = useState('');
  const [replaceTargetItem, setReplaceTargetItem] = useState(null);
  const [message, setMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const isJoined = useMemo(() => {
    if (user?.role === 'Admin') return true;
    return (showDay?.producers || []).some((producer) => String(producer._id || producer.id) === String(user?.id));
  }, [showDay, user]);

  const activeItems = useMemo(
    () => (showDay?.items || []).filter((item) => item.status !== 'removed').sort((a, b) => Number(a.order || 0) - Number(b.order || 0)),
    [showDay]
  );

  const activeVideoIds = useMemo(
    () => new Set(activeItems.map((item) => item.video?._id).filter(Boolean)),
    [activeItems]
  );

  const loadSettings = useCallback(() => {
    Promise.all([
      axiosInstance.get('/broadcast/programs'),
      axiosInstance.get('/broadcast/content-types'),
    ])
      .then(([programResponse, typeResponse]) => {
        const nextPrograms = Array.isArray(programResponse.data) ? programResponse.data : [];
        const nextTypes = Array.isArray(typeResponse.data) ? typeResponse.data : [];
        setPrograms(nextPrograms);
        setContentTypes(nextTypes);
        setSelectedProgramId((current) => current || nextPrograms[0]?._id || '');
      })
      .catch((error) => {
        console.error('Error loading producer settings:', error);
        setErrorMessage('Producer settings could not be loaded.');
      });
  }, []);

  const loadShowDay = useCallback(() => {
    if (!selectedProgramId || !selectedDate) return;

    setLoading(true);
    axiosInstance
      .get('/broadcast/show-day', {
        params: {
          programId: selectedProgramId,
          airDate: selectedDate,
        },
      })
      .then((response) => {
        setShowDay(response.data);
      })
      .catch((error) => {
        console.error('Error loading show day:', error);
        setErrorMessage(error.response?.data?.message || 'Show day could not be loaded.');
      })
      .finally(() => setLoading(false));
  }, [selectedProgramId, selectedDate]);

  const loadLibraryVideos = useCallback(() => {
    axiosInstance
      .get('/broadcast/library-videos', {
        params: {
          contentTypeId: selectedContentTypeId,
          search: librarySearch,
        },
      })
      .then((response) => {
        setLibraryVideos(Array.isArray(response.data) ? response.data : []);
      })
      .catch((error) => {
        console.error('Error loading producer library:', error);
        setErrorMessage(error.response?.data?.message || 'TV archive material could not be loaded.');
      });
  }, [selectedContentTypeId, librarySearch]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    loadShowDay();
    loadLibraryVideos();
  }, [loadShowDay, loadLibraryVideos]);

  const refresh = () => {
    setMessage('');
    setErrorMessage('');
    setReplaceTargetItem(null);
    loadShowDay();
    loadLibraryVideos();
  };

  const joinShow = () => {
    axiosInstance
      .post('/broadcast/show-day/join', {
        programId: selectedProgramId,
        airDate: selectedDate,
      })
      .then((response) => {
        setShowDay(response.data.showDay);
        setMessage(response.data?.message || 'Joined show day.');
        setErrorMessage('');
      })
      .catch((error) => {
        console.error('Error joining show:', error);
        setErrorMessage(error.response?.data?.message || 'Could not join show day.');
      });
  };

  const addMaterial = (video) => {
    const contentTypeId = video.contentType?._id || (selectedContentTypeId !== 'all' ? selectedContentTypeId : '');

    if (!contentTypeId) {
      setErrorMessage('Select a content type before adding this older archive material.');
      return;
    }

    const payload = {
      videoId: video._id,
      contentTypeId,
      title: video.finalTitle || video.originalFilename || video.filename,
    };
    const request = replaceTargetItem
      ? axiosInstance.patch(`/broadcast/show-day/${showDay._id}/items/${replaceTargetItem._id}/replace`, payload)
      : axiosInstance.post(`/broadcast/show-day/${showDay._id}/items`, payload);

    request
      .then((response) => {
        setShowDay(response.data.showDay);
        setMessage(replaceTargetItem ? 'Material replaced in show.' : 'Material added to show.');
        setReplaceTargetItem(null);
        setErrorMessage('');
      })
      .catch((error) => {
        console.error('Error adding material:', error);
        setErrorMessage(error.response?.data?.message || 'Material could not be added.');
      });
  };

  const updateItemStatus = (item, status) => {
    axiosInstance
      .patch(`/broadcast/show-day/${showDay._id}/items/${item._id}`, { status })
      .then((response) => {
        setShowDay(response.data.showDay);
        setMessage('Material status updated.');
        setErrorMessage('');
        loadLibraryVideos();
      })
      .catch((error) => {
        console.error('Error updating item:', error);
        setErrorMessage(error.response?.data?.message || 'Material status could not be updated.');
      });
  };

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, bgcolor: 'background.default', minHeight: '100vh' }}>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={2}
        justifyContent="space-between"
        alignItems={{ xs: 'flex-start', md: 'center' }}
        sx={{ mb: 3 }}
      >
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 800 }}>
            Producer Desk
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Prepare daily shows, attach approved material, and track who changed what.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" startIcon={<RefreshIcon />} onClick={refresh} disabled={loading}>
            Refresh
          </Button>
          <Button variant="contained" startIcon={<EventAvailableIcon />} onClick={joinShow} disabled={!selectedProgramId || isJoined}>
            {isJoined ? 'Joined' : 'Join show'}
          </Button>
        </Stack>
      </Stack>

      {message && <Alert severity="success" sx={{ mb: 2 }}>{message}</Alert>}
      {errorMessage && <Alert severity="error" sx={{ mb: 2 }}>{errorMessage}</Alert>}

      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, mb: 3 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} md={4}>
            <FormControl fullWidth>
              <InputLabel>Program</InputLabel>
              <Select
                value={selectedProgramId}
                label="Program"
                onChange={(event) => setSelectedProgramId(event.target.value)}
              >
                {programs.map((program) => (
                  <MenuItem key={program._id} value={program._id}>
                    {program.name}{program.defaultTime ? ` / ${program.defaultTime}` : ''}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={3}>
            <TextField
              label="Air date"
              type="date"
              value={selectedDate}
              onChange={(event) => setSelectedDate(event.target.value)}
              InputLabelProps={{ shrink: true }}
              fullWidth
            />
          </Grid>
          <Grid item xs={12} md={3}>
            <FormControl fullWidth>
              <InputLabel>Content type</InputLabel>
              <Select
                value={selectedContentTypeId}
                label="Content type"
                onChange={(event) => setSelectedContentTypeId(event.target.value)}
              >
                <MenuItem value="all">All approved material</MenuItem>
                {contentTypes.map((type) => (
                  <MenuItem key={type._id} value={type._id}>
                    {type.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={2}>
            <Stack spacing={0.5}>
              <Chip label={`${activeItems.length} in show`} color="primary" />
              <Chip label={`${showDay?.producers?.length || 0} producer(s)`} variant="outlined" />
            </Stack>
          </Grid>
          <Grid item xs={12}>
            <TextField
              label="Search TV archive"
              value={librarySearch}
              onChange={(event) => setLibrarySearch(event.target.value)}
              fullWidth
            />
          </Grid>
        </Grid>
      </Paper>

      <Grid container spacing={2}>
        <Grid item xs={12} lg={7}>
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
            <Typography variant="h6" sx={{ fontWeight: 800, mb: 2 }}>
              Show rundown
            </Typography>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>#</TableCell>
                    <TableCell>Material</TableCell>
                    <TableCell>Type</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Added by</TableCell>
                    <TableCell align="right">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {activeItems.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6}>
                        <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 3 }}>
                          No material in this show yet.
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ) : (
                    activeItems.map((item, index) => (
                      <TableRow key={item._id} hover>
                        <TableCell>{index + 1}</TableCell>
                        <TableCell>
                          <Typography variant="body2" sx={{ fontWeight: 800 }}>
                            {item.title || item.video?.finalTitle || item.video?.originalFilename || 'Untitled'}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {formatDate(item.video?.airDate || showDay?.airDate)}
                          </Typography>
                          <Typography variant="caption" color="text.secondary" display="block">
                            Reporter: {getPersonName(item.video?.reporter)} / Editor: {getPersonName(item.video?.editor)}
                          </Typography>
                        </TableCell>
                        <TableCell>{item.contentType?.name || 'N/A'}</TableCell>
                        <TableCell>
                          <Chip label={formatLabel(item.status)} size="small" />
                        </TableCell>
                        <TableCell>{item.addedBy?.username || 'Unknown'}</TableCell>
                        <TableCell align="right">
                          <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                            <Tooltip title="Mark ready">
                              <IconButton size="small" color="success" onClick={() => updateItemStatus(item, 'ready')} disabled={!isJoined}>
                                <CheckCircleIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                            <Tooltip title="Mark aired">
                              <IconButton size="small" color="primary" onClick={() => updateItemStatus(item, 'aired')} disabled={!isJoined}>
                                <EventAvailableIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                            <Tooltip title="Remove from show">
                              <IconButton size="small" color="error" onClick={() => updateItemStatus(item, 'removed')} disabled={!isJoined}>
                                <DeleteOutlineIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                            <Tooltip title="Replace material">
                              <IconButton size="small" color="warning" onClick={() => setReplaceTargetItem(item)} disabled={!isJoined}>
                                <SwapHorizIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                            <Tooltip title="Open video">
                              <IconButton component={Link} to={`/video-details/${item.video?._id}`} size="small">
                                <OpenInNewIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          </Stack>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        </Grid>

        <Grid item xs={12} lg={5}>
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, mb: 2 }}>
            <Typography variant="h6" sx={{ fontWeight: 800, mb: 2 }}>
              TV archive / ready material
            </Typography>
            {replaceTargetItem && (
              <Alert
                severity="warning"
                action={<Button color="inherit" size="small" onClick={() => setReplaceTargetItem(null)}>Cancel</Button>}
                sx={{ mb: 2 }}
              >
                Replace mode: choose new material for {replaceTargetItem.title || 'selected item'}.
              </Alert>
            )}
            <Stack spacing={1}>
              {libraryVideos.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  No edited archive material found for selected filters.
                </Typography>
              ) : (
                libraryVideos.map((video) => {
                  const alreadyAdded = activeVideoIds.has(video._id);

                  return (
                    <Paper key={video._id} variant="outlined" sx={{ p: 1.25, borderRadius: 1 }}>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Box sx={{ minWidth: 0, flex: 1 }}>
                          <Typography variant="body2" sx={{ fontWeight: 800 }} noWrap>
                            {video.finalTitle || video.originalFilename || video.filename}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {video.contentType?.name || 'N/A'} / Approved by {video.finalApprovedBy?.username || 'N/A'}
                          </Typography>
                          <Typography variant="caption" color="text.secondary" display="block">
                            Reporter: {getPersonName(video.reporter)} / Editor: {getPersonName(video.editor)} / QA: {getPersonName(video.qaResponsible)}
                          </Typography>
                        </Box>
                        <Tooltip title={replaceTargetItem ? 'Use as replacement' : alreadyAdded ? 'Already in show' : 'Add to show'}>
                          <span>
                            <IconButton
                              size="small"
                              color={replaceTargetItem ? 'warning' : 'primary'}
                              disabled={!isJoined || (!replaceTargetItem && alreadyAdded) || !showDay}
                              onClick={() => addMaterial(video)}
                            >
                              {replaceTargetItem ? <SwapHorizIcon fontSize="small" /> : <AddCircleOutlineIcon fontSize="small" />}
                            </IconButton>
                          </span>
                        </Tooltip>
                      </Stack>
                    </Paper>
                  );
                })
              )}
            </Stack>
          </Paper>

          <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
            <Typography variant="h6" sx={{ fontWeight: 800, mb: 2 }}>
              Activity log
            </Typography>
            <Stack spacing={1}>
              {(showDay?.activityLog || []).slice().reverse().map((activity) => (
                <Box key={activity._id}>
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>
                    {activity.summary}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {activity.performedBy?.username || 'Unknown'} / {formatDate(activity.createdAt)}
                  </Typography>
                </Box>
              ))}
              {(showDay?.activityLog || []).length === 0 && (
                <Typography variant="body2" color="text.secondary">
                  No activity yet.
                </Typography>
              )}
            </Stack>
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
};

export default ProducerDashboard;
