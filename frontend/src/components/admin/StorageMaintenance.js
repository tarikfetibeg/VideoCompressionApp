import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
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
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import CleaningServicesIcon from '@mui/icons-material/CleaningServices';
import DeleteIcon from '@mui/icons-material/Delete';
import RefreshIcon from '@mui/icons-material/Refresh';
import axiosInstance from '../../axiosConfig';

const formatBytes = (bytes) => {
  if (!bytes && bytes !== 0) return 'N/A';

  const value = Number(bytes);
  if (Number.isNaN(value)) return 'N/A';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
};

const formatDateTime = (value) => {
  if (!value) return 'N/A';
  return new Date(value).toLocaleString();
};

const feedbackStatusOptions = [
  { value: 'all', label: 'Svi statusi' },
  { value: 'new', label: 'Novo' },
  { value: 'reviewing', label: 'U pregledu' },
  { value: 'planned', label: 'Planirano' },
  { value: 'fixed', label: 'Rijeseno' },
  { value: 'rejected', label: 'Odbijeno' },
];

const feedbackTypeOptions = [
  { value: 'all', label: 'Svi tipovi' },
  { value: 'bug', label: 'Bug' },
  { value: 'suggestion', label: 'Sugestija' },
  { value: 'workflow_issue', label: 'Workflow problem' },
  { value: 'urgent_production_issue', label: 'Hitno za produkciju' },
];

const getOptionLabel = (options, value) =>
  options.find((option) => option.value === value)?.label || value || 'N/A';

