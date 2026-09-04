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
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import ReplayIcon from '@mui/icons-material/Replay';
import PauseIcon from '@mui/icons-material/Pause';
import axios from '../axiosConfig';
import { UserContext } from './UserContext';
import { isDesktopRuntime } from '../desktop/runtime';
import { uploadDirectFinalResumable } from '../services/resumableUploadClient';
import {
  loadRecoverableUploads,
  persistUploads,
  pruneFinishedUploads,
} from '../desktop/transferStore';

const BackgroundUploadContext = createContext(/** @type {any} */ (null));

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

const createUploadId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const formatBytes = (value) => {
  const bytes = Number(value) || 0;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
};

const sortFilesNaturally = (files) =>
  [...files].sort((a, b) => collator.compare(a.name || '', b.name || ''));

const buildDirectFinalFormData = (job) => {
  const formData = new FormData();
  const metadata = job.metadata || {};

  formData.append('finalVideos', job.file, job.file.name);
  formData.append('programId', metadata.programId || 'ingest');
  formData.append('contentTypeId', metadata.contentTypeId || '');
  formData.append('airDate', metadata.airDate || '');
  formData.append('finalTitle', metadata.finalTitle || '');
  formData.append('reporterId', metadata.reporterId || '');
  formData.append('keywords', metadata.keywords || '');
  formData.append('notes', metadata.notes || '');
  formData.append('useFilenameMetadata', metadata.useFilenameMetadata ? 'true' : 'false');
  formData.append('bulkUpload', metadata.bulkUpload ? 'true' : 'false');

  return formData;
};

