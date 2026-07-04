import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  Grid,
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
  const [tab, setTab] = useState('capacity');
  const [storageOverview, setStorageOverview] = useState(null);
  const [storageSettings, setStorageSettings] = useState({
    warningFreePercent: 20,
    criticalFreePercent: 10,
  });
  const [mediaPreviewSummary, setMediaPreviewSummary] = useState(null);
  const [rebuildForm, setRebuildForm] = useState({
    scope: 'outdated',
    limit: 10,
    assetTypes: ['mp4', 'hls', 'thumbnail', 'scrub'],
  });
  const [rebuildResult, setRebuildResult] = useState(null);
  const [offFiles, setOffFiles] = useState([]);
  const [manifests, setManifests] = useState([]);
  const [feedbackItems, setFeedbackItems] = useState([]);
  const [scrubPreviewSummary, setScrubPreviewSummary] = useState({
    totalCompleted: 0,
    scanned: 0,
    withPreview: 0,
    missingPreview: 0,
    errored: 0,
    sourceMissing: 0,
  });
  const [scrubPreviewLimit, setScrubPreviewLimit] = useState(10);
  const [scrubPreviewResult, setScrubPreviewResult] = useState(null);
  const [hlsSummary, setHlsSummary] = useState({
    totalCompleted: 0,
    scanned: 0,
    ready: 0,
    missing: 0,
    queued: 0,
    processing: 0,
    failed: 0,
    sourceMissing: 0,
    totalBytes: 0,
  });
  const [hlsLimit, setHlsLimit] = useState(5);
  const [hlsResult, setHlsResult] = useState(null);
  const [previewRetentionLimit, setPreviewRetentionLimit] = useState(50);
  const [previewRetentionScan, setPreviewRetentionScan] = useState(null);
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

  const fetchStorageOverview = useCallback(() => {
    return axiosInstance
      .get('/admin/storage/overview')
      .then((response) => setStorageOverview(response.data || null));
  }, []);

  const fetchStorageSettings = useCallback(() => {
    return axiosInstance
      .get('/admin/storage/settings')
      .then((response) => setStorageSettings({
        warningFreePercent: Number(response.data?.warningFreePercent) || 20,
        criticalFreePercent: Number(response.data?.criticalFreePercent) || 10,
      }));
  }, []);

  const fetchMediaPreviewSummary = useCallback(() => {
    return axiosInstance
      .get('/admin/media-previews/summary')
      .then((response) => setMediaPreviewSummary(response.data || null));
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

  const fetchScrubPreviewSummary = useCallback(() => {
    return axiosInstance
      .get('/admin/scrub-previews/summary')
      .then((response) => setScrubPreviewSummary((current) => ({
        ...current,
        ...(response.data || {}),
      })));
  }, []);

  const fetchHlsSummary = useCallback(() => {
    return axiosInstance
      .get('/admin/hls-previews/summary')
      .then((response) => setHlsSummary((current) => ({
        ...current,
        ...(response.data || {}),
      })));
  }, []);

  const refreshAll = useCallback(() => {
    setLoading(true);
    setErrorMessage('');

    Promise.all([
      fetchOffFiles(),
      fetchRawManifests(),
      fetchFeedbackItems(),
      fetchScrubPreviewSummary(),
      fetchHlsSummary(),
      fetchStorageOverview(),
      fetchStorageSettings(),
      fetchMediaPreviewSummary(),
    ])
      .catch((error) => {
        console.error('Error loading storage maintenance data:', error);
        setErrorMessage('Nije moguce ucitati storage maintenance podatke.');
      })
      .finally(() => setLoading(false));
  }, [
    fetchFeedbackItems,
    fetchHlsSummary,
    fetchMediaPreviewSummary,
    fetchOffFiles,
    fetchRawManifests,
    fetchScrubPreviewSummary,
    fetchStorageOverview,
    fetchStorageSettings,
  ]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    if (storageOverview?.scan?.status !== 'collecting') return undefined;
    const interval = setInterval(() => {
      fetchStorageOverview().catch(() => {});
    }, 2000);
    return () => clearInterval(interval);
  }, [fetchStorageOverview, storageOverview?.scan?.status]);

  const stats = useMemo(() => ({
    offTotal: offFiles.length,
    offMissing: offFiles.filter((file) => !file.exists).length,
    manifestTotal: manifests.length,
    manifestOrphans: manifests.filter((manifest) => manifest.orphan).length,
    feedbackTotal: feedbackItems.length,
    feedbackClosed: feedbackItems.filter((item) => ['fixed', 'rejected'].includes(item.status)).length,
    scrubReady: scrubPreviewSummary.withPreview || 0,
    scrubMissing: scrubPreviewSummary.missingPreview || 0,
  }), [feedbackItems, offFiles, manifests, scrubPreviewSummary]);

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

  const confirmBuildScrubPreviews = () => {
    const limit = Math.min(Math.max(Number(scrubPreviewLimit) || 10, 1), 50);

    setConfirmAction({
      title: 'Build missing preview slicice',
      body: `Generisati scrub preview frameove za do ${limit} klip(ova) kojima trenutno nedostaje preview?`,
      run: () =>
        axiosInstance
          .post('/admin/scrub-previews/build-missing', { limit })
          .then((response) => {
            setScrubPreviewResult(response.data?.result || null);
            if (response.data?.summary) {
              setScrubPreviewSummary((current) => ({ ...current, ...response.data.summary }));
            }
            return response.data?.message || 'Preview slicice su generisane.';
          }),
    });
  };

  const refreshScrubPreviewSummary = () => {
    setErrorMessage('');
    fetchScrubPreviewSummary()
      .catch((error) => {
        console.error('Error refreshing scrub preview summary:', error);
        setErrorMessage(error.response?.data?.message || 'Preview summary nije ucitan.');
      });
  };

  const confirmBuildHlsPreviews = (retryFailed = false) => {
    const limit = Math.min(Math.max(Number(hlsLimit) || 5, 1), 20);

    setConfirmAction({
      title: retryFailed ? 'Ponovi neuspjele HLS streamove' : 'Izgradi nedostajuće HLS streamove',
      body: `Poslati do ${limit} klipova u pozadinsku HLS obradu? Video ostaje dostupan preko MP4 fallbacka tokom obrade.`,
      run: () =>
        axiosInstance
          .post('/admin/hls-previews/build-missing', { limit, retryFailed })
          .then((response) => {
            setHlsResult(response.data?.result || null);
            if (response.data?.summary) setHlsSummary(response.data.summary);
            return response.data?.message || 'HLS obrada je pokrenuta.';
          }),
    });
  };

  const refreshHlsSummary = () => {
    setErrorMessage('');
    fetchHlsSummary().catch((error) => {
      console.error('Error refreshing HLS summary:', error);
      setErrorMessage(error.response?.data?.message || 'HLS pregled nije moguće učitati.');
    });
  };

  const runPreviewRetentionScan = () => {
    const limit = Math.min(Math.max(Number(previewRetentionLimit) || 50, 1), 500);
    setBusy(true);
    setErrorMessage('');
    setMessage('');
    axiosInstance
      .post('/admin/preview-retention/scan', { limit })
      .then((response) => {
        setPreviewRetentionScan(response.data?.result || null);
        setMessage(response.data?.message || 'Preview dry-run je završen.');
      })
      .catch((error) => {
        setErrorMessage(error.response?.data?.message || 'Preview dry-run nije uspio.');
      })
      .finally(() => setBusy(false));
  };

  const confirmPreviewRetentionCleanup = () => {
    const videoIds = (previewRetentionScan?.items || [])
      .filter((item) => item.eligible)
      .map((item) => item.videoId);
    if (videoIds.length === 0) return;
    setConfirmAction({
      title: 'Obriši redundantne MP4 previewe',
      body: `Ponovo provjeriti i obrisati do ${videoIds.length} sigurnih preview fajlova? Procijenjena ušteda je ${formatBytes(previewRetentionScan.reclaimableBytes)}. Master i HLS se ne brišu.`,
      run: () => axiosInstance
        .post('/admin/preview-retention/cleanup', { videoIds, limit: videoIds.length })
        .then((response) => {
          setPreviewRetentionScan(null);
          return response.data?.message || 'Preview cleanup je završen.';
        }),
    });
  };

  const refreshStorageScan = () => {
    setBusy(true);
    setMessage('');
    setErrorMessage('');
    axiosInstance
      .post('/admin/storage/overview/refresh')
      .then((response) => {
        setMessage(response.data?.message || 'Storage scan je pokrenut.');
        return fetchStorageOverview();
      })
      .catch((error) => {
        setErrorMessage(error.response?.data?.message || 'Storage scan nije moguće pokrenuti.');
      })
      .finally(() => setBusy(false));
  };

  const saveStorageThresholds = () => {
    setBusy(true);
    setMessage('');
    setErrorMessage('');
    axiosInstance
      .put('/admin/storage/settings', storageSettings)
      .then((response) => {
        setStorageSettings({
          warningFreePercent: Number(response.data?.settings?.warningFreePercent) || 20,
          criticalFreePercent: Number(response.data?.settings?.criticalFreePercent) || 10,
        });
        setMessage(response.data?.message || 'Storage pragovi su sačuvani.');
        return fetchStorageOverview();
      })
      .catch((error) => {
        setErrorMessage(error.response?.data?.message || 'Storage pragove nije moguće sačuvati.');
      })
      .finally(() => setBusy(false));
  };

  const toggleRebuildAsset = (assetType) => {
    setRebuildForm((current) => ({
      ...current,
      assetTypes: current.assetTypes.includes(assetType)
        ? current.assetTypes.filter((item) => item !== assetType)
        : [...current.assetTypes, assetType],
    }));
  };

  const confirmMediaRebuild = () => {
    const limit = Math.min(Math.max(Number(rebuildForm.limit) || 10, 1), 50);
    if (rebuildForm.assetTypes.length === 0) {
      setErrorMessage('Odaberi najmanje jedan preview tip.');
      return;
    }
    setConfirmAction({
      title: 'Pokrenuti media preview rebuild?',
      body: `U queue poslati do ${limit} ${rebuildForm.scope === 'missing' ? 'klipova bez previewa' : 'klipova sa zastarjelim previewom'} za: ${rebuildForm.assetTypes.join(', ')}? Postojeći validni asset ostaje dok nova verzija ne prođe validaciju.`,
      run: () => axiosInstance
        .post('/admin/media-previews/rebuild', {
          scope: rebuildForm.scope,
          limit,
          assetTypes: rebuildForm.assetTypes,
        })
        .then((response) => {
          setRebuildResult(response.data?.result || null);
          return response.data?.message || 'Preview rebuild je poslan u queue.';
        }),
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
            Storage i održavanje
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Kapacitet servera, media previewi i servisni fajlovi.
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
        <Grid item xs={6} md={3}>
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
            <Typography variant="overline" color="text.secondary">Preview ready</Typography>
            <Typography variant="h5" sx={{ fontWeight: 800 }}>{stats.scrubReady}</Typography>
          </Paper>
        </Grid>
        <Grid item xs={6} md={3}>
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
            <Typography variant="overline" color="text.secondary">Preview missing</Typography>
            <Typography variant="h5" sx={{ fontWeight: 800 }}>{stats.scrubMissing}</Typography>
          </Paper>
        </Grid>
      </Grid>

      <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
        <Tabs
          value={tab}
          onChange={(event, value) => setTab(value)}
          variant="scrollable"
          scrollButtons="auto"
          sx={{ px: 2, borderBottom: 1, borderColor: 'divider' }}
        >
          <Tab value="capacity" label="Kapacitet" />
          <Tab value="off" label="OFF audio" />
          <Tab value="manifests" label="Raw manifests" />
          <Tab value="previews" label="Preview slicice" />
          <Tab value="hls" label="HLS streaming" />
          <Tab value="rebuild" label="Media rebuild" />
          <Tab value="retention" label="MP4 preview cleanup" />
          <Tab value="feedback" label="Feedback/prijave" />
        </Tabs>

        {tab === 'capacity' && (
          <Box sx={{ p: 2 }}>
            {storageOverview?.scan?.status === 'collecting' && (
              <Alert severity="info" sx={{ mb: 2 }}>
                Detaljni storage scan radi u pozadini. Posljednji snapshot ostaje dostupan.
              </Alert>
            )}
            {(storageOverview?.volumes || []).map((volume) => {
              const usedPercent = volume.totalBytes > 0
                ? Math.min((Number(volume.usedBytes || 0) / Number(volume.totalBytes)) * 100, 100)
                : 0;
              const color = volume.status === 'critical' ? 'error' : volume.status === 'warning' ? 'warning' : 'success';
              return (
                <Box key={volume.id} sx={{ pb: 2, mb: 2, borderBottom: 1, borderColor: 'divider' }}>
                  <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={1} sx={{ mb: 1 }}>
                    <Box>
                      <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
                        Disk · {volume.role}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Slobodno {formatBytes(volume.freeBytes)} od {formatBytes(volume.totalBytes)}
                      </Typography>
                    </Box>
                    <Chip
                      label={`${Number(volume.freePercent || 0).toFixed(1)}% slobodno`}
                      color={color}
                      variant="outlined"
                    />
                  </Stack>
                  <LinearProgress variant="determinate" value={usedPercent} color={color} sx={{ height: 10, borderRadius: 1 }} />
                </Box>
              );
            })}

            <Grid container spacing={2} sx={{ mb: 2 }}>
              {[
                ['Media', storageOverview?.groups?.media],
                ['Operativno', storageOverview?.groups?.operational],
                ['Aplikacija', storageOverview?.groups?.application],
              ].map(([label, group]) => (
                <Grid item xs={12} md={4} key={label}>
                  <Box sx={{ p: 2, border: 1, borderColor: 'divider', borderRadius: 1 }}>
                    <Typography variant="overline" color="text.secondary">{label}</Typography>
                    <Typography variant="h5" sx={{ fontWeight: 800 }}>{formatBytes(group?.bytes || 0)}</Typography>
                    <Typography variant="caption" color="text.secondary">{Number(group?.fileCount || 0).toLocaleString()} fajlova</Typography>
                  </Box>
                </Grid>
              ))}
            </Grid>

            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ mb: 2 }}>
              <TextField
                label="Warning kada je slobodno ≤ %"
                type="number"
                size="small"
                value={storageSettings.warningFreePercent}
                onChange={(event) => setStorageSettings((current) => ({ ...current, warningFreePercent: Number(event.target.value) }))}
                inputProps={{ min: 2, max: 50 }}
              />
              <TextField
                label="Critical kada je slobodno ≤ %"
                type="number"
                size="small"
                value={storageSettings.criticalFreePercent}
                onChange={(event) => setStorageSettings((current) => ({ ...current, criticalFreePercent: Number(event.target.value) }))}
                inputProps={{ min: 1, max: 40 }}
              />
              <Button variant="outlined" onClick={saveStorageThresholds} disabled={busy}>Sačuvaj pragove</Button>
              <Button variant="contained" startIcon={<RefreshIcon />} onClick={refreshStorageScan} disabled={busy || storageOverview?.scan?.status === 'collecting'}>
                Novi scan
              </Button>
            </Stack>

            <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 1 }}>Raspodjela fajlova</Typography>
            <TableContainer sx={{ mb: 2 }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Kategorija</TableCell>
                    <TableCell>Grupa</TableCell>
                    <TableCell align="right">Fajlovi</TableCell>
                    <TableCell align="right">Veličina</TableCell>
                    <TableCell>Status</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(storageOverview?.categories || []).map((category) => (
                    <TableRow key={category.id} hover>
                      <TableCell>{category.label}</TableCell>
                      <TableCell>{category.group}</TableCell>
                      <TableCell align="right">{Number(category.fileCount || 0).toLocaleString()}</TableCell>
                      <TableCell align="right">{formatBytes(category.bytes)}</TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          label={(category.errors || []).length > 0 ? `${category.errors.length} greška` : 'U redu'}
                          color={(category.errors || []).length > 0 ? 'warning' : 'success'}
                          variant="outlined"
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>

            <Box sx={{ pt: 2, borderTop: 1, borderColor: 'divider' }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>MongoDB Atlas · odvojeni storage</Typography>
              {storageOverview?.database?.available ? (
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
                  <Chip label={`Data ${formatBytes(storageOverview.database.dataSize)}`} variant="outlined" />
                  <Chip label={`Storage ${formatBytes(storageOverview.database.storageSize)}`} variant="outlined" />
                  <Chip label={`Indexi ${formatBytes(storageOverview.database.indexSize)}`} variant="outlined" />
                  <Chip label={`Ukupno ${formatBytes(storageOverview.database.totalSize)}`} variant="outlined" />
                  <Chip label={`${Number(storageOverview.database.objects || 0).toLocaleString()} dokumenata`} variant="outlined" />
                </Stack>
              ) : (
                <Alert severity="warning" sx={{ mt: 1 }}>MongoDB statistika trenutno nije dostupna.</Alert>
              )}
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
                Snapshot: {formatDateTime(storageOverview?.generatedAt)}
              </Typography>
            </Box>
          </Box>
        )}

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

        {tab === 'previews' && (
          <Box sx={{ p: 2 }}>
            <Alert severity="info" sx={{ mb: 2 }}>
              Scrub preview koristi vise malih JPG slicica po klipu za brzi hover pregled bez pokretanja video playera.
            </Alert>

            <Grid container spacing={2} sx={{ mb: 2 }}>
              <Grid item xs={6} md={2}>
                <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 1 }}>
                  <Typography variant="caption" color="text.secondary">Scanned</Typography>
                  <Typography variant="h6" sx={{ fontWeight: 800 }}>{scrubPreviewSummary.scanned || 0}</Typography>
                </Paper>
              </Grid>
              <Grid item xs={6} md={2}>
                <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 1 }}>
                  <Typography variant="caption" color="text.secondary">Ready</Typography>
                  <Typography variant="h6" sx={{ fontWeight: 800 }}>{scrubPreviewSummary.withPreview || 0}</Typography>
                </Paper>
              </Grid>
              <Grid item xs={6} md={2}>
                <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 1 }}>
                  <Typography variant="caption" color="text.secondary">Missing</Typography>
                  <Typography variant="h6" sx={{ fontWeight: 800 }}>{scrubPreviewSummary.missingPreview || 0}</Typography>
                </Paper>
              </Grid>
              <Grid item xs={6} md={2}>
                <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 1 }}>
                  <Typography variant="caption" color="text.secondary">Errors</Typography>
                  <Typography variant="h6" sx={{ fontWeight: 800 }}>{scrubPreviewSummary.errored || 0}</Typography>
                </Paper>
              </Grid>
              <Grid item xs={6} md={2}>
                <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 1 }}>
                  <Typography variant="caption" color="text.secondary">No source</Typography>
                  <Typography variant="h6" sx={{ fontWeight: 800 }}>{scrubPreviewSummary.sourceMissing || 0}</Typography>
                </Paper>
              </Grid>
              <Grid item xs={6} md={2}>
                <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 1 }}>
                  <Typography variant="caption" color="text.secondary">Completed</Typography>
                  <Typography variant="h6" sx={{ fontWeight: 800 }}>{scrubPreviewSummary.totalCompleted || 0}</Typography>
                </Paper>
              </Grid>
            </Grid>

            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ xs: 'stretch', md: 'center' }} sx={{ mb: 2 }}>
              <TextField
                label="Batch limit"
                type="number"
                size="small"
                value={scrubPreviewLimit}
                onChange={(event) => setScrubPreviewLimit(event.target.value)}
                inputProps={{ min: 1, max: 50 }}
                sx={{ maxWidth: { md: 180 } }}
              />
              <Button
                variant="contained"
                startIcon={<CleaningServicesIcon />}
                onClick={confirmBuildScrubPreviews}
                disabled={busy || loading || (scrubPreviewSummary.totalCompleted || 0) === 0}
              >
                Build missing
              </Button>
              <Button variant="outlined" startIcon={<RefreshIcon />} onClick={refreshScrubPreviewSummary} disabled={loading}>
                Refresh summary
              </Button>
            </Stack>

            {scrubPreviewSummary.scanned < scrubPreviewSummary.totalCompleted && (
              <Alert severity="warning" sx={{ mb: 2 }}>
                Summary je skenirao {scrubPreviewSummary.scanned} od {scrubPreviewSummary.totalCompleted} zavrsenih klipova radi performansi.
              </Alert>
            )}

            {scrubPreviewResult && (
              <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1.5, p: 2 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 1 }}>
                  Zadnji batch
                </Typography>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1.5 }}>
                  <Chip label={`Built: ${scrubPreviewResult.built?.length || 0}`} color="success" size="small" />
                  <Chip label={`Skipped: ${(scrubPreviewResult.skipped?.length || 0) + (scrubPreviewResult.skippedExisting || 0)}`} size="small" />
                  <Chip label={`Failed: ${scrubPreviewResult.failed?.length || 0}`} color="error" size="small" />
                  <Chip label={`Scanned: ${scrubPreviewResult.scanned || 0}`} variant="outlined" size="small" />
                </Stack>
                {(scrubPreviewResult.failed || []).length > 0 && (
                  <Alert severity="error" sx={{ mb: 1 }}>
                    Dio previewa nije generisan. Provjeri source fajlove ili audit log.
                  </Alert>
                )}
                {(scrubPreviewResult.built || []).slice(0, 5).map((item) => (
                  <Typography key={item.videoId} variant="caption" display="block" color="text.secondary">
                    Built: {item.filename || item.videoId} ({item.frameCount || 0} frameova)
                  </Typography>
                ))}
              </Box>
            )}
          </Box>
        )}

        {tab === 'hls' && (
          <Box sx={{ p: 2 }}>
            <Alert severity="info" sx={{ mb: 2 }}>
              HLS priprema 720p i 480p segmente za brži početak reprodukcije i prilagodbu mreži.
              Obrada je pozadinska; MP4 Range streaming ostaje fallback.
            </Alert>

            <Grid container spacing={2} sx={{ mb: 2 }}>
              {[
                ['Spremno', hlsSummary.ready, 'success.main'],
                ['Nedostaje', hlsSummary.missing, 'text.primary'],
                ['U redu čekanja', hlsSummary.queued, 'info.main'],
                ['Obrada', hlsSummary.processing, 'warning.main'],
                ['Greška', hlsSummary.failed, 'error.main'],
                ['Prostor', formatBytes(hlsSummary.totalBytes), 'text.primary'],
              ].map(([label, value, color]) => (
                <Grid item xs={6} md={2} key={label}>
                  <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 1 }}>
                    <Typography variant="caption" color="text.secondary">{label}</Typography>
                    <Typography variant="h6" sx={{ fontWeight: 800, color }}>{value || 0}</Typography>
                  </Paper>
                </Grid>
              ))}
            </Grid>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
              <Chip label={`NVENC: ${hlsSummary.nvencReady || 0}`} color="success" variant="outlined" />
              <Chip label={`CPU: ${hlsSummary.cpuReady || 0}`} variant="outlined" />
              <Chip label={`CPU fallback: ${hlsSummary.cpuFallbacks || 0}`} color="warning" variant="outlined" />
              <Chip label={`Rebuild greške: ${hlsSummary.rebuildFailed || 0}`} color="error" variant="outlined" />
              <Chip label={`Prosjek: ${Math.round((hlsSummary.averageProcessingMs || 0) / 1000)}s`} variant="outlined" />
            </Stack>

            <Stack
              direction={{ xs: 'column', md: 'row' }}
              spacing={1.5}
              alignItems={{ xs: 'stretch', md: 'center' }}
              sx={{ mb: 2 }}
            >
              <TextField
                label="Batch limit"
                type="number"
                size="small"
                value={hlsLimit}
                onChange={(event) => setHlsLimit(event.target.value)}
                inputProps={{ min: 1, max: 20 }}
                sx={{ maxWidth: { md: 180 } }}
              />
              <Button
                variant="contained"
                startIcon={<CleaningServicesIcon />}
                onClick={() => confirmBuildHlsPreviews(false)}
                disabled={busy || loading || hlsSummary.missing === 0}
              >
                Izgradi nedostajuće
              </Button>
              <Button
                variant="outlined"
                color="warning"
                onClick={() => confirmBuildHlsPreviews(true)}
                disabled={busy || loading || (hlsSummary.failed || 0) + (hlsSummary.rebuildFailed || 0) === 0}
              >
                Ponovi greške
              </Button>
              <Button variant="outlined" startIcon={<RefreshIcon />} onClick={refreshHlsSummary} disabled={loading}>
                Osvježi pregled
              </Button>
            </Stack>

            {(hlsSummary.queued > 0 || hlsSummary.processing > 0) && (
              <Alert severity="warning" sx={{ mb: 2 }}>
                Pozadinska obrada je aktivna. Osvježi pregled nakon nekoliko minuta; trajanje zavisi od dužine klipova i CPU-a.
              </Alert>
            )}
            {hlsSummary.sourceMissing > 0 && (
              <Alert severity="warning" sx={{ mb: 2 }}>
                {hlsSummary.sourceMissing} klipova nema dostupan izvorni/preview fajl i ne može dobiti HLS stream.
              </Alert>
            )}
            {hlsResult && (
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                <Chip label={`Poslano: ${hlsResult.queued?.length || 0}`} color="success" />
                <Chip label={`Preskočeno: ${hlsResult.skipped?.length || 0}`} variant="outlined" />
              </Stack>
            )}
          </Box>
        )}

        {tab === 'rebuild' && (
          <Box sx={{ p: 2 }}>
            <Alert severity="info" sx={{ mb: 2 }}>
              Rebuild je ručna background akcija. Stari validni preview ostaje aktivan dok nova verzija ne prođe validaciju.
            </Alert>
            <Grid container spacing={2} sx={{ mb: 2 }}>
              {['mp4', 'hls', 'thumbnail', 'scrub'].map((assetType) => {
                const data = mediaPreviewSummary?.assets?.[assetType] || {};
                return (
                  <Grid item xs={12} sm={6} md={3} key={assetType}>
                    <Box sx={{ p: 2, border: 1, borderColor: 'divider', borderRadius: 1 }}>
                      <Stack direction="row" justifyContent="space-between" alignItems="center">
                        <Typography sx={{ fontWeight: 800, textTransform: 'uppercase' }}>{assetType}</Typography>
                        <Chip label={`v${mediaPreviewSummary?.profileVersions?.[assetType] || 1}`} size="small" />
                      </Stack>
                      <Typography variant="body2" color="success.main">Spremno: {data.ready || 0}</Typography>
                      <Typography variant="body2" color="warning.main">Zastarjelo: {data.outdated || 0}</Typography>
                      <Typography variant="body2">Nedostaje: {data.missing || 0}</Typography>
                      <Typography variant="body2" color="error.main">Greška: {data.failed || 0}</Typography>
                    </Box>
                  </Grid>
                );
              })}
            </Grid>

            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
              <Chip label={`Queue: ${mediaPreviewSummary?.queued || 0}`} variant="outlined" />
              <Chip label={`Obrada: ${mediaPreviewSummary?.processing || 0}`} color="warning" variant="outlined" />
              <Chip label={`Skenirano: ${mediaPreviewSummary?.scanned || 0}`} variant="outlined" />
            </Stack>

            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'center' }} sx={{ mb: 2 }}>
              <FormControl size="small" sx={{ minWidth: 180 }}>
                <InputLabel>Rebuild režim</InputLabel>
                <Select
                  value={rebuildForm.scope}
                  label="Rebuild režim"
                  onChange={(event) => setRebuildForm((current) => ({ ...current, scope: event.target.value }))}
                >
                  <MenuItem value="outdated">Zastarjeli</MenuItem>
                  <MenuItem value="missing">Nedostajući</MenuItem>
                </Select>
              </FormControl>
              <TextField
                size="small"
                type="number"
                label="Batch limit"
                value={rebuildForm.limit}
                onChange={(event) => setRebuildForm((current) => ({ ...current, limit: Number(event.target.value) }))}
                inputProps={{ min: 1, max: 50 }}
                sx={{ width: 150 }}
              />
              <Button variant="contained" onClick={confirmMediaRebuild} disabled={busy || rebuildForm.assetTypes.length === 0}>
                Pokreni rebuild
              </Button>
              <Button variant="outlined" startIcon={<RefreshIcon />} onClick={fetchMediaPreviewSummary} disabled={loading}>
                Osvježi
              </Button>
            </Stack>

            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
              {[
                ['mp4', 'MP4 preview'],
                ['hls', 'HLS'],
                ['thumbnail', 'Thumbnail'],
                ['scrub', 'Scrub'],
              ].map(([value, label]) => (
                <FormControlLabel
                  key={value}
                  control={(
                    <Checkbox
                      checked={rebuildForm.assetTypes.includes(value)}
                      onChange={() => toggleRebuildAsset(value)}
                    />
                  )}
                  label={label}
                />
              ))}
            </Stack>

            {rebuildResult && (
              <Alert severity="success">
                Poslano: {rebuildResult.queued?.length || 0}; preskočeno: {rebuildResult.skipped?.length || 0}.
              </Alert>
            )}
          </Box>
        )}

        {tab === 'retention' && (
          <Box sx={{ p: 2 }}>
            <Alert severity="info" sx={{ mb: 2 }}>
              Dry-run koristi FFprobe i ne mijenja disk. Kandidat mora imati ispravan HLS i zaseban browser-kompatibilan H.264 MP4 master.
            </Alert>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ mb: 2 }}>
              <TextField
                label="Scan limit"
                type="number"
                size="small"
                value={previewRetentionLimit}
                onChange={(event) => setPreviewRetentionLimit(event.target.value)}
                inputProps={{ min: 1, max: 500 }}
                sx={{ maxWidth: { md: 180 } }}
              />
              <Button variant="contained" onClick={runPreviewRetentionScan} disabled={busy}>
                Pokreni dry-run
              </Button>
              <Button
                variant="outlined"
                color="error"
                startIcon={<DeleteIcon />}
                onClick={confirmPreviewRetentionCleanup}
                disabled={busy || !previewRetentionScan?.eligibleCount}
              >
                Očisti potvrđene kandidate
              </Button>
            </Stack>

            {previewRetentionScan && (
              <>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
                  <Chip label={`Skenirano: ${previewRetentionScan.scanned || 0}`} />
                  <Chip label={`Sigurno: ${previewRetentionScan.eligibleCount || 0}`} color="success" />
                  <Chip label={`Zadržati: ${previewRetentionScan.ineligibleCount || 0}`} color="warning" />
                  <Chip label={`Ušteda: ${formatBytes(previewRetentionScan.reclaimableBytes)}`} variant="outlined" />
                </Stack>
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Video</TableCell>
                        <TableCell>Odluka</TableCell>
                        <TableCell>Razlog</TableCell>
                        <TableCell>Veličina</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {(previewRetentionScan.items || []).map((item) => (
                        <TableRow key={item.videoId}>
                          <TableCell>{item.title}</TableCell>
                          <TableCell>
                            <Chip
                              label={item.eligible ? 'Može se obrisati' : 'Zadržati'}
                              color={item.eligible ? 'success' : 'warning'}
                              size="small"
                            />
                          </TableCell>
                          <TableCell>{item.reason}</TableCell>
                          <TableCell>{formatBytes(item.size)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </>
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
