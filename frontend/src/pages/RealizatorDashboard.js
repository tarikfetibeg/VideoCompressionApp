import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  Grid,
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
import DownloadIcon from '@mui/icons-material/Download';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import ReportProblemIcon from '@mui/icons-material/ReportProblem';
import RefreshIcon from '@mui/icons-material/Refresh';
import axiosInstance from '../axiosConfig';

const getTodayInputValue = () => {
  const today = new Date();
  today.setMinutes(today.getMinutes() - today.getTimezoneOffset());
  return today.toISOString().slice(0, 10);
};

const formatDateTime = (value) => {
  if (!value) return 'Never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Never';
  return date.toLocaleString();
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

const formatBytes = (bytes) => {
  if (!bytes && bytes !== 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = Number(bytes) || 0;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
};

const getResponseFilename = (response, fallbackName) => {
  const disposition = response.headers?.['content-disposition'] || '';
  const match = disposition.match(/filename="?([^"]+)"?/i);
  return match?.[1] || fallbackName;
};

const downloadBlobResponse = (response, fallbackName) => {
  const url = window.URL.createObjectURL(new Blob([response.data]));
  const link = document.createElement('a');

  link.href = url;
  link.setAttribute('download', getResponseFilename(response, fallbackName));
  document.body.appendChild(link);
  link.click();
  link.remove();

  window.URL.revokeObjectURL(url);
};

const getDownloadErrorMessage = async (error, fallback) => {
  const data = error.response?.data;

  if (data instanceof Blob) {
    try {
      const text = await data.text();
      const parsed = JSON.parse(text);
      return parsed.message || fallback;
    } catch (parseError) {
      return fallback;
    }
  }

  return data?.message || fallback;
};

const RealizatorDashboard = () => {
  const [programs, setPrograms] = useState([]);
  const [selectedProgramId, setSelectedProgramId] = useState('');
  const [selectedDate, setSelectedDate] = useState(getTodayInputValue);
  const [showDay, setShowDay] = useState(null);
  const [message, setMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadPhase, setDownloadPhase] = useState('');
  const [downloadedBytes, setDownloadedBytes] = useState(0);
  const [markingAired, setMarkingAired] = useState(false);
  const [reportTarget, setReportTarget] = useState(null);
  const [reportNote, setReportNote] = useState('');
  const [reportingIssue, setReportingIssue] = useState(false);
  const [reorderingItemId, setReorderingItemId] = useState('');
  const [draggingItemId, setDraggingItemId] = useState('');
  const [dragOverItemId, setDragOverItemId] = useState('');
  const [rundownPreviewItems, setRundownPreviewItems] = useState([]);

  const activeItems = useMemo(
    () => (showDay?.items || [])
      .filter((item) => item.status !== 'removed')
      .sort((a, b) => Number(a.order || 0) - Number(b.order || 0)),
    [showDay]
  );

  const displayedRundownItems = rundownPreviewItems.length > 0 ? rundownPreviewItems : activeItems;

  const changedItems = useMemo(
    () => activeItems.filter((item) => item.changedSinceDownload),
    [activeItems]
  );

  const loadSettings = useCallback(() => {
    axiosInstance
      .get('/broadcast/programs')
      .then((response) => {
        const nextPrograms = Array.isArray(response.data) ? response.data : [];
        setPrograms(nextPrograms);
        setSelectedProgramId((current) => current || nextPrograms[0]?._id || '');
      })
      .catch((error) => {
        console.error('Error loading programs:', error);
        setErrorMessage('Programs could not be loaded.');
      });
  }, []);

  const loadShowDay = useCallback(() => {
    if (!selectedProgramId || !selectedDate) return;

    setLoading(true);
    setErrorMessage('');
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
        console.error('Error loading rundown:', error);
        setShowDay(null);
        setErrorMessage(error.response?.data?.message || 'Rundown could not be loaded.');
      })
      .finally(() => setLoading(false));
  }, [selectedProgramId, selectedDate]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    loadShowDay();
  }, [loadShowDay]);

  const refresh = () => {
    setMessage('');
    setErrorMessage('');
    loadShowDay();
  };

  const downloadPackage = () => {
    if (!showDay?._id) return;

    setDownloading(true);
    setDownloadPhase('preparing');
    setDownloadedBytes(0);
    setMessage('');
    setErrorMessage('');

    axiosInstance
      .get(`/broadcast/show-day/${showDay._id}/download-package`, {
        responseType: 'blob',
        onDownloadProgress: (progressEvent) => {
          setDownloadPhase('receiving');
          setDownloadedBytes(progressEvent.loaded || 0);
        },
      })
      .then((response) => {
        downloadBlobResponse(response, `show_${selectedDate}_air_package.zip`);
        setMessage('Air package download started.');
        loadShowDay();
      })
      .catch(async (error) => {
        console.error('Error downloading air package:', error);
        setErrorMessage(await getDownloadErrorMessage(error, 'Air package could not be downloaded.'));
      })
      .finally(() => {
        setDownloading(false);
        setDownloadPhase('');
        setDownloadedBytes(0);
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
    if (Boolean(reorderingItemId) || activeItems.length < 2) {
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

  const markShowAired = () => {
    if (!showDay?._id) return;

    setMarkingAired(true);
    setMessage('');
    setErrorMessage('');

    axiosInstance
      .post(`/broadcast/show-day/${showDay._id}/mark-aired`)
      .then((response) => {
        setShowDay(response.data.showDay);
        setMessage(response.data?.message || 'Show marked as aired.');
      })
      .catch((error) => {
        console.error('Error marking show as aired:', error);
        setErrorMessage(error.response?.data?.message || 'Show could not be marked as aired.');
      })
      .finally(() => setMarkingAired(false));
  };

  const openReportDialog = (item) => {
    setReportTarget(item);
    setReportNote(item.video?.correctionNote || '');
    setMessage('');
    setErrorMessage('');
  };

  const closeReportDialog = () => {
    if (reportingIssue) return;
    setReportTarget(null);
    setReportNote('');
  };

  const submitCorrectionReport = () => {
    if (!showDay?._id || !reportTarget?._id) return;

    setReportingIssue(true);
    setMessage('');
    setErrorMessage('');

    axiosInstance
      .post(`/broadcast/show-day/${showDay._id}/items/${reportTarget._id}/report-error`, {
        note: reportNote,
      })
      .then((response) => {
        setShowDay(response.data.showDay);
        setMessage(response.data?.message || 'Clip tagged as Potrebna ispravka.');
        setReportTarget(null);
        setReportNote('');
      })
      .catch((error) => {
        console.error('Error reporting clip issue:', error);
        setErrorMessage(error.response?.data?.message || 'Clip issue could not be reported.');
      })
      .finally(() => setReportingIssue(false));
  };

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, bgcolor: 'background.default', minHeight: '100vh' }}>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={2}
        justifyContent="space-between"
        alignItems={{ xs: 'stretch', md: 'center' }}
        sx={{ mb: 3 }}
      >
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 800 }}>
            Realizator Desk
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Download the current air package and watch last-minute rundown changes.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" startIcon={<RefreshIcon />} onClick={refresh} disabled={loading}>
            Refresh
          </Button>
          <Button
            variant="contained"
            startIcon={<DownloadIcon />}
            onClick={downloadPackage}
            disabled={!showDay || activeItems.length === 0 || downloading}
          >
            {downloading ? 'Preparing ZIP...' : 'Download air package'}
          </Button>
          <Button
            variant="outlined"
            color="success"
            startIcon={<CheckCircleIcon />}
            onClick={markShowAired}
            disabled={!showDay || activeItems.length === 0 || markingAired}
          >
            {markingAired
              ? 'Confirming...'
              : showDay?.archiveConfirmedAt
                ? 'Confirm aired again'
                : 'Confirm aired'}
          </Button>
        </Stack>
      </Stack>

      {message && <Alert severity="success" sx={{ mb: 2 }}>{message}</Alert>}
      {errorMessage && <Alert severity="error" sx={{ mb: 2 }}>{errorMessage}</Alert>}

      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, mb: 3 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} md={5}>
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
          <Grid item xs={12} md={4}>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Chip label={`${activeItems.length} item(s)`} color="primary" />
              <Chip label={`Last download: ${formatDateTime(showDay?.downloadState?.lastDownloadedAt)}`} variant="outlined" />
              <Chip
                label={showDay?.archiveConfirmedAt
                  ? `Aired: ${formatDateTime(showDay.archiveConfirmedAt)}`
                  : 'Not confirmed aired'}
                color={showDay?.archiveConfirmedAt ? 'success' : 'default'}
                variant={showDay?.archiveConfirmedAt ? 'filled' : 'outlined'}
              />
            </Stack>
          </Grid>
        </Grid>
      </Paper>

      {loading && <LinearProgress sx={{ mb: 2 }} />}

      {showDay?.downloadState?.hasChangesSinceDownload && (
        <Alert severity="warning" sx={{ mb: 2, fontWeight: 800 }}>
          {changedItems.length > 0
            ? `${changedItems.length} item(s) changed since your last download.`
            : `${showDay.downloadState.changeCountSinceDownload} rundown change(s) since your last download.`}
        </Alert>
      )}

      <Grid container spacing={2}>
        <Grid item xs={12} lg={8}>
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
            <Typography variant="h6" sx={{ fontWeight: 800, mb: 2 }}>
              Rundown
            </Typography>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>#</TableCell>
                    <TableCell>Material</TableCell>
                    <TableCell>Type</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>QA</TableCell>
                    <TableCell align="right">Issue</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody onDragOver={handleRundownTableDragOver} onDrop={handleRundownTableDrop}>
                  {activeItems.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6}>
                        <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
                          No active material in this show yet.
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
                          ...(item.changedSinceDownload ? { bgcolor: 'warning.light' } : {}),
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
                            <Tooltip title="Drag to reorder">
                              <Box
                                component="span"
                                draggable={displayedRundownItems.length > 1 && !reorderingItemId}
                                onDragStart={(event) => handleRundownDragStart(event, item)}
                                onDragEnd={handleRundownDragEnd}
                                sx={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  width: 24,
                                  height: 28,
                                  borderRadius: 1,
                                  color: displayedRundownItems.length > 1 ? 'text.secondary' : 'text.disabled',
                                  cursor: displayedRundownItems.length > 1 ? 'grab' : 'not-allowed',
                                  '&:active': { cursor: 'grabbing' },
                                  '&:hover': displayedRundownItems.length > 1 ? { bgcolor: 'action.hover', color: 'text.primary' } : {},
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
                          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                            <Typography variant="body2" sx={{ fontWeight: 800 }}>
                              {item.title || item.video?.finalTitle || item.video?.originalFilename || 'Untitled'}
                            </Typography>
                            {item.changedSinceDownload && <Chip label="Changed since download" color="warning" size="small" />}
                            {item.video?.correctionStatus === 'needs_correction' && (
                              <Chip label="Potrebna ispravka" color="error" size="small" />
                            )}
                          </Stack>
                          <Typography variant="caption" color="text.secondary">
                            Reporter: {getPersonName(item.video?.reporter)} / Editor: {getPersonName(item.video?.editor)}
                          </Typography>
                          {item.video?.correctionStatus === 'needs_correction' && (
                            <Typography variant="caption" color="error" sx={{ display: 'block' }}>
                              {item.video?.correctionNote || 'Clip is tagged for correction.'}
                              {item.video?.correctionReportedBy?.username
                                ? ` / ${item.video.correctionReportedBy.username}`
                                : ''}
                            </Typography>
                          )}
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
                        <TableCell>{getPersonName(item.video?.qaResponsible)}</TableCell>
                        <TableCell align="right">
                          <Button
                            size="small"
                            variant={item.video?.correctionStatus === 'needs_correction' ? 'contained' : 'outlined'}
                            color="warning"
                            startIcon={<ReportProblemIcon />}
                            onClick={() => openReportDialog(item)}
                          >
                            {item.video?.correctionStatus === 'needs_correction' ? 'Update' : 'Report'}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        </Grid>

        <Grid item xs={12} lg={4}>
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
            <Typography variant="h6" sx={{ fontWeight: 800, mb: 2 }}>
              Changes
            </Typography>
            <Stack spacing={1}>
              {(showDay?.activitySinceDownload || []).slice().reverse().map((activity) => (
                <Alert key={activity._id} severity="warning" variant="outlined">
                  <Typography variant="body2" sx={{ fontWeight: 800 }}>
                    {activity.summary}
                  </Typography>
                  <Typography variant="caption">
                    {activity.performedBy?.username || 'Unknown'} / {formatDateTime(activity.createdAt)}
                  </Typography>
                </Alert>
              ))}
              {(showDay?.activitySinceDownload || []).length === 0 && (
                <Typography variant="body2" color="text.secondary">
                  No changes since your last download.
                </Typography>
              )}
            </Stack>
          </Paper>
        </Grid>
      </Grid>

      <Dialog open={Boolean(reportTarget)} onClose={closeReportDialog} fullWidth maxWidth="sm">
        <DialogTitle>Prijavi grešku klipa</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Alert severity="warning">
              Klip će biti označen kao <strong>Potrebna ispravka</strong> i ta oznaka ostaje na video zapisu.
            </Alert>
            <Typography variant="body2" sx={{ fontWeight: 800 }}>
              {reportTarget?.title || reportTarget?.video?.finalTitle || reportTarget?.video?.originalFilename || 'Untitled'}
            </Typography>
            <TextField
              label="Opis greške"
              value={reportNote}
              onChange={(event) => setReportNote(event.target.value)}
              placeholder="Npr. krivi kadar, loš ton, pogrešna verzija, fali grafika..."
              multiline
              minRows={3}
              fullWidth
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeReportDialog} disabled={reportingIssue}>
            Cancel
          </Button>
          <Button
            variant="contained"
            color="warning"
            startIcon={<ReportProblemIcon />}
            onClick={submitCorrectionReport}
            disabled={reportingIssue}
          >
            {reportingIssue ? 'Saving...' : 'Tag Potrebna ispravka'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={downloading} fullWidth maxWidth="xs">
        <DialogTitle>Preparing air package</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <LinearProgress />
            <Typography variant="body2" sx={{ fontWeight: 800 }}>
              {downloadPhase === 'receiving'
                ? 'ZIP is being transferred to this computer.'
                : 'Server is collecting rundown files and creating the ZIP.'}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Keep this tab open until the download starts. Large shows can take a little longer because every video file is added to the package.
            </Typography>
            {downloadedBytes > 0 && (
              <Chip
                label={`${formatBytes(downloadedBytes)} received`}
                color="primary"
                variant="outlined"
                sx={{ alignSelf: 'flex-start' }}
              />
            )}
          </Stack>
        </DialogContent>
      </Dialog>
    </Box>
  );
};

export default RealizatorDashboard;
