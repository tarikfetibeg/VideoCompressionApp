import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Collapse,
  IconButton,
  LinearProgress,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import DownloadIcon from '@mui/icons-material/Download';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import PauseIcon from '@mui/icons-material/Pause';
import ReplayIcon from '@mui/icons-material/Replay';
import axios from '../axiosConfig';
import { UserContext } from './UserContext';
import {
  cancelNativeDownload,
  isDesktopRuntime,
  listenForNativeTransferProgress,
  startNativeDownload,
} from '../desktop/runtime';
import {
  loadRecoverableDownloads,
  persistDownloads,
  pruneFinishedDownloads,
} from '../desktop/transferStore';
import { DownloadUrlError, resolveHttpDownloadUrl } from '../utils/downloadUrls';
import {
  calculateTransferMetrics,
  formatEta,
  formatProgressPercent,
  formatTransferRate,
  getTransferSizeLabel,
} from '../utils/downloadProgress';

const BackgroundDownloadContext = createContext(/** @type {any} */ (null));

const createDownloadId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const terminalStatuses = new Set(['completed', 'aborted', 'failed', 'expired', 'cancelled']);
const blockingStatuses = new Set(['creating_ticket', 'opening']);
const activeStatuses = new Set(['creating_ticket', 'opening', 'streaming', 'transferring', 'verifying']);

const statusLabels = {
  creating_ticket: 'Priprema linka',
  opening: 'Povezivanje',
  streaming: 'Skidanje',
  transferring: 'Skidanje',
  verifying: 'Provjera integriteta',
  paused: 'Pauzirano',
  completed: 'Završeno',
  aborted: 'Prekinuto',
  failed: 'Greška',
  expired: 'Isteklo',
};

const statusSeverity = {
  completed: 'success',
  failed: 'error',
  aborted: 'warning',
  expired: 'warning',
};

const delay = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

const getNetworkMessage = (error) => {
  if (error instanceof DownloadUrlError) return error.message;
  if (error.response?.data?.message) return error.response.data.message;

  if (error.code === 'ECONNABORTED') {
    return 'Download priprema je istekla. Provjeri mrezu i pokusaj ponovo.';
  }

  if (!error.response) {
    return 'Nema odgovora servera. Provjeri mrezu, CORS i da li koristis backend URL na portu 5000.';
  }

  return 'Download se ne moze pokrenuti.';
};

const DownloadProgressDetails = ({ download, compact = false }) => {
  const hasKnownTotal = Number(download.totalBytes) > 0;
  const isTransferring = ['streaming', 'transferring'].includes(download.status);
  const showProgress = isTransferring || download.status === 'verifying';

  return (
    <Stack spacing={compact ? 0.4 : 0.75} sx={{ mt: compact ? 0.5 : 1 }}>
      {showProgress && (
        <LinearProgress
          variant={hasKnownTotal ? 'determinate' : 'indeterminate'}
          value={hasKnownTotal ? Number(download.progress || 0) : undefined}
          color={download.status === 'verifying' ? 'success' : 'primary'}
          sx={{ height: compact ? 4 : 7, borderRadius: 1 }}
        />
      )}
      <Stack direction="row" spacing={1.25} flexWrap="wrap" useFlexGap alignItems="center">
        {(Number(download.transferredBytes) > 0 || hasKnownTotal) && (
          <Typography variant="caption" sx={{ fontWeight: 750 }}>
            {getTransferSizeLabel(download)}
          </Typography>
        )}
        {isTransferring && (
          <Typography variant="caption" color="text.secondary">
            {formatTransferRate(download.speedBytesPerSecond)}
          </Typography>
        )}
        {isTransferring && hasKnownTotal && download.etaSeconds != null && (
          <Typography variant="caption" color="text.secondary">
            Preostalo {formatEta(download.etaSeconds)}
          </Typography>
        )}
      </Stack>
    </Stack>
  );
};