const StorageMaintenance = () => {
  const [tab, setTab] = useState('off');
  const [offFiles, setOffFiles] = useState([]);
  const [manifests, setManifests] = useState([]);
  const [feedbackItems, setFeedbackItems] = useState([]);
  const [feedbackFilters, setFeedbackFilters] = useState({
    search: '',
    status: 'all',
    type: 'all',
  });
  const [manifestSummary, setManifestSummary] = useState({ count: 0, orphanCount: 0 });
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null);
  const [message, setMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const fetchOffFiles = useCallback(() => {
    return axiosInstance
      .get('/admin/off-files')
      .then((response) => setOffFiles(Array.isArray(response.data) ? response.data : []));
  }, []);

  const fetchRawManifests = useCallback(() => {
    return axiosInstance
      .get('/admin/raw-manifests')
      .then((response) => {
        setManifests(Array.isArray(response.data?.manifests) ? response.data.manifests : []);
        setManifestSummary({
          count: Number(response.data?.count) || 0,
          orphanCount: Number(response.data?.orphanCount) || 0,
        });
      });
  }, []);

  const fetchFeedbackItems = useCallback(() => {
    return axiosInstance
      .get('/feedback', { params: { limit: 500, status: 'all', type: 'all' } })
      .then((response) => setFeedbackItems(Array.isArray(response.data) ? response.data : []));
  }, []);

  const refreshAll = useCallback(() => {
    setLoading(true);
    setErrorMessage('');

    Promise.all([fetchOffFiles(), fetchRawManifests(), fetchFeedbackItems()])
      .catch((error) => {
        console.error('Error loading storage maintenance data:', error);
        setErrorMessage('Nije moguce ucitati storage maintenance podatke.');
      })
      .finally(() => setLoading(false));
  }, [fetchFeedbackItems, fetchOffFiles, fetchRawManifests]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  const stats = useMemo(() => ({
    offTotal: offFiles.length,
    offMissing: offFiles.filter((file) => !file.exists).length,
    manifestTotal: manifests.length,
    manifestOrphans: manifests.filter((manifest) => manifest.orphan).length,
    feedbackTotal: feedbackItems.length,
    feedbackClosed: feedbackItems.filter((item) => ['fixed', 'rejected'].includes(item.status)).length,
  }), [feedbackItems, offFiles, manifests]);

  const filteredFeedbackItems = useMemo(() => {
    const search = feedbackFilters.search.trim().toLowerCase();

    return feedbackItems.filter((item) => {
      const matchesStatus =
        feedbackFilters.status === 'all' || item.status === feedbackFilters.status;
      const matchesType =
        feedbackFilters.type === 'all' || item.type === feedbackFilters.type;
      const matchesSearch =
        !search ||
        [
          item.title,
          item.description,
          item.adminResponse,
          item.submittedBy?.username,
          item.submittedByRole,
          item.area,
        ]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(search));

      return matchesStatus && matchesType && matchesSearch;
    });
  }, [feedbackFilters, feedbackItems]);

  const handleFeedbackFilterChange = (event) => {
    const { name, value } = event.target;
    setFeedbackFilters((current) => ({
      ...current,
      [name]: value,
    }));
  };

  const runConfirmedAction = () => {
    if (!confirmAction) return;

    setBusy(true);
    setMessage('');
    setErrorMessage('');

    confirmAction.run()
      .then((successMessage) => {
        setMessage(successMessage);
        setConfirmAction(null);
        refreshAll();
      })
      .catch((error) => {
        console.error('Storage maintenance action failed:', error);
        setErrorMessage(error.response?.data?.message || 'Akcija nije uspjela.');
      })
      .finally(() => setBusy(false));
  };

  const confirmDeleteOffFile = (offFile) => {
    setConfirmAction({
      title: 'Delete OFF audio',
      body: `Obrisati OFF fajl "${offFile.originalName || offFile.filename}" iz joba "${offFile.jobTitle}"?`,
      run: () =>
        axiosInstance
          .delete(`/admin/off-files/${offFile.jobId}/${offFile.offFileId}`)
          .then(() => 'OFF fajl je obrisan.'),
    });
  };

  const confirmDeleteManifest = (manifest) => {
    setConfirmAction({
      title: 'Delete raw manifest',
      body: `Obrisati raw manifest "${manifest.filename}"? Raw video fajl se ne brise ovom akcijom.`,
      run: () =>
        axiosInstance
          .delete(`/admin/raw-manifests/${encodeURIComponent(manifest.filename)}`)
          .then(() => 'Raw manifest je obrisan.'),
    });
  };

  const confirmCleanupManifests = () => {
    setConfirmAction({
      title: 'Cleanup orphan raw manifests',
      body: `Obrisati ${manifestSummary.orphanCount} orphan raw manifest fajl(ova)?`,
      run: () =>
        axiosInstance
          .post('/admin/raw-manifests/cleanup-orphans')
          .then((response) => response.data?.message || 'Orphan raw manifesti su ocisceni.'),
    });
  };

  const confirmDeleteFeedback = (feedback) => {
    setConfirmAction({
      title: 'Delete feedback/prijavu',
      body: `Obrisati prijavu "${feedback.title}" koju je poslao ${feedback.submittedBy?.username || 'nepoznat korisnik'}?`,
      run: () =>
        axiosInstance
          .delete(`/feedback/${feedback._id}`)
          .then(() => 'Feedback/prijava je obrisana.'),
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
            Storage Maintenance
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Servisni pregled OFF audio fajlova i raw manifesta.
          </Typography>
        </Box>

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
          <Button
            variant="outlined"
            startIcon={<RefreshIcon />}
            onClick={refreshAll}
            disabled={loading}
          >
            Refresh
          </Button>
          <Button
            variant="contained"
            color="warning"
            startIcon={<CleaningServicesIcon />}
            onClick={confirmCleanupManifests}
            disabled={manifestSummary.orphanCount === 0 || busy}
          >
            Cleanup Orphans ({manifestSummary.orphanCount})
          </Button>
        </Stack>
      </Stack>

      {message && <Alert severity="success" sx={{ mb: 2 }}>{message}</Alert>}
      {errorMessage && <Alert severity="error" sx={{ mb: 2 }}>{errorMessage}</Alert>}

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={6} md={3}>
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
            <Typography variant="overline" color="text.secondary">OFF files</Typography>
            <Typography variant="h5" sx={{ fontWeight: 800 }}>{stats.offTotal}</Typography>
          </Paper>
        </Grid>
        <Grid item xs={6} md={3}>
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
            <Typography variant="overline" color="text.secondary">Missing OFF</Typography>
            <Typography variant="h5" sx={{ fontWeight: 800 }}>{stats.offMissing}</Typography>
          </Paper>
        </Grid>
        <Grid item xs={6} md={3}>
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
            <Typography variant="overline" color="text.secondary">Raw manifests</Typography>
            <Typography variant="h5" sx={{ fontWeight: 800 }}>{stats.manifestTotal}</Typography>
          </Paper>
        </Grid>
        <Grid item xs={6} md={3}>
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
            <Typography variant="overline" color="text.secondary">Orphan manifests</Typography>
            <Typography variant="h5" sx={{ fontWeight: 800 }}>{stats.manifestOrphans}</Typography>
          </Paper>
        </Grid>
        <Grid item xs={6} md={3}>
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
            <Typography variant="overline" color="text.secondary">Feedback records</Typography>
            <Typography variant="h5" sx={{ fontWeight: 800 }}>{stats.feedbackTotal}</Typography>
          </Paper>
        </Grid>
        <Grid item xs={6} md={3}>
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
            <Typography variant="overline" color="text.secondary">Closed feedback</Typography>
            <Typography variant="h5" sx={{ fontWeight: 800 }}>{stats.feedbackClosed}</Typography>
          </Paper>
        </Grid>
      </Grid>

      <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
        <Tabs value={tab} onChange={(event, value) => setTab(value)} sx={{ px: 2, borderBottom: 1, borderColor: 'divider' }}>
          <Tab value="off" label="OFF audio" />
          <Tab value="manifests" label="Raw manifests" />
          <Tab value="feedback" label="Feedback/prijave" />
        </Tabs>

        {tab === 'off' && (
          <Box sx={{ p: 2 }}>
            {offFiles.length === 0 ? (
              <Alert severity="info">Nema OFF fajlova u edit jobovima.</Alert>
            ) : (
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>OFF file</TableCell>
                      <TableCell>Job</TableCell>
                      <TableCell>Reporter</TableCell>
                      <TableCell>Editor</TableCell>
                      <TableCell>Size</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell align="right">Action</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {offFiles.map((file) => (
                      <TableRow key={`${file.jobId}-${file.offFileId}`} hover>
                        <TableCell>
                          <Typography variant="body2" sx={{ fontWeight: 700 }}>
                            {file.originalName || file.filename || 'OFF file'}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {formatDateTime(file.uploadedAt)}
                          </Typography>
                        </TableCell>
                        <TableCell>{file.jobTitle || 'N/A'}</TableCell>
                        <TableCell>{file.reporter?.username || 'N/A'}</TableCell>
                        <TableCell>{file.assignedEditor?.username || 'N/A'}</TableCell>
                        <TableCell>{formatBytes(file.size)}</TableCell>
                        <TableCell>
                          <Chip
                            label={file.exists ? 'Exists' : 'Missing'}
                            size="small"
                            color={file.exists ? 'success' : 'warning'}
                            variant="outlined"
                          />
                        </TableCell>
                        <TableCell align="right">
                          <Button
                            size="small"
                            color="error"
                            startIcon={<DeleteIcon />}
                            onClick={() => confirmDeleteOffFile(file)}
                          >
                            Delete
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </Box>
        )}

        {tab === 'manifests' && (
          <Box sx={{ p: 2 }}>
            <Alert severity="info" sx={{ mb: 2 }}>
              Raw manifest je pomocni metadata fajl za recovery sirovine. Brisanje manifesta ne brise raw video.
            </Alert>
            {manifests.length === 0 ? (
              <Alert severity="info">Nema raw manifest fajlova.</Alert>
            ) : (
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Manifest</TableCell>
                      <TableCell>Raw exists</TableCell>
                      <TableCell>DB record</TableCell>
                      <TableCell>Size</TableCell>
                      <TableCell>Modified</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell align="right">Action</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {manifests.map((manifest) => (
                      <TableRow key={manifest.filename} hover>
                        <TableCell>
                          <Typography variant="body2" sx={{ fontWeight: 700 }}>
                            {manifest.filename}
                          </Typography>
                          {manifest.parseError && (
                            <Typography variant="caption" color="error">
                              {manifest.parseError}
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell>
                          <Chip
                            label={manifest.rawExists ? 'Yes' : 'No'}
                            size="small"
                            color={manifest.rawExists ? 'success' : 'warning'}
                            variant="outlined"
                          />
                        </TableCell>
                        <TableCell>
                          <Chip
                            label={manifest.dbRecordExists ? 'Yes' : 'No'}
                            size="small"
                            color={manifest.dbRecordExists ? 'success' : 'warning'}
                            variant="outlined"
                          />
                        </TableCell>
                        <TableCell>{formatBytes(manifest.size)}</TableCell>
                        <TableCell>{formatDateTime(manifest.modifiedAt)}</TableCell>
                        <TableCell>
                          <Chip
                            label={manifest.orphan ? 'Orphan' : 'Linked'}
                            size="small"
                            color={manifest.orphan ? 'warning' : 'success'}
                          />
                        </TableCell>
                        <TableCell align="right">
                          <Button
                            size="small"
                            color="error"
                            startIcon={<DeleteIcon />}
                            onClick={() => confirmDeleteManifest(manifest)}
                          >
                            Delete
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </Box>
        )}

        {tab === 'feedback' && (
          <Box sx={{ p: 2 }}>
            <Alert severity="warning" sx={{ mb: 2 }}>
              Brisanje ovdje uklanja feedback/prijavu iz inboxa i korisnickog pregleda. Akcija ostaje evidentirana u audit logu.
            </Alert>

            <Grid container spacing={2} sx={{ mb: 2 }}>
              <Grid item xs={12} md={6}>
                <TextField
                  name="search"
                  label="Search"
                  value={feedbackFilters.search}
                  onChange={handleFeedbackFilterChange}
                  fullWidth
                  size="small"
                />
              </Grid>
              <Grid item xs={6} md={3}>
                <FormControl fullWidth size="small">
                  <InputLabel>Status</InputLabel>
                  <Select
                    name="status"
                    value={feedbackFilters.status}
                    label="Status"
                    onChange={handleFeedbackFilterChange}
                  >
                    {feedbackStatusOptions.map((option) => (
                      <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={6} md={3}>
                <FormControl fullWidth size="small">
                  <InputLabel>Tip</InputLabel>
                  <Select
                    name="type"
                    value={feedbackFilters.type}
                    label="Tip"
                    onChange={handleFeedbackFilterChange}
                  >
                    {feedbackTypeOptions.map((option) => (
                      <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
            </Grid>

            {filteredFeedbackItems.length === 0 ? (
              <Alert severity="info">Nema feedback/prijava za trenutne filtere.</Alert>
            ) : (
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Prijava</TableCell>
                      <TableCell>Korisnik</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell>Tip</TableCell>
                      <TableCell>Seen</TableCell>
                      <TableCell>Updated</TableCell>
                      <TableCell align="right">Action</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {filteredFeedbackItems.map((feedback) => (
                      <TableRow key={feedback._id} hover>
                        <TableCell sx={{ maxWidth: 340 }}>
                          <Typography variant="body2" sx={{ fontWeight: 700 }} noWrap>
                            {feedback.title}
                          </Typography>
                          <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
                            {feedback.description}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2">
                            {feedback.submittedBy?.username || 'N/A'}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {feedback.submittedByRole || feedback.submittedBy?.role || 'Role'}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Chip
                            label={getOptionLabel(feedbackStatusOptions, feedback.status)}
                            size="small"
                            color={feedback.status === 'fixed' ? 'success' : feedback.status === 'rejected' ? 'default' : 'warning'}
                            variant="outlined"
                          />
                        </TableCell>
                        <TableCell>
                          <Chip
                            label={getOptionLabel(feedbackTypeOptions, feedback.type)}
                            size="small"
                            variant="outlined"
                          />
                        </TableCell>
                        <TableCell>
                          <Chip
                            label={feedback.adminSeenAt ? 'Yes' : 'No'}
                            size="small"
                            color={feedback.adminSeenAt ? 'success' : 'default'}
                            variant="outlined"
                          />
                        </TableCell>
                        <TableCell>{formatDateTime(feedback.updatedAt)}</TableCell>
                        <TableCell align="right">
                          <Button
                            size="small"
                            color="error"
                            startIcon={<DeleteIcon />}
                            onClick={() => confirmDeleteFeedback(feedback)}
                          >
                            Delete
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </Box>
        )}

        <Divider />
        <Box sx={{ px: 2, py: 1.5 }}>
          <Typography variant="caption" color="text.secondary">
            Sve akcije brisanja se zapisuju u audit log.
          </Typography>
        </Box>
      </Paper>

      <Dialog open={Boolean(confirmAction)} onClose={() => setConfirmAction(null)}>
        <DialogTitle>{confirmAction?.title || 'Confirm action'}</DialogTitle>
        <DialogContent>
          <DialogContentText>{confirmAction?.body}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmAction(null)} disabled={busy}>Cancel</Button>
          <Button color="error" variant="contained" onClick={runConfirmedAction} disabled={busy}>
            {busy ? 'Working...' : 'Confirm'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default StorageMaintenance;
