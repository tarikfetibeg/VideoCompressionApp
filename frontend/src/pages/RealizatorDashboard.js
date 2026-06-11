import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
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
  Typography,
} from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
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

const RealizatorDashboard = () => {
  const [programs, setPrograms] = useState([]);
  const [selectedProgramId, setSelectedProgramId] = useState('');
  const [selectedDate, setSelectedDate] = useState(getTodayInputValue);
  const [showDay, setShowDay] = useState(null);
  const [message, setMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const activeItems = useMemo(
    () => (showDay?.items || [])
      .filter((item) => item.status !== 'removed')
      .sort((a, b) => Number(a.order || 0) - Number(b.order || 0)),
    [showDay]
  );

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
    setMessage('');
    setErrorMessage('');

    axiosInstance
      .get(`/broadcast/show-day/${showDay._id}/download-package`, { responseType: 'blob' })
      .then((response) => {
        downloadBlobResponse(response, `show_${selectedDate}_air_package.zip`);
        setMessage('Air package download started.');
        loadShowDay();
      })
      .catch((error) => {
        console.error('Error downloading air package:', error);
        setErrorMessage(error.response?.data?.message || 'Air package could not be downloaded.');
      })
      .finally(() => setDownloading(false));
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
            {downloading ? 'Downloading...' : 'Download air package'}
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
                  </TableRow>
                </TableHead>
                <TableBody>
                  {activeItems.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5}>
                        <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
                          No active material in this show yet.
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ) : (
                    activeItems.map((item, index) => (
                      <TableRow
                        key={item._id}
                        hover
                        sx={item.changedSinceDownload ? { bgcolor: 'warning.light' } : undefined}
                      >
                        <TableCell>{index + 1}</TableCell>
                        <TableCell>
                          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                            <Typography variant="body2" sx={{ fontWeight: 800 }}>
                              {item.title || item.video?.finalTitle || item.video?.originalFilename || 'Untitled'}
                            </Typography>
                            {item.changedSinceDownload && <Chip label="Changed since download" color="warning" size="small" />}
                          </Stack>
                          <Typography variant="caption" color="text.secondary">
                            Reporter: {getPersonName(item.video?.reporter)} / Editor: {getPersonName(item.video?.editor)}
                          </Typography>
                        </TableCell>
                        <TableCell>{item.contentType?.name || 'N/A'}</TableCell>
                        <TableCell>
                          <Chip label={formatLabel(item.status)} size="small" />
                        </TableCell>
                        <TableCell>{getPersonName(item.video?.qaResponsible)}</TableCell>
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
    </Box>
  );
};

export default RealizatorDashboard;
