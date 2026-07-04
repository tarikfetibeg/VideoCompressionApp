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
  LinearProgress,
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
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import EventAvailableIcon from '@mui/icons-material/EventAvailable';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import RefreshIcon from '@mui/icons-material/Refresh';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import { Link } from 'react-router-dom';
import axiosInstance from '../axiosConfig';
import { UserContext } from '../contexts/UserContext';
import { WorkspaceHeader } from '../components/common/WorkspaceChrome';
import VideoThumbnailPreview from '../components/common/VideoThumbnailPreview';
import CorrectionQueue from '../components/jobs/CorrectionQueue';
import { getSearchParam } from '../utils/searchParams';

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

const getDateInputValue = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
};

const formatLabel = (value) => String(value || 'N/A').replace(/_/g, ' ');
const getPersonName = (person) => person?.username || 'N/A';
const normalizeTypeKey = (contentType) =>
  String(contentType?.slug || contentType?.name || 'ostalo')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'ostalo';

const contentTypeTone = {
  prilog: { bg: '#e8f2ff', color: '#174ea6', border: '#a8c7fa' },
  insert: { bg: '#eaf6ef', color: '#176b3a', border: '#a8d8ba' },
  marketing: { bg: '#fff5d6', color: '#835400', border: '#f6d77a' },
  promo: { bg: '#f4ecff', color: '#5e35b1', border: '#c9b6f2' },
  grafika: { bg: '#e7f6f4', color: '#00695c', border: '#9bd5ce' },
  spica: { bg: '#eef0f4', color: '#45505f', border: '#c4cbd5' },
  ostalo: { bg: '#f4f5f7', color: '#4b5563', border: '#d1d5db' },
};

const getContentTypeChipSx = (contentType) => {
  const tone = contentTypeTone[normalizeTypeKey(contentType)] || contentTypeTone.ostalo;
  return {
    bgcolor: tone.bg,
    color: tone.color,
    borderColor: tone.border,
    fontWeight: 800,
  };
};