export const BackgroundDownloadProvider = ({ children }) => {
  const { user } = useContext(UserContext) || {};
  const [downloads, setDownloads] = useState(/** @type {any[]} */ ([]));
  const [panelOpen, setPanelOpen] = useState(true);
  const pollingRef = useRef(new Map());
  const handoffFramesRef = useRef(new Set());
  const persistenceTimerRef = useRef(null);
  const restoredUserRef = useRef('');
  const transferSamplesRef = useRef(new Map());

  const activeDownloads = useMemo(
    () => downloads.filter((download) => activeStatuses.has(download.status)),
    [downloads]
  );
  const failedDownloads = useMemo(
    () => downloads.filter((download) => ['failed', 'aborted', 'expired'].includes(download.status)),
    [downloads]
  );
  const completedDownloads = useMemo(
    () => downloads.filter((download) => download.status === 'completed'),
    [downloads]
  );
  const hasBlockingDownloads = useMemo(
    () => downloads.some((download) => blockingStatuses.has(download.status)),
    [downloads]
  );
  const currentDownload = activeDownloads[0] || null;
  const downloadSummary = useMemo(() => {
    const knownDownloads = activeDownloads.filter((download) => Number(download.totalBytes) > 0);
    const totalBytes = knownDownloads.reduce((sum, download) => sum + Number(download.totalBytes || 0), 0);
    const transferredBytes = knownDownloads.reduce(
      (sum, download) => sum + Math.min(Number(download.transferredBytes || 0), Number(download.totalBytes || 0)),
      0
    );
    return {
      activeCount: activeDownloads.length,
      transferredBytes: activeDownloads.reduce((sum, download) => sum + Number(download.transferredBytes || 0), 0),
      totalBytes,
      speedBytesPerSecond: activeDownloads.reduce(
        (sum, download) => sum + Number(download.speedBytesPerSecond || 0),
        0
      ),
      progress: activeDownloads.length > 0 && knownDownloads.length === activeDownloads.length && totalBytes > 0
        ? Math.min(100, (transferredBytes / totalBytes) * 100)
        : null,
    };
  }, [activeDownloads]);

  useEffect(() => {
    if (!hasBlockingDownloads) return undefined;

    const handleBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = '';
      return '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasBlockingDownloads]);

  useEffect(() => () => {
    pollingRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
    pollingRef.current.clear();
    handoffFramesRef.current.forEach((frame) => frame.remove());
    handoffFramesRef.current.clear();
    transferSamplesRef.current.clear();
    if (persistenceTimerRef.current) window.clearTimeout(persistenceTimerRef.current);
  }, []);

  const updateDownload = useCallback((downloadId, patch) => {
    setDownloads((current) =>
      current.map((download) =>
        download.id === downloadId ? { ...download, ...patch, updatedAt: new Date().toISOString() } : download
      )
    );
  }, []);

  useEffect(() => {
    if (!isDesktopRuntime()) return undefined;
    let active = true;
    let unlisten = () => {};
    listenForNativeTransferProgress((progress) => {
      if (!active) return;
      const now = Date.now();
      const metrics = calculateTransferMetrics(
        transferSamplesRef.current.get(progress.id),
        progress,
        now
      );
      if (['completed', 'failed', 'paused', 'aborted'].includes(progress.status)) {
        transferSamplesRef.current.delete(progress.id);
      } else {
        transferSamplesRef.current.set(progress.id, metrics.sample);
      }
      updateDownload(progress.id, {
        status: progress.status === 'transferring' ? 'streaming' : progress.status,
        transferredBytes: metrics.transferredBytes,
        totalBytes: metrics.totalBytes,
        targetPath: progress.path || '',
        progress: metrics.progressPercent,
        speedBytesPerSecond: ['transferring', 'streaming'].includes(progress.status)
          ? metrics.speedBytesPerSecond
          : 0,
        etaSeconds: ['transferring', 'streaming'].includes(progress.status)
          ? metrics.etaSeconds
          : null,
        transferStartedAt: new Date(metrics.sample.startedAt).toISOString(),
        lastProgressAt: new Date(now).toISOString(),
        error: progress.error || '',
        message: progress.status === 'completed'
          ? `Fajl je sačuvan u ${progress.path}`
          : progress.status === 'paused'
            ? 'Skidanje je pauzirano i može se nastaviti.'
            : progress.status === 'verifying'
              ? 'Provjeravam SHA-256 integritet fajla...'
              : metrics.totalBytes > 0
                ? 'Desktop aplikacija skida fajl u pozadini.'
                : 'Server priprema i šalje paket; ukupna veličina još nije poznata.',
      });
    }).then((cleanup) => {
      if (active) unlisten = cleanup;
      else cleanup();
    });
    return () => {
      active = false;
      unlisten();
    };
  }, [updateDownload]);

  useEffect(() => {
    if (!isDesktopRuntime() || !user || downloads.length === 0) return undefined;
    if (persistenceTimerRef.current) window.clearTimeout(persistenceTimerRef.current);
    const userId = String(user.id || user._id || '');
    persistenceTimerRef.current = window.setTimeout(() => {
      persistDownloads(downloads.map((download) => ({
        ...download,
        userId,
      }))).then(() => pruneFinishedDownloads(userId)).catch((error) => {
        console.error('Desktop download queue could not be persisted:', error);
      });
    }, 350);
    return () => {
      if (persistenceTimerRef.current) window.clearTimeout(persistenceTimerRef.current);
    };
  }, [downloads, user]);

  const clearPoller = useCallback((downloadId) => {
    const timeoutId = pollingRef.current.get(downloadId);
    if (timeoutId) {
      window.clearTimeout(timeoutId);
      pollingRef.current.delete(downloadId);
    }
  }, []);

  const handoffToBrowser = useCallback((downloadUrl) => {
    const frame = document.createElement('iframe');
    frame.style.display = 'none';
    frame.setAttribute('aria-hidden', 'true');
    frame.src = downloadUrl;
    document.body.appendChild(frame);
    handoffFramesRef.current.add(frame);

    window.setTimeout(() => {
      frame.remove();
      handoffFramesRef.current.delete(frame);
    }, 60 * 1000);
  }, []);

  const handoffToDesktop = useCallback((download, downloadUrl) => {
    startNativeDownload({
      id: download.id,
      url: downloadUrl,
      label: download.label,
      targetPath: download.targetPath || undefined,
      expectedSha256: download.expectedSha256 || undefined,
    }).catch((error) => {
      const paused = String(error || '').includes('pauziran');
      updateDownload(download.id, {
        status: paused ? 'paused' : 'failed',
        error: paused ? '' : String(error || 'Native download nije uspio.'),
        message: paused ? 'Skidanje je pauzirano i djelimični fajl je sačuvan.' : 'Desktop download nije uspio.',
      });
    });
  }, [updateDownload]);

  const pollStatus = useCallback((downloadId, ticketId) => {
    clearPoller(downloadId);

    const run = async () => {
      try {
        const response = await axios.get(`/downloads/tickets/${ticketId}/status`);
        const status = response.data?.status || 'streaming';
        const serverError = response.data?.error || '';

        updateDownload(downloadId, {
          status,
          serverStatus: status,
          message: terminalStatuses.has(status)
            ? serverError || (status === 'completed' ? 'Server je zavrsio slanje fajla.' : statusLabels[status])
            : 'Browser download manager preuzima fizicko skidanje.',
          error: ['failed', 'aborted', 'expired'].includes(status) ? serverError : '',
          startedAt: response.data?.startedAt,
          finishedAt: response.data?.finishedAt,
        });

        if (terminalStatuses.has(status)) {
          clearPoller(downloadId);
          return;
        }
      } catch (error) {
        updateDownload(downloadId, {
          status: 'failed',
          error: getNetworkMessage(error),
          message: getNetworkMessage(error),
        });
        clearPoller(downloadId);
        return;
      }

      const timeoutId = window.setTimeout(run, 2000);
      pollingRef.current.set(downloadId, timeoutId);
    };

    const timeoutId = window.setTimeout(run, 1200);
    pollingRef.current.set(downloadId, timeoutId);
  }, [clearPoller, updateDownload]);

  const createTicketAndOpen = useCallback(async (download) => {
    transferSamplesRef.current.delete(download.id);
    updateDownload(download.id, {
      status: 'creating_ticket',
      message: 'Pripremam siguran download link...',
      error: '',
      speedBytesPerSecond: 0,
      etaSeconds: null,
    });
    setPanelOpen(true);

    try {
      const response = await axios.post('/downloads/tickets', {
        kind: download.kind,
        payload: download.payload,
      });
      const desktopRuntime = isDesktopRuntime();
      const downloadUrl = resolveHttpDownloadUrl(response.data?.downloadUrl, {
        apiBaseUrl: axios.defaults.baseURL || '/api',
        runtimeOrigin: window.location.origin,
        desktopRuntime,
      });

      updateDownload(download.id, {
        ticketId: response.data?.ticketId,
        downloadUrl,
        expiresAt: response.data?.expiresAt,
        status: 'opening',
        message: desktopRuntime
          ? 'Povezujem desktop downloader sa serverom...'
          : 'Otvaram browser download manager...',
      });

      await delay(100);
      if (desktopRuntime) {
        handoffToDesktop(download, downloadUrl);
      } else {
        handoffToBrowser(downloadUrl);
      }

      updateDownload(download.id, {
        status: 'streaming',
        message: desktopRuntime
          ? 'Desktop aplikacija skida fajl u pozadini. Možeš nastaviti raditi.'
          : 'Download je predan browseru. Možeš nastaviti koristiti aplikaciju.',
      });

      if (!desktopRuntime && response.data?.ticketId) {
        pollStatus(download.id, response.data.ticketId);
      }

      return response.data;
    } catch (error) {
      console.error('Background download failed:', error);
      const message = getNetworkMessage(error);
      updateDownload(download.id, {
        status: 'failed',
        error: message,
        message,
      });
      throw error;
    }
  }, [handoffToBrowser, handoffToDesktop, pollStatus, updateDownload]);

  useEffect(() => {
    if (!isDesktopRuntime() || !user) return undefined;
    const userId = String(user.id || user._id || '');
    if (!userId || restoredUserRef.current === userId) return undefined;
    restoredUserRef.current = userId;
    let cancelled = false;

    loadRecoverableDownloads(userId).then((records) => {
      if (cancelled || records.length === 0) return;
      const restored = records.map((record) => ({
        ...record,
        message: 'Transfer je vraćen iz lokalnog reda i nastavlja se.',
        error: '',
      }));
      setDownloads((current) => [...restored, ...current.filter((item) => !restored.some((saved) => saved.id === item.id))].slice(0, 20));
      window.setTimeout(() => restored.forEach((download) => createTicketAndOpen(download).catch(() => {})), 0);
    }).catch((error) => console.error('Desktop download queue could not be restored:', error));

    return () => {
      cancelled = true;
    };
  }, [createTicketAndOpen, user]);

  const startDownload = useCallback((descriptor) => {
    const download = {
      id: createDownloadId(),
      kind: descriptor.kind,
      payload: descriptor.payload || {},
      label: descriptor.label || 'Download',
      status: 'creating_ticket',
      message: 'Pripremam download...',
      error: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ticketId: '',
      downloadUrl: '',
      expiresAt: null,
      targetPath: descriptor.targetPath || '',
      transferredBytes: 0,
      totalBytes: 0,
      progress: null,
      speedBytesPerSecond: 0,
      etaSeconds: null,
    };

    setDownloads((current) => [download, ...current].slice(0, 12));
    setPanelOpen(true);
    return createTicketAndOpen(download);
  }, [createTicketAndOpen]);

  const retryDownload = useCallback((downloadId) => {
    const download = downloads.find((item) => item.id === downloadId);
    if (!download) return Promise.resolve(null);

    clearPoller(downloadId);
    return createTicketAndOpen({
      ...download,
      ticketId: '',
      downloadUrl: '',
      expiresAt: null,
      transferredBytes: 0,
      totalBytes: 0,
      progress: null,
      speedBytesPerSecond: 0,
      etaSeconds: null,
    });
  }, [clearPoller, createTicketAndOpen, downloads]);

  const pauseDownload = useCallback(async (downloadId) => {
    await cancelNativeDownload(downloadId);
    updateDownload(downloadId, {
      status: 'paused',
      message: 'Pauziram nakon trenutnog bloka podataka...',
    });
  }, [updateDownload]);

  const clearFinishedDownloads = useCallback(() => {
    setDownloads((current) => current.filter(
      (download) => activeStatuses.has(download.status) || download.status === 'paused'
    ));
  }, []);

  const openDownloadPanel = useCallback(() => setPanelOpen(true), []);

  const value = useMemo(
    () => ({
      downloads,
      activeDownloads,
      failedDownloads,
      completedDownloads,
      hasBlockingDownloads,
      currentDownload,
      downloadSummary,
      startDownload,
      retryDownload,
      pauseDownload,
      openDownloadPanel,
      clearFinishedDownloads,
    }),
    [
      downloads,
      activeDownloads,
      failedDownloads,
      completedDownloads,
      hasBlockingDownloads,
      currentDownload,
      downloadSummary,
      startDownload,
      retryDownload,
      pauseDownload,
      openDownloadPanel,
      clearFinishedDownloads,
    ]
  );

  return (
    <BackgroundDownloadContext.Provider value={value}>
      {children}
      {downloads.length > 0 && (
        <Box
          sx={{
            position: 'fixed',
            right: { xs: 12, md: 24 },
            bottom: { xs: 12, md: 24 },
            width: { xs: 'calc(100% - 24px)', sm: 480 },
            zIndex: 1500,
          }}
        >
          <Collapse in={panelOpen}>
            <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2, boxShadow: 4 }}>
              <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
                <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
                  <DownloadIcon color={activeDownloads.length > 0 ? 'primary' : 'action'} />
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 850 }}>
                      Download manager
                    </Typography>
                    <Typography variant="caption" color="text.secondary" noWrap>
                      {activeDownloads.length > 0
                        ? isDesktopRuntime()
                          ? 'Desktop aplikacija skida i čuva transfer u lokalnom redu.'
                          : 'Aplikacija priprema i prati download; browser skida fajl.'
                        : 'Download lista je mirna.'}
                    </Typography>
                  </Box>
                </Stack>
                <IconButton size="small" onClick={() => setPanelOpen(false)} disabled={hasBlockingDownloads}>
                  <CloseIcon fontSize="small" />
                </IconButton>
              </Stack>

              <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
                <Chip label={`${activeDownloads.length} aktivno`} size="small" color={activeDownloads.length > 0 ? 'primary' : 'default'} />
                {downloadSummary.speedBytesPerSecond > 0 && (
                  <Chip label={formatTransferRate(downloadSummary.speedBytesPerSecond)} size="small" variant="outlined" />
                )}
                <Chip label={`${completedDownloads.length} završeno`} size="small" color="success" variant="outlined" />
                {failedDownloads.length > 0 && (
                  <Chip label={`${failedDownloads.length} problem`} size="small" color="error" variant="outlined" />
                )}
              </Stack>

              {currentDownload && (
                <Box
                  sx={{
                    mt: 1.25,
                    py: 1.25,
                    borderTop: 1,
                    borderBottom: 1,
                    borderColor: 'divider',
                  }}
                >
                  <Stack direction="row" spacing={1} alignItems="flex-start">
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      <Typography variant="body2" sx={{ fontWeight: 850 }} noWrap title={currentDownload.label}>
                        {currentDownload.label}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {statusLabels[currentDownload.status] || currentDownload.status}: {currentDownload.message}
                      </Typography>
                    </Box>
                    {currentDownload.progress != null && (
                      <Typography variant="body2" color="primary.main" sx={{ fontWeight: 900, flexShrink: 0 }}>
                        {formatProgressPercent(currentDownload.progress)}
                      </Typography>
                    )}
                    {isDesktopRuntime() && activeStatuses.has(currentDownload.status) && (
                      <IconButton
                        size="small"
                        onClick={() => pauseDownload(currentDownload.id)}
                        title="Pauziraj download"
                        aria-label="Pauziraj download"
                      >
                        <PauseIcon fontSize="small" />
                      </IconButton>
                    )}
                  </Stack>
                  <DownloadProgressDetails download={currentDownload} />
                </Box>
              )}

              <Stack spacing={0.75} sx={{ mt: 1 }}>
                {downloads
                  .filter((download) => download.id !== currentDownload?.id)
                  .slice(0, currentDownload ? 3 : 4)
                  .map((download) => (
                  <Alert
                    key={download.id}
                    severity={statusSeverity[download.status] || 'info'}
                    action={
                      ['failed', 'aborted', 'expired', 'paused'].includes(download.status) ? (
                        <Button
                          color="inherit"
                          size="small"
                          startIcon={<ReplayIcon />}
                          onClick={() => retryDownload(download.id)}
                        >
                          Ponovi
                        </Button>
                      ) : isDesktopRuntime() && activeStatuses.has(download.status) ? (
                        <IconButton color="inherit" size="small" onClick={() => pauseDownload(download.id)} title="Pauziraj download">
                          <PauseIcon fontSize="small" />
                        </IconButton>
                      ) : download.downloadUrl ? (
                        <IconButton
                          color="inherit"
                          size="small"
                          onClick={() => handoffToBrowser(download.downloadUrl)}
                          title="Ponovo otvori browser download"
                        >
                          <OpenInNewIcon fontSize="small" />
                        </IconButton>
                      ) : null
                    }
                  >
                    <Typography variant="body2" sx={{ fontWeight: 750 }}>
                      {download.label}
                    </Typography>
                    <Typography variant="caption" component="div">
                      {statusLabels[download.status] || download.status}
                      {download.error ? ` - ${download.error}` : download.message ? ` - ${download.message}` : ''}
                    </Typography>
                    <DownloadProgressDetails download={download} compact />
                  </Alert>
                ))}
              </Stack>

              {!hasBlockingDownloads && downloads.length > 0 && (
                <Button size="small" sx={{ mt: 1 }} onClick={clearFinishedDownloads}>
                  Ocisti zavrsene
                </Button>
              )}
            </Paper>
          </Collapse>
        </Box>
      )}
    </BackgroundDownloadContext.Provider>
  );
};

export const useBackgroundDownloads = () => {
  const context = useContext(BackgroundDownloadContext);
  if (!context) {
    throw new Error('useBackgroundDownloads must be used inside BackgroundDownloadProvider');
  }
  return context;
};