export const BackgroundUploadProvider = ({ children }) => {
  const { user } = useContext(UserContext);
  const [uploads, setUploads] = useState([]);
  const [panelOpen, setPanelOpen] = useState(true);
  const uploadingRef = useRef(false);
  const abortControllerRef = useRef(null);
  const restoredUserRef = useRef('');

  const activeUploads = useMemo(
    () => uploads.filter((upload) => ['pending', 'preparing', 'uploading', 'verifying'].includes(upload.status)),
    [uploads]
  );
  const failedUploads = useMemo(
    () => uploads.filter((upload) => upload.status === 'error'),
    [uploads]
  );
  const completedUploads = useMemo(
    () => uploads.filter((upload) => upload.status === 'done'),
    [uploads]
  );
  const pausedUploads = useMemo(
    () => uploads.filter((upload) => upload.status === 'paused'),
    [uploads]
  );
  const currentUpload = uploads.find((upload) => ['preparing', 'uploading', 'verifying'].includes(upload.status));
  const hasBlockingUploads = activeUploads.length > 0;

  useEffect(() => {
    if (!hasBlockingUploads) return undefined;

    const handleBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = '';
      return '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasBlockingUploads]);

  useEffect(() => {
    const userId = user?._id || user?.id;
    if (!userId || !isDesktopRuntime() || restoredUserRef.current === String(userId)) return;
    restoredUserRef.current = String(userId);
    loadRecoverableUploads(String(userId))
      .then((items) => {
        if (!items.length) return;
        setUploads((current) => {
          const known = new Set(current.map((item) => item.id));
          return [
            ...current,
            ...items.filter((item) => !known.has(item.id)).map((item) => ({
              ...item,
              file: null,
              error: '',
              requiresFile: true,
              responseMessage: 'Ponovo odaberi isti fajl za nastavak uploada.',
            })),
          ];
        });
        setPanelOpen(true);
      })
      .catch((error) => console.error('Upload queue recovery failed:', error));
  }, [user]);

  useEffect(() => {
    const userId = user?._id || user?.id;
    if (!userId || !isDesktopRuntime() || uploads.length === 0) return undefined;
    const timer = window.setTimeout(() => {
      const now = new Date().toISOString();
      persistUploads(uploads.map((item) => ({
        id: item.id,
        userId: String(userId),
        filename: item.filename,
        size: Number(item.size || 0),
        lastModified: Number(item.lastModified || item.file?.lastModified || 0),
        status: item.status,
        progress: Number(item.progress || 0),
        transferredBytes: Number(item.transferredBytes || 0),
        transferId: item.transferId || '',
        videoId: item.videoId || '',
        uploadUrl: item.uploadUrl || '',
        metadata: item.metadata || {},
        createdAt: item.createdAt,
        updatedAt: now,
      }))).catch((error) => console.error('Upload queue persistence failed:', error));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [uploads, user]);

  const uploadJob = useCallback(async (job) => {
    uploadingRef.current = true;
    setPanelOpen(true);
    setUploads((current) =>
      current.map((upload) =>
        upload.id === job.id
          ? { ...upload, status: isDesktopRuntime() ? 'preparing' : 'uploading', error: '', requiresFile: false }
          : upload
      )
    );

    try {
      let responseMessage = '';
      if (isDesktopRuntime()) {
        const controller = new AbortController();
        abortControllerRef.current = controller;
        const result = await uploadDirectFinalResumable(
          job.file,
          job.metadata || {},
          {
            clientUploadId: job.id,
            transferId: job.transferId,
            videoId: job.videoId,
            uploadUrl: job.uploadUrl,
            offset: job.transferredBytes,
          },
          {
            signal: controller.signal,
            onPrepared: (state) => {
              setUploads((current) => current.map((upload) => upload.id === job.id ? {
                ...upload,
                ...state,
                status: Number(state.offset || 0) >= Number(upload.size || 0) ? 'verifying' : 'uploading',
                transferredBytes: Number(state.offset || 0),
              } : upload));
            },
            onProgress: (loaded, total) => {
              const progress = total > 0 ? Math.round((loaded * 100) / total) : 0;
              setUploads((current) => current.map((upload) => upload.id === job.id ? {
                ...upload,
                status: progress >= 100 ? 'verifying' : 'uploading',
                progress,
                transferredBytes: loaded,
              } : upload));
            },
          }
        );
        responseMessage = result.status === 'verifying'
          ? 'Fajl je poslan; server završava provjeru i pokreće obradu.'
          : 'Resumable upload je završen i video je poslan na obradu.';
      } else {
        const response = await axios.post('/broadcast/direct-final-upload', buildDirectFinalFormData(job), {
          headers: { 'Content-Type': 'multipart/form-data' },
          onUploadProgress: (progressEvent) => {
            const total = progressEvent.total || 0;
            if (total > 0) {
              const progress = Math.round((progressEvent.loaded * 100) / total);
              setUploads((current) =>
                current.map((upload) =>
                  upload.id === job.id ? {
                    ...upload,
                    progress,
                    transferredBytes: progressEvent.loaded,
                  } : upload
                )
              );
            }
          },
        });
        responseMessage = response.data?.message || 'Upload je sačuvan.';
      }

      setUploads((current) =>
        current.map((upload) =>
          upload.id === job.id
            ? {
                ...upload,
                file: null,
                status: 'done',
                progress: 100,
                transferredBytes: upload.size,
                responseMessage,
              }
            : upload
        )
      );
    } catch (error) {
      if (error.name === 'AbortError') {
        setUploads((current) => current.map((upload) => upload.id === job.id ? {
          ...upload,
          status: 'paused',
          responseMessage: 'Upload je pauziran i može se nastaviti.',
        } : upload));
        return;
      }
      console.error('Background upload failed:', error);
      setUploads((current) =>
        current.map((upload) =>
          upload.id === job.id
            ? {
                ...upload,
                status: 'error',
                progress: 0,
                error: error.response?.data?.message || error.message || 'Upload nije uspio.',
              }
            : upload
        )
      );
    } finally {
      abortControllerRef.current = null;
      uploadingRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (uploadingRef.current) return;
    const nextUpload = uploads.find((upload) => upload.status === 'pending' && upload.file);
    if (!nextUpload) return;

    uploadJob(nextUpload);
  }, [uploads, uploadJob]);

  const enqueueDirectFinalUploads = useCallback((files, metadata = {}) => {
    const sortedFiles = sortFilesNaturally(Array.from(files || []));
    const isBulkUpload = sortedFiles.length > 1 || Boolean(metadata.bulkUpload);
    const nextUploads = sortedFiles.map((file, index) => ({
      id: createUploadId(),
      file,
      filename: file.name,
      size: file.size,
      lastModified: file.lastModified,
      transferredBytes: 0,
      status: 'pending',
      progress: 0,
      error: '',
      createdAt: new Date().toISOString(),
      order: index,
      metadata: {
        ...metadata,
        bulkUpload: isBulkUpload,
        useFilenameMetadata: metadata.useFilenameMetadata !== false,
        finalTitle: isBulkUpload ? '' : metadata.finalTitle,
      },
    }));

    setUploads((current) => [...current, ...nextUploads]);
    setPanelOpen(true);
    return nextUploads.length;
  }, []);

  const retryUpload = useCallback((uploadId) => {
    setUploads((current) =>
      current.map((upload) =>
        upload.id === uploadId && upload.file
          ? { ...upload, status: 'pending', error: '', requiresFile: false }
          : upload
      )
    );
    setPanelOpen(true);
  }, []);

  const pauseUpload = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  const attachUploadFile = useCallback((uploadId, file) => {
    if (!file) return;
    setUploads((current) => current.map((upload) => {
      if (upload.id !== uploadId) return upload;
      if (upload.filename !== file.name || Number(upload.size) !== Number(file.size)) {
        return {
          ...upload,
          error: 'Odabrani fajl nema isti naziv i veličinu kao pauzirani upload.',
        };
      }
      return {
        ...upload,
        file,
        lastModified: file.lastModified,
        status: 'pending',
        requiresFile: false,
        error: '',
        responseMessage: 'Nastavljam upload od zadnjeg potvrđenog dijela.',
      };
    }));
    setPanelOpen(true);
  }, []);

  const clearFinishedUploads = useCallback(() => {
    setUploads((current) => current.filter((upload) => !['done', 'error'].includes(upload.status)));
    const userId = user?._id || user?.id;
    if (userId) pruneFinishedUploads(String(userId)).catch(() => {});
  }, [user]);

  const value = useMemo(
    () => ({
      uploads,
      activeUploads,
      failedUploads,
      completedUploads,
      pausedUploads,
      enqueueDirectFinalUploads,
      retryUpload,
      pauseUpload,
      attachUploadFile,
      clearFinishedUploads,
      hasBlockingUploads,
    }),
    [
      uploads,
      activeUploads,
      failedUploads,
      completedUploads,
      pausedUploads,
      enqueueDirectFinalUploads,
      retryUpload,
      pauseUpload,
      attachUploadFile,
      clearFinishedUploads,
      hasBlockingUploads,
    ]
  );

  return (
    <BackgroundUploadContext.Provider value={value}>
      {children}
      {uploads.length > 0 && (
        <Box
          sx={{
            position: 'fixed',
            right: { xs: 12, md: 24 },
            bottom: { xs: 12, md: 24 },
            width: { xs: 'calc(100% - 24px)', sm: 420 },
            zIndex: 1500,
          }}
        >
          <Collapse in={panelOpen}>
            <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2, boxShadow: 4 }}>
              <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
                <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
                  <CloudUploadIcon color={hasBlockingUploads ? 'primary' : 'action'} />
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 850 }}>
                      Upload manager
                    </Typography>
                    <Typography variant="caption" color="text.secondary" noWrap>
                      {hasBlockingUploads
                        ? 'Upload radi u pozadini; aplikaciju možeš normalno koristiti.'
                        : pausedUploads.length > 0 ? 'Pauzirani upload čeka nastavak.' : 'Upload red je završen.'}
                    </Typography>
                  </Box>
                </Stack>
                <IconButton size="small" onClick={() => setPanelOpen(false)} disabled={hasBlockingUploads}>
                  <CloseIcon fontSize="small" />
                </IconButton>
              </Stack>

              <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
                <Chip label={`${activeUploads.length} aktivno`} size="small" color={hasBlockingUploads ? 'primary' : 'default'} />
                <Chip label={`${completedUploads.length} završeno`} size="small" color="success" variant="outlined" />
                {pausedUploads.length > 0 && (
                  <Chip label={`${pausedUploads.length} pauzirano`} size="small" color="warning" variant="outlined" />
                )}
                {failedUploads.length > 0 && (
                  <Chip label={`${failedUploads.length} greška`} size="small" color="error" variant="outlined" />
                )}
              </Stack>

              {currentUpload && (
                <Box sx={{ mt: 1.25 }}>
                  <Typography variant="caption" sx={{ fontWeight: 700 }} noWrap>
                    {currentUpload.filename}
                  </Typography>
                  <LinearProgress variant="determinate" value={Number(currentUpload.progress) || 0} />
                  <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
                    <Typography variant="caption" color="text.secondary">
                      {currentUpload.status === 'preparing' ? 'Pripremam siguran transfer' : currentUpload.status === 'verifying' ? 'Server provjerava fajl' : `Upload ${Number(currentUpload.progress) || 0}%`}
                      {currentUpload.transferredBytes > 0 ? ` / ${formatBytes(currentUpload.transferredBytes)} od ${formatBytes(currentUpload.size)}` : ''}
                    </Typography>
                    {currentUpload.status === 'uploading' && isDesktopRuntime() && (
                      <Button size="small" startIcon={<PauseIcon />} onClick={pauseUpload}>Pauziraj</Button>
                    )}
                  </Stack>
                </Box>
              )}

              {pausedUploads.length > 0 && (
                <Stack spacing={0.75} sx={{ mt: 1 }}>
                  {pausedUploads.slice(0, 3).map((upload) => (
                    <Alert
                      key={upload.id}
                      severity="warning"
                      action={upload.file ? (
                        <Button color="inherit" size="small" startIcon={<ReplayIcon />} onClick={() => retryUpload(upload.id)}>
                          Nastavi
                        </Button>
                      ) : (
                        <Button color="inherit" size="small" component="label">
                          Odaberi fajl
                          <input
                            type="file"
                            hidden
                            onChange={(event) => {
                              attachUploadFile(upload.id, event.target.files?.[0]);
                              event.target.value = '';
                            }}
                          />
                        </Button>
                      )}
                    >
                      {upload.filename}: {Number(upload.progress) || 0}% sačuvano
                    </Alert>
                  ))}
                </Stack>
              )}

              {failedUploads.length > 0 && (
                <Stack spacing={0.75} sx={{ mt: 1 }}>
                  {failedUploads.slice(0, 3).map((upload) => (
                    <Alert
                      key={upload.id}
                      severity="error"
                      action={
                        upload.file ? (
                          <Button
                            color="inherit"
                            size="small"
                            startIcon={<ReplayIcon />}
                            onClick={() => retryUpload(upload.id)}
                          >
                            Pokušaj ponovo
                          </Button>
                        ) : null
                      }
                    >
                      {upload.filename}: {upload.error}
                    </Alert>
                  ))}
                </Stack>
              )}

              {!hasBlockingUploads && uploads.length > 0 && (
                <Button size="small" sx={{ mt: 1 }} onClick={clearFinishedUploads}>
                  Očisti završeno
                </Button>
              )}
            </Paper>
          </Collapse>
        </Box>
      )}
    </BackgroundUploadContext.Provider>
  );
};

export const useBackgroundUploads = () => {
  const context = useContext(BackgroundUploadContext);
  if (!context) {
    throw new Error('useBackgroundUploads must be used inside BackgroundUploadProvider');
  }
  return context;
};