const ProducerDashboard = () => {
  const { user } = useContext(UserContext);
  const [programs, setPrograms] = useState([]);
  const [contentTypes, setContentTypes] = useState([]);
  const [selectedProgramId, setSelectedProgramId] = useState('');
  const [selectedDate, setSelectedDate] = useState(getTodayInputValue);
  const [showDay, setShowDay] = useState(null);
  const [producerShortcuts, setProducerShortcuts] = useState([]);
  const [shortcutsLoading, setShortcutsLoading] = useState(false);
  const [shortcutAutoSelected, setShortcutAutoSelected] = useState(false);
  const [libraryVideos, setLibraryVideos] = useState([]);
  const [selectedContentTypeId, setSelectedContentTypeId] = useState('all');
  const [librarySearch, setLibrarySearch] = useState('');
  const [debouncedLibrarySearch, setDebouncedLibrarySearch] = useState('');
  const [replaceTargetItem, setReplaceTargetItem] = useState(null);
  const [message, setMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [reorderingItemId, setReorderingItemId] = useState('');
  const [draggingItemId, setDraggingItemId] = useState('');
  const [dragOverItemId, setDragOverItemId] = useState('');
  const [rundownPreviewItems, setRundownPreviewItems] = useState([]);

  const isJoined = useMemo(() => {
    if (user?.role === 'Admin') return true;
    return (showDay?.producers || []).some((producer) => String(producer._id || producer.id) === String(user?.id));
  }, [showDay, user]);

  const activeItems = useMemo(
    () => (showDay?.items || []).filter((item) => item.status !== 'removed').sort((a, b) => Number(a.order || 0) - Number(b.order || 0)),
    [showDay]
  );

  const displayedRundownItems = rundownPreviewItems.length > 0 ? rundownPreviewItems : activeItems;

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

  useEffect(() => {
    const timeoutId = window.setTimeout(() => setDebouncedLibrarySearch(librarySearch), 300);
    return () => window.clearTimeout(timeoutId);
  }, [librarySearch]);

  const loadLibraryVideos = useCallback(() => {
    axiosInstance
      .get('/broadcast/library-search', {
        params: {
          contentTypeId: selectedContentTypeId,
          search: getSearchParam(debouncedLibrarySearch),
          limit: 100,
        },
      })
      .then((response) => {
        setLibraryVideos(Array.isArray(response.data)
          ? response.data
          : Array.isArray(response.data?.items)
            ? response.data.items
            : []);
      })
      .catch((error) => {
        console.error('Error loading producer library:', error);
        setErrorMessage(error.response?.data?.message || 'TV archive material could not be loaded.');
      });
  }, [selectedContentTypeId, debouncedLibrarySearch]);

  const loadProducerShortcuts = useCallback(() => {
    setShortcutsLoading(true);
    axiosInstance
      .get('/broadcast/my-show-days', {
        params: {
          from: getTodayInputValue(),
          days: 14,
        },
      })
      .then((response) => {
        setProducerShortcuts(Array.isArray(response.data) ? response.data : []);
      })
      .catch((error) => {
        console.error('Error loading producer show shortcuts:', error);
      })
      .finally(() => setShortcutsLoading(false));
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    loadProducerShortcuts();
  }, [loadProducerShortcuts]);

  useEffect(() => {
    if (shortcutAutoSelected || producerShortcuts.length === 0) return;

    const today = getTodayInputValue();
    const shortcut = producerShortcuts.find((item) => getDateInputValue(item.airDate) === today) || producerShortcuts[0];
    const programId = shortcut.program?._id || shortcut.program;
    const airDate = getDateInputValue(shortcut.airDate);

    if (programId && airDate) {
      setSelectedProgramId(programId);
      setSelectedDate(airDate);
      setShortcutAutoSelected(true);
    }
  }, [producerShortcuts, shortcutAutoSelected]);

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
    loadProducerShortcuts();
  };

  const openShowShortcut = (shortcut) => {
    const programId = shortcut.program?._id || shortcut.program;
    const airDate = getDateInputValue(shortcut.airDate);
    if (!programId || !airDate) return;

    setSelectedProgramId(programId);
    setSelectedDate(airDate);
    setReplaceTargetItem(null);
    setMessage('');
    setErrorMessage('');
    setShortcutAutoSelected(true);
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
        loadProducerShortcuts();
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
        loadProducerShortcuts();
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
        loadProducerShortcuts();
      })
      .catch((error) => {
        console.error('Error updating item:', error);
        setErrorMessage(error.response?.data?.message || 'Material status could not be updated.');
      });
  };

  const idsAreSameOrder = (firstItems, secondItems) =>
    firstItems.length === secondItems.length &&
    firstItems.every((item, index) => item._id === secondItems[index]?._id);

  const moveItemInList = (items, sourceItemId, targetItemId, insertAfter = false) => {
    if (!sourceItemId || !targetItemId || sourceItemId === targetItemId) return items;

    const sourceIndex = items.findIndex((item) => item._id === sourceItemId);
    const targetIndex = items.findIndex((item) => item._id === targetItemId);
    if (sourceIndex < 0 || targetIndex < 0) return items;

    const nextItems = [...items];
    const [movedItem] = nextItems.splice(sourceIndex, 1);
    const targetIndexAfterRemoval = nextItems.findIndex((item) => item._id === targetItemId);
    const insertIndex = targetIndexAfterRemoval + (insertAfter ? 1 : 0);
    nextItems.splice(insertIndex, 0, movedItem);
    return nextItems;
  };

  const applyOptimisticRundownOrder = (nextItems) => {
    setShowDay((currentShowDay) => {
      if (!currentShowDay?.items) return currentShowDay;

      const orderById = new Map(nextItems.map((item, index) => [item._id, index]));
      return {
        ...currentShowDay,
        items: currentShowDay.items.map((item) =>
          orderById.has(item._id)
            ? { ...item, order: orderById.get(item._id) }
            : item
        ),
      };
    });
  };

  const reorderRundownItems = (nextItems, movedItemId) => {
    if (!showDay?._id || nextItems.length !== activeItems.length) return;
    if (idsAreSameOrder(nextItems, activeItems)) {
      setDraggingItemId('');
      setDragOverItemId('');
      setRundownPreviewItems([]);
      return;
    }

    setReorderingItemId(movedItemId || 'rundown');
    applyOptimisticRundownOrder(nextItems);
    setRundownPreviewItems([]);
    setMessage('');
    setErrorMessage('');

    axiosInstance
      .patch(`/broadcast/show-day/${showDay._id}/items/reorder`, {
        itemIds: nextItems.map((nextItem) => nextItem._id),
      })
      .then((response) => {
        setShowDay(response.data.showDay);
        setMessage('Rundown order updated.');
      })
      .catch((error) => {
        console.error('Error reordering rundown:', error);
        setErrorMessage(error.response?.data?.message || 'Rundown order could not be updated.');
        loadShowDay();
      })
      .finally(() => {
        setReorderingItemId('');
        setDraggingItemId('');
        setDragOverItemId('');
        setRundownPreviewItems([]);
      });
  };

  const handleRundownDragStart = (event, item) => {
    if (!isJoined || Boolean(reorderingItemId) || activeItems.length < 2) {
      event.preventDefault();
      return;
    }

    setDraggingItemId(item._id);
    setDragOverItemId('');
    setRundownPreviewItems(activeItems);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', item._id);
  };

  const handleRundownDragOver = (event, item) => {
    if (!draggingItemId || Boolean(reorderingItemId)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';

    if (draggingItemId === item._id) {
      setDragOverItemId('');
      return;
    }

    setDragOverItemId(item._id);
    const rowBounds = event.currentTarget.getBoundingClientRect();
    const insertAfter = event.clientY > rowBounds.top + rowBounds.height / 2;

    setRundownPreviewItems((currentItems) => {
      const sourceItems = currentItems.length > 0 ? currentItems : activeItems;
      const nextItems = moveItemInList(sourceItems, draggingItemId, item._id, insertAfter);
      return idsAreSameOrder(nextItems, sourceItems) ? currentItems : nextItems;
    });
  };

  const handleRundownDrop = (event, targetItem) => {
    event.preventDefault();
    event.stopPropagation();
    const sourceItemId = event.dataTransfer.getData('text/plain') || draggingItemId;
    setDragOverItemId('');

    if (!sourceItemId) {
      setDraggingItemId('');
      setRundownPreviewItems([]);
      return;
    }

    const nextItems = rundownPreviewItems.length > 0
      ? rundownPreviewItems
      : moveItemInList(activeItems, sourceItemId, targetItem._id);

    if (idsAreSameOrder(nextItems, activeItems)) {
      setDraggingItemId('');
      setRundownPreviewItems([]);
      return;
    }

    reorderRundownItems(nextItems, sourceItemId);
  };

  const handleRundownTableDragOver = (event) => {
    if (!draggingItemId || Boolean(reorderingItemId)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  };

  const handleRundownTableDrop = (event) => {
    if (!draggingItemId || Boolean(reorderingItemId)) return;
    event.preventDefault();

    if (rundownPreviewItems.length > 0) {
      reorderRundownItems(rundownPreviewItems, draggingItemId);
      return;
    }

    setDraggingItemId('');
    setDragOverItemId('');
  };

  const handleRundownDragEnd = () => {
    if (!reorderingItemId) {
      setDraggingItemId('');
      setDragOverItemId('');
      setRundownPreviewItems([]);
    }
  };

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, bgcolor: 'background.default', minHeight: '100vh' }}>
      <WorkspaceHeader
        eyebrow="Rundown emisije"
        title="Producer Desk"
        subtitle="Priprema dnevne emisije, dodavanje odobrenog materijala i praćenje izmjena."
        chips={[
          { label: `${activeItems.length} u emisiji`, color: 'primary' },
          { label: `${showDay?.producers?.length || 0} producent(a)`, variant: 'outlined' },
          { label: replaceTargetItem ? 'Replace mode aktivan' : 'Biblioteka spremna', color: replaceTargetItem ? 'warning' : 'default' },
        ]}
        actions={(
          <>
          <Button variant="outlined" startIcon={<RefreshIcon />} onClick={refresh} disabled={loading}>
            Osvježi
          </Button>
          <Button variant="contained" startIcon={<EventAvailableIcon />} onClick={joinShow} disabled={!selectedProgramId || isJoined}>
            {isJoined ? 'Priključen' : 'Priključi se emisiji'}
          </Button>
          </>
        )}
      />

      {message && <Alert severity="success" sx={{ mb: 2 }}>{message}</Alert>}
      {errorMessage && <Alert severity="error" sx={{ mb: 2 }}>{errorMessage}</Alert>}

      <CorrectionQueue role={user?.role} userId={user?.id} />

      <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2, mb: 2 }}>
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={1.5}
          justifyContent="space-between"
          alignItems={{ xs: 'stretch', md: 'center' }}
        >
          <Box>
            <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
              My shows
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {producerShortcuts.length > 0
                ? `${producerShortcuts.length} assigned in the next 14 days`
                : 'No assigned shows in the next 14 days'}
            </Typography>
          </Box>
          <Button variant="outlined" size="small" onClick={loadProducerShortcuts} disabled={shortcutsLoading}>
            Refresh
          </Button>
        </Stack>
        {shortcutsLoading && <LinearProgress sx={{ mt: 1.25 }} />}
        {producerShortcuts.length > 0 && (
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1.25 }}>
            {producerShortcuts.map((shortcut) => {
              const activeShortcut = String(showDay?._id || '') === String(shortcut._id);
              const readyLabel = shortcut.itemCount > 0
                ? `${shortcut.readyCount}/${shortcut.itemCount} ready`
                : 'empty';

              return (
                <Button
                  key={shortcut._id}
                  variant={activeShortcut ? 'contained' : 'outlined'}
                  size="small"
                  onClick={() => openShowShortcut(shortcut)}
                  sx={{
                    justifyContent: 'flex-start',
                    textTransform: 'none',
                    borderRadius: 1,
                    minHeight: 36,
                  }}
                >
                  {shortcut.program?.name || 'Show'} / {formatDate(shortcut.airDate)} / {readyLabel}
                </Button>
              );
            })}
          </Stack>
        )}
      </Paper>

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
                <TableBody onDragOver={handleRundownTableDragOver} onDrop={handleRundownTableDrop}>
                  {activeItems.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6}>
                        <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 3 }}>
                          No material in this show yet.
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ) : (
                    displayedRundownItems.map((item, index) => (
                      <TableRow
                        key={item._id}
                        hover
                        onDragOver={(event) => handleRundownDragOver(event, item)}
                        onDrop={(event) => handleRundownDrop(event, item)}
                        sx={{
                          ...(draggingItemId === item._id ? { opacity: 0.55 } : {}),
                          ...(dragOverItemId === item._id
                            ? {
                              bgcolor: 'action.hover',
                              outline: '2px solid',
                              outlineColor: 'primary.main',
                              outlineOffset: '-2px',
                            }
                            : {}),
                        }}
                      >
                        <TableCell sx={{ width: 96 }}>
                          <Stack direction="row" spacing={0.75} alignItems="center">
                            <Tooltip title={isJoined ? 'Drag to reorder' : 'Join show to reorder'}>
                              <Box
                                component="span"
                                draggable={isJoined && displayedRundownItems.length > 1 && !reorderingItemId}
                                onDragStart={(event) => handleRundownDragStart(event, item)}
                                onDragEnd={handleRundownDragEnd}
                                sx={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  width: 24,
                                  height: 28,
                                  borderRadius: 1,
                                  color: isJoined ? 'text.secondary' : 'text.disabled',
                                  cursor: isJoined && displayedRundownItems.length > 1 ? 'grab' : 'not-allowed',
                                  '&:active': { cursor: 'grabbing' },
                                  '&:hover': isJoined ? { bgcolor: 'action.hover', color: 'text.primary' } : {},
                                }}
                              >
                                <DragIndicatorIcon fontSize="small" />
                              </Box>
                            </Tooltip>
                            <Typography variant="body2" sx={{ fontWeight: 800, width: 20 }}>
                              {index + 1}
                            </Typography>
                          </Stack>
                        </TableCell>
                        <TableCell>
                          <Stack direction="row" spacing={1} alignItems="flex-start">
                            <VideoThumbnailPreview
                              videoId={item.video?._id}
                              title={item.title || item.video?.finalTitle || item.video?.originalFilename}
                              enableScrubPreview
                            />
                            <Box sx={{ minWidth: 0 }}>
                              <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
                                <Typography variant="body2" sx={{ fontWeight: 800, overflowWrap: 'anywhere' }}>
                                  {item.title || item.video?.finalTitle || item.video?.originalFilename || 'Untitled'}
                                </Typography>
                                {item.video?.correctionStatus === 'needs_correction' && (
                                  <Chip label="Potrebna ispravka" size="small" color="error" />
                                )}
                              </Stack>
                              <Typography variant="caption" color="text.secondary">
                                {formatDate(item.video?.airDate || showDay?.airDate)}
                              </Typography>
                              <Typography variant="caption" color="text.secondary" display="block">
                                Reporter: {getPersonName(item.video?.reporter)} / Editor: {getPersonName(item.video?.editor)}
                              </Typography>
                              {item.video?.correctionStatus === 'needs_correction' && (
                                <Typography variant="caption" color="error" display="block">
                                  {item.video?.correctionNote || 'Clip is tagged for correction.'}
                                </Typography>
                              )}
                            </Box>
                          </Stack>
                        </TableCell>
                        <TableCell>
                          <Chip
                            label={item.contentType?.name || 'N/A'}
                            size="small"
                            variant="outlined"
                            sx={getContentTypeChipSx(item.contentType)}
                          />
                        </TableCell>
                        <TableCell>
                          <Chip label={formatLabel(item.status)} size="small" />
                        </TableCell>
                        <TableCell>{item.addedBy?.username || 'Unknown'}</TableCell>
                        <TableCell align="right">
                          <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                            <Tooltip title={item.status === 'ready' ? 'Already ready' : item.status === 'aired' ? 'Already aired' : 'Mark ready'}>
                              <span>
                              <IconButton
                                size="small"
                                color="success"
                                onClick={() => updateItemStatus(item, 'ready')}
                                disabled={!isJoined || item.status === 'ready' || item.status === 'aired'}
                              >
                                <CheckCircleIcon fontSize="small" />
                              </IconButton>
                              </span>
                            </Tooltip>
                            <Tooltip title={item.status === 'aired' ? 'Already aired' : 'Mark aired'}>
                              <span>
                              <IconButton
                                size="small"
                                color="primary"
                                onClick={() => updateItemStatus(item, 'aired')}
                                disabled={!isJoined || item.status === 'aired'}
                              >
                                <EventAvailableIcon fontSize="small" />
                              </IconButton>
                              </span>
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
                        <VideoThumbnailPreview
                          videoId={video._id}
                          title={video.finalTitle || video.originalFilename || video.filename}
                          width={84}
                          height={52}
                          enableScrubPreview
                        />
                        <Box sx={{ minWidth: 0, flex: 1 }}>
                          <Typography variant="body2" sx={{ fontWeight: 800 }} noWrap>
                            {video.finalTitle || video.originalFilename || video.filename}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {video.contentType?.name || 'N/A'} / Approved by {video.finalApprovedBy?.username || 'N/A'}
                          </Typography>
                          {video.correctionStatus === 'needs_correction' && (
                            <Chip label="Potrebna ispravka" size="small" color="error" sx={{ mt: 0.5 }} />
                          )}
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
                  {activity.details?.title && (
                    <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
                      <Chip label={activity.details.title} size="small" variant="outlined" />
                      {activity.details.previousStatus && activity.details.status && (
                        <Chip
                          label={`${formatLabel(activity.details.previousStatus)} -> ${formatLabel(activity.details.status)}`}
                          size="small"
                          color="primary"
                          variant="outlined"
                        />
                      )}
                    </Stack>
                  )}
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
