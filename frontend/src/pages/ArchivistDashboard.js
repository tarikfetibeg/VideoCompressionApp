import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  Grid,
  IconButton,
  InputLabel,
  LinearProgress,
  MenuItem,
  Pagination,
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
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import DoneAllIcon from '@mui/icons-material/DoneAll';
import EditNoteIcon from '@mui/icons-material/EditNote';
import FindReplaceIcon from '@mui/icons-material/FindReplace';
import LocalOfferIcon from '@mui/icons-material/LocalOffer';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import RefreshIcon from '@mui/icons-material/Refresh';
import ReportProblemIcon from '@mui/icons-material/ReportProblem';
import SaveIcon from '@mui/icons-material/Save';
import SendIcon from '@mui/icons-material/Send';
import { Link } from 'react-router-dom';
import axiosInstance from '../axiosConfig';
import {
  EmptyState,
  FilterBar,
  KpiStrip,
  StatusChip,
  WorkspaceHeader,
} from '../components/common/WorkspaceChrome';
import VideoThumbnailPreview from '../components/common/VideoThumbnailPreview';
import {
  archiveReviewLabels,
  archiveWorkflowLabels,
  broadcastLabels,
  formatBytesBs,
  formatDateBs,
  formatDateTimeBs,
  formatNumberBs,
  formatStatusLabel,
  processingLabels,
} from '../utils/uiLabels';
import { getSearchParam } from '../utils/searchParams';

const pageSize = 40;
const duplicatePageSize = 8;

const reviewOptions = [
  { value: 'all', label: 'Svi statusi' },
  { value: 'unreviewed', label: 'Nije pregledano' },
  { value: 'reviewed', label: 'Pregledano' },
  { value: 'needs_metadata', label: 'Treba metadata' },
  { value: 'duplicate', label: 'Duplikat' },
];
const reviewActionOptions = reviewOptions.filter((option) => option.value !== 'all');

const workflowOptions = [
  { value: 'all', label: 'Svi tokovi' },
  { value: 'archive', label: 'Spremno za arhivu' },
  { value: 'aired', label: 'Emitovano' },
  { value: 'edited', label: 'Smontirano' },
  { value: 'needs_correction', label: 'Treba ispravka' },
];

const sortOptions = [
  { value: 'uploadDate', label: 'Upload datum' },
  { value: 'tagDate', label: 'Datum snimanja' },
  { value: 'name', label: 'Naziv' },
  { value: 'category', label: 'Kategorija' },
  { value: 'reviewStatus', label: 'Review status' },
  { value: 'updatedAt', label: 'Zadnja izmjena' },
];

const getVideoTitle = (video) =>
  video?.finalTitle || video?.originalFilename || video?.filename || 'Bez naziva';
const getSecondaryFilename = (video) => {
  const title = getVideoTitle(video);
  const filename = video?.filename || video?.originalFilename || '';
  return filename && filename !== title ? filename : '';
};

const getPersonName = (person) => person?.username || 'N/A';

const normalizeTags = (value) =>
  String(value || '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);

const normalizeDateInput = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
};

const defaultWorkspace = {
  items: [],
  total: 0,
  page: 1,
  limit: pageSize,
  totalPages: 1,
  summary: {},
  facets: {},
};

const defaultDuplicateWorkspace = {
  items: [],
  total: 0,
  page: 1,
  limit: duplicatePageSize,
  totalPages: 1,
  summary: {},
};

const ArchivistDashboard = () => {
  const [activeView, setActiveView] = useState('queue');
  const [workspace, setWorkspace] = useState(defaultWorkspace);
  const [duplicates, setDuplicates] = useState(defaultDuplicateWorkspace);
  const [overview, setOverview] = useState({});
  const [contentTypes, setContentTypes] = useState([]);
  const [filters, setFilters] = useState({
    reviewStatus: 'all',
    workflowStatus: 'all',
    contentTypeId: 'all',
    q: '',
    sortBy: 'uploadDate',
    sortOrder: 'desc',
  });
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [duplicatePage, setDuplicatePage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [duplicatesLoading, setDuplicatesLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [tagDialog, setTagDialog] = useState({ open: false, video: null, value: '' });
  const [metadataDialog, setMetadataDialog] = useState({ open: false, video: null, draft: {} });
  const [reviewDialog, setReviewDialog] = useState({ open: false, video: null, status: 'needs_metadata', notes: '' });
  const [deleteDialog, setDeleteDialog] = useState({ open: false, video: null, keeper: null, reason: '' });
  const [correctionDialog, setCorrectionDialog] = useState({
    open: false,
    mode: 'dismiss',
    video: null,
    reason: '',
    busy: false,
  });

  const activeContentTypes = useMemo(
    () => contentTypes.filter((type) => type.active !== false),
    [contentTypes]
  );

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(filters.q), 300);
    return () => window.clearTimeout(timer);
  }, [filters.q]);

  const fetchOverview = useCallback(() => {
    axiosInstance
      .get('/archive/summary')
      .then((response) => setOverview(response.data || {}))
      .catch((error) => {
        console.error('Error loading archive summary:', error);
      });
  }, []);

  const fetchContentTypes = useCallback(() => {
    axiosInstance
      .get('/broadcast/content-types')
      .then((response) => setContentTypes(Array.isArray(response.data) ? response.data : []))
      .catch((error) => console.error('Error loading content types:', error));
  }, []);

  const fetchVideos = useCallback(({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    setErrorMessage('');

    axiosInstance
      .get('/archive/videos/workspace', {
        params: {
          page,
          limit: pageSize,
          reviewStatus: activeView === 'queue' ? 'queue' : filters.reviewStatus,
          workflowStatus: filters.workflowStatus,
          contentTypeId: filters.contentTypeId,
          q: getSearchParam(debouncedSearch),
          sortBy: filters.sortBy,
          sortOrder: filters.sortOrder,
        },
      })
      .then((response) => setWorkspace({ ...defaultWorkspace, ...response.data }))
      .catch((error) => {
        console.error('Error loading archive workspace:', error);
        setErrorMessage(error.response?.data?.message || 'Arhiva nije ucitana.');
      })
      .finally(() => {
        if (!silent) setLoading(false);
      });
  }, [activeView, debouncedSearch, filters, page]);

  const fetchDuplicates = useCallback(({ silent = false } = {}) => {
    if (!silent) setDuplicatesLoading(true);
    setErrorMessage('');

    axiosInstance
      .get('/archive/duplicates/workspace', {
        params: {
          page: duplicatePage,
          limit: duplicatePageSize,
          q: getSearchParam(debouncedSearch),
        },
      })
      .then((response) => setDuplicates({ ...defaultDuplicateWorkspace, ...response.data }))
      .catch((error) => {
        console.error('Error loading duplicate candidates:', error);
        setErrorMessage(error.response?.data?.message || 'Duplikati nisu ucitani.');
      })
      .finally(() => {
        if (!silent) setDuplicatesLoading(false);
      });
  }, [debouncedSearch, duplicatePage]);

  const refreshCurrentView = useCallback(() => {
    fetchOverview();
    if (activeView === 'duplicates') {
      fetchDuplicates();
      return;
    }
    fetchVideos();
  }, [activeView, fetchDuplicates, fetchOverview, fetchVideos]);

  const sendCorrectionToProduction = (video) => {
    setMessage('');
    setErrorMessage('');
    axiosInstance
      .post(`/corrections/video/${video._id}/ensure`, {
        note: video.correctionNote || 'Arhiva je potvrdila da je klipu potrebna ispravka.',
      })
      .then((response) => {
        setMessage(response.data?.message || 'Ispravka je poslana u produkciju.');
        refreshCurrentView();
      })
      .catch((error) => {
        setErrorMessage(error.response?.data?.message || 'Ispravku nije moguće poslati u produkciju.');
      });
  };

  const submitCorrectionDecision = () => {
    const { video, mode, reason } = correctionDialog;
    if (!video || !reason.trim()) return;
    const requestId = video.activeCorrectionRequest?._id || video.activeCorrectionRequest;
    setCorrectionDialog((current) => ({ ...current, busy: true }));
    setMessage('');
    setErrorMessage('');

    const request = mode === 'resolve' && requestId
      ? axiosInstance.patch(`/corrections/${requestId}/status`, {
        status: 'resolved',
        resolutionNote: reason.trim(),
      })
      : axiosInstance.patch(`/corrections/video/${video._id}/dismiss`, {
        reason: reason.trim(),
      });

    request
      .then((response) => {
        setMessage(response.data?.message || 'Correction status je ažuriran.');
        setCorrectionDialog({ open: false, mode: 'dismiss', video: null, reason: '', busy: false });
        refreshCurrentView();
      })
      .catch((error) => {
        setErrorMessage(error.response?.data?.message || 'Correction status nije moguće ažurirati.');
        setCorrectionDialog((current) => ({ ...current, busy: false }));
      });
  };

  useEffect(() => {
    fetchOverview();
    fetchContentTypes();
  }, [fetchContentTypes, fetchOverview]);

  useEffect(() => {
    if (activeView === 'duplicates') {
      fetchDuplicates();
      return;
    }
    fetchVideos();
  }, [activeView, fetchDuplicates, fetchVideos]);

  const handleFilterChange = (event) => {
    const { name, value } = event.target;
    setPage(1);
    setDuplicatePage(1);
    setFilters((current) => ({ ...current, [name]: value }));
  };

  const handleViewChange = (event, value) => {
    setActiveView(value);
    setPage(1);
    setDuplicatePage(1);
  };

  const openMetadataDialog = (video) => {
    setMetadataDialog({
      open: true,
      video,
      draft: {
        finalTitle: video.finalTitle || '',
        event: video.event || '',
        tagDate: normalizeDateInput(video.tagDate || video.uploadDate),
        contentTypeId: video.contentType?._id || '',
        keywords: (video.keywords || []).join(', '),
        archiveReviewNotes: video.archiveReviewNotes || '',
      },
    });
  };

  const saveMetadata = () => {
    if (!metadataDialog.video) return;
    setMessage('');
    setErrorMessage('');

    const draft = metadataDialog.draft || {};
    axiosInstance
      .patch(`/archive/videos/${metadataDialog.video._id}/metadata`, {
        finalTitle: draft.finalTitle,
        event: draft.event,
        tagDate: draft.tagDate,
        contentTypeId: draft.contentTypeId,
        keywords: normalizeTags(draft.keywords),
        archiveReviewNotes: draft.archiveReviewNotes,
      })
      .then(() => {
        setMetadataDialog({ open: false, video: null, draft: {} });
        setMessage('Metadata je sacuvana.');
        fetchOverview();
        fetchVideos({ silent: true });
      })
      .catch((error) => {
        console.error('Error saving metadata:', error);
        setErrorMessage(error.response?.data?.message || 'Metadata nije sacuvana.');
      });
  };

  const saveTags = () => {
    if (!tagDialog.video) return;
    setMessage('');
    setErrorMessage('');

    axiosInstance
      .patch(`/archive/videos/${tagDialog.video._id}/tags`, {
        replace: normalizeTags(tagDialog.value),
      })
      .then(() => {
        setTagDialog({ open: false, video: null, value: '' });
        setMessage('Tagovi su sacuvani.');
        fetchOverview();
        fetchVideos({ silent: true });
      })
      .catch((error) => {
        console.error('Error saving tags:', error);
        setErrorMessage(error.response?.data?.message || 'Tagovi nisu sacuvani.');
      });
  };

  const saveContentType = (video, contentTypeId) => {
    if (!contentTypeId) return;
    setMessage('');
    setErrorMessage('');

    axiosInstance
      .patch(`/archive/videos/${video._id}/content-type`, { contentTypeId })
      .then(() => {
        setMessage('Kategorija je sacuvana.');
        fetchOverview();
        fetchVideos({ silent: true });
      })
      .catch((error) => {
        console.error('Error saving content type:', error);
        setErrorMessage(error.response?.data?.message || 'Kategorija nije sacuvana.');
      });
  };

  const saveReview = (video, status, notes = '') => {
    if (!video) return;
    setMessage('');
    setErrorMessage('');

    axiosInstance
      .patch(`/archive/videos/${video._id}/review`, { status, notes })
      .then(() => {
        setReviewDialog({ open: false, video: null, status: 'needs_metadata', notes: '' });
        setMessage('Review je sacuvan.');
        fetchOverview();
        fetchVideos({ silent: true });
      })
      .catch((error) => {
        console.error('Error saving review:', error);
        setErrorMessage(error.response?.data?.message || 'Review nije sacuvan.');
      });
  };

  const deleteDuplicate = () => {
    if (!deleteDialog.video || !deleteDialog.keeper) return;
    setMessage('');
    setErrorMessage('');

    axiosInstance
      .delete(`/archive/videos/${deleteDialog.video._id}/duplicate`, {
        data: {
          duplicateOf: deleteDialog.keeper._id,
          reason: deleteDialog.reason,
        },
      })
      .then((response) => {
        setDeleteDialog({ open: false, video: null, keeper: null, reason: '' });
        setMessage(`Duplikat uklonjen. Obrisano fajlova: ${response.data?.deletedPaths?.length || 0}.`);
        fetchOverview();
        fetchDuplicates({ silent: true });
        fetchVideos({ silent: true });
      })
      .catch((error) => {
        console.error('Error deleting duplicate:', error);
        setErrorMessage(error.response?.data?.message || 'Duplikat nije uklonjen.');
      });
  };

  const kpis = [
    { label: 'Za pregled', value: formatNumberBs(overview.reviewQueue ?? workspace.summary.reviewQueue ?? overview.unreviewed ?? workspace.summary.unreviewed ?? 0), color: 'warning.main' },
    { label: 'Treba metadata', value: formatNumberBs(overview.needsMetadata ?? workspace.summary.needsMetadata ?? 0), color: 'info.main' },
    { label: 'Duplikat grupe', value: formatNumberBs(overview.duplicateCandidateGroups ?? duplicates.summary.groups ?? 0), color: 'error.main' },
    { label: 'Spremno za arhivu', value: formatNumberBs(overview.archiveReadyVideos ?? workspace.summary.archiveReady ?? 0), color: 'success.main' },
    { label: 'Treba ispravka', value: formatNumberBs(overview.needsCorrection ?? workspace.summary.needsCorrection ?? 0), color: 'error.main' },
    { label: 'Ukupno', value: formatNumberBs(overview.totalVideos ?? workspace.summary.total ?? 0) },
  ];

  const renderVideoRow = (video) => {
    const reviewValue = video.archiveReviewStatus || 'unreviewed';
    const contentTypeValue = video.contentType?._id || '';
    const correctionRequest = video.activeCorrectionRequest || null;
    const correctionRequestStatus = correctionRequest?.status || '';
    const correctionInProgress = ['reported', 'assigned', 'in_edit', 'ready_for_review'].includes(correctionRequestStatus);
    const correctionCanBeWithdrawn = !['in_edit', 'ready_for_review'].includes(correctionRequestStatus);

    return (
      <TableRow key={video._id} hover>
        <TableCell sx={{ width: '36%', verticalAlign: 'top' }}>
          <Stack direction="row" spacing={1} alignItems="flex-start">
            <VideoThumbnailPreview
              videoId={video._id}
              title={getVideoTitle(video)}
              width={96}
              height={54}
              enableScrubPreview
            />
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="body2" sx={{ fontWeight: 850, overflowWrap: 'anywhere' }}>
                {getVideoTitle(video)}
              </Typography>
              <Typography variant="caption" color="text.secondary" component="div" sx={{ overflowWrap: 'anywhere' }}>
                {video.event || 'Bez eventa'} / {formatDateTimeBs(video.tagDate || video.airDate || video.uploadDate)}
              </Typography>
            </Box>
          </Stack>
        </TableCell>
        <TableCell sx={{ width: '28%', verticalAlign: 'top' }}>
          <Stack spacing={1}>
            <FormControl fullWidth size="small">
              <InputLabel>Kategorija</InputLabel>
              <Select
                value={contentTypeValue}
                label="Kategorija"
                onChange={(event) => saveContentType(video, event.target.value)}
              >
                <MenuItem value="" disabled>
                  Bez kategorije
                </MenuItem>
                {activeContentTypes.map((type) => (
                  <MenuItem key={type._id} value={type._id}>
                    {type.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
              {(video.keywords || []).slice(0, 4).map((tag) => (
                <StatusChip key={tag} label={tag} variant="outlined" tone="default" />
              ))}
              {(video.keywords || []).length > 4 && (
                <StatusChip label={`+${video.keywords.length - 4}`} variant="outlined" tone="default" />
              )}
              <Tooltip title="Uredi tagove">
                <IconButton
                  size="small"
                  onClick={() => setTagDialog({ open: true, video, value: (video.keywords || []).join(', ') })}
                >
                  <LocalOfferIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Stack>
            <Box>
              <Typography variant="caption" color="text.secondary" component="div">
                Reporter / montaza
              </Typography>
              <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
                {getPersonName(video.reporter)} / {getPersonName(video.editor)}
              </Typography>
            </Box>
          </Stack>
        </TableCell>
        <TableCell sx={{ width: '20%', verticalAlign: 'top' }}>
          <Stack spacing={0.75} alignItems="flex-start">
            <StatusChip value={reviewValue} maps={archiveReviewLabels} />
            <StatusChip value={video.processingStatus} maps={processingLabels} variant="outlined" />
            {video.broadcastStatus && (
              <StatusChip value={video.broadcastStatus} maps={broadcastLabels} variant="outlined" />
            )}
            {video.correctionStatus === 'needs_correction' && (
              <>
                <StatusChip value="needs_correction" label="Potrebna ispravka" />
                {correctionInProgress && (
                  <StatusChip
                    label={correctionRequestStatus === 'ready_for_review' ? 'Čeka potvrdu' : 'U produkciji'}
                    tone={correctionRequestStatus === 'ready_for_review' ? 'warning' : 'info'}
                    variant="outlined"
                  />
                )}
              </>
            )}
            <Typography variant="caption" color="text.secondary">
              {formatBytesBs(video.sizeCompressed || video.sizeOriginal || video.sizePreview)}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Pregledao: {getPersonName(video.archiveReviewedBy)}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {formatDateBs(video.archiveReviewedAt || video.updatedAt || video.uploadDate)}
            </Typography>
          </Stack>
        </TableCell>
        <TableCell align="right" sx={{ width: '18%', verticalAlign: 'top' }}>
          <Stack direction="row" justifyContent="flex-end" spacing={0.75} flexWrap="wrap" useFlexGap>
            <Tooltip title="Otvori detalje">
              <IconButton size="small" component={Link} to={`/video-details/${video._id}`}>
                <OpenInNewIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Button size="small" variant="outlined" startIcon={<EditNoteIcon />} onClick={() => openMetadataDialog(video)}>
              Metadata
            </Button>
            <Button
              size="small"
              variant="outlined"
              startIcon={<DoneAllIcon />}
              onClick={() => saveReview(video, 'reviewed', video.archiveReviewNotes || '')}
            >
              Pregledano
            </Button>
            <Button
              size="small"
              variant="outlined"
              color="warning"
              onClick={() => setReviewDialog({ open: true, video, status: 'needs_metadata', notes: video.archiveReviewNotes || '' })}
            >
              Review
            </Button>
            {video.correctionStatus === 'needs_correction' && !correctionInProgress && (
              <Button
                size="small"
                variant="contained"
                color="warning"
                startIcon={<SendIcon />}
                onClick={() => sendCorrectionToProduction(video)}
              >
                Pošalji u montažu
              </Button>
            )}
            {video.correctionStatus === 'needs_correction' && correctionRequestStatus === 'ready_for_review' && (
              <Button
                size="small"
                variant="contained"
                color="success"
                onClick={() => setCorrectionDialog({
                  open: true,
                  mode: 'resolve',
                  video,
                  reason: '',
                  busy: false,
                })}
              >
                Potvrdi ispravku
              </Button>
            )}
            {video.correctionStatus === 'needs_correction' && correctionCanBeWithdrawn && (
              <Button
                size="small"
                variant="outlined"
                color="error"
                onClick={() => setCorrectionDialog({
                  open: true,
                  mode: 'dismiss',
                  video,
                  reason: '',
                  busy: false,
                })}
              >
                Povuci oznaku
              </Button>
            )}
          </Stack>
        </TableCell>
      </TableRow>
    );
  };

  const renderVideoTable = () => (
    <Box>
      {loading && <LinearProgress sx={{ mb: 1 }} />}
      {workspace.items.length === 0 && !loading ? (
        <EmptyState
          title="Nema arhivskog materijala"
          description="Promijeni filtere ili osvjezi workspace."
          action={<Button variant="outlined" startIcon={<RefreshIcon />} onClick={refreshCurrentView}>Osvjezi</Button>}
        />
      ) : (
        <TableContainer sx={{ border: 1, borderColor: 'divider', borderRadius: 1.5 }}>
          <Table size="small" sx={{ tableLayout: 'fixed', width: '100%' }}>
            <TableHead>
              <TableRow>
                <TableCell>Materijal</TableCell>
                <TableCell>Metadata</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Akcije</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>{workspace.items.map(renderVideoRow)}</TableBody>
          </Table>
        </TableContainer>
      )}
      {workspace.totalPages > 1 && (
        <Stack alignItems="center" sx={{ mt: 2 }}>
          <Pagination count={workspace.totalPages} page={page} onChange={(event, value) => setPage(value)} />
        </Stack>
      )}
    </Box>
  );

  const renderDuplicates = () => (
    <Stack spacing={2}>
      {duplicatesLoading && <LinearProgress />}
      {duplicates.items.map((group, groupIndex) => {
        const keeper = group.videos?.[0];
        return (
          <Box key={group.key} sx={{ p: 2, border: 1, borderColor: 'divider', borderRadius: 1.5 }}>
            <Stack
              direction={{ xs: 'column', md: 'row' }}
              justifyContent="space-between"
              alignItems={{ xs: 'flex-start', md: 'center' }}
              spacing={1}
              sx={{ mb: 1.5 }}
            >
              <Box>
                <Typography variant="subtitle1" sx={{ fontWeight: 850 }}>
                  Grupa {((duplicatePage - 1) * duplicatePageSize) + groupIndex + 1}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {group.count} videa / {formatBytesBs(group.totalSize)}
                </Typography>
              </Box>
              {keeper && <StatusChip label={`Keeper: ${getVideoTitle(keeper)}`} tone="success" variant="outlined" />}
            </Stack>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Materijal</TableCell>
                    <TableCell>Kategorija</TableCell>
                    <TableCell>Upload</TableCell>
                    <TableCell>Velicina</TableCell>
                    <TableCell align="right">Akcije</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(group.videos || []).map((video) => {
                    const isKeeper = keeper?._id === video._id;
                    const secondaryFilename = getSecondaryFilename(video);
                    return (
                      <TableRow key={video._id} hover>
                        <TableCell>
                          <Stack direction="row" spacing={1} alignItems="center">
                            <VideoThumbnailPreview
                              videoId={video._id}
                              title={getVideoTitle(video)}
                              width={84}
                              height={48}
                              enableScrubPreview
                            />
                            <Box sx={{ minWidth: 0 }}>
                              <Typography variant="body2" sx={{ fontWeight: 800 }} noWrap>
                                {getVideoTitle(video)}
                              </Typography>
                              {secondaryFilename && (
                                <Typography variant="caption" color="text.secondary" noWrap component="div">
                                  {secondaryFilename}
                                </Typography>
                              )}
                            </Box>
                          </Stack>
                        </TableCell>
                        <TableCell>{video.contentType?.name || video.finalCategory || 'N/A'}</TableCell>
                        <TableCell>{formatDateTimeBs(video.uploadDate)}</TableCell>
                        <TableCell>{formatBytesBs(video.sizeCompressed || video.sizeOriginal || video.sizePreview)}</TableCell>
                        <TableCell align="right">
                          <Stack direction="row" justifyContent="flex-end" spacing={0.75}>
                            <Tooltip title="Otvori detalje">
                              <IconButton size="small" component={Link} to={`/video-details/${video._id}`}>
                                <OpenInNewIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                            <Button
                              size="small"
                              variant="outlined"
                              color="error"
                              disabled={isKeeper}
                              startIcon={<DeleteOutlineIcon />}
                              onClick={() => setDeleteDialog({ open: true, video, keeper, reason: '' })}
                            >
                              Obrisi duplikat
                            </Button>
                          </Stack>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
        );
      })}
      {!duplicatesLoading && duplicates.items.length === 0 && (
        <EmptyState title="Nema kandidata za duplikate" description="Trenutni filter nije pronasao duplikate." />
      )}
      {duplicates.totalPages > 1 && (
        <Stack alignItems="center">
          <Pagination count={duplicates.totalPages} page={duplicatePage} onChange={(event, value) => setDuplicatePage(value)} />
        </Stack>
      )}
    </Stack>
  );

  return (
    <Box>
      <WorkspaceHeader
        eyebrow="Archive Desk"
        title="Arhiva materijala"
        subtitle="Pregled, metadata, tagovi, kategorije i kontrola duplikata za finalne materijale."
        chips={[
          { label: 'Prikaz', value: activeView === 'duplicates' ? 'Duplikati' : formatStatusLabel(activeView === 'queue' ? 'unreviewed' : filters.reviewStatus, archiveReviewLabels) },
          { label: 'Workflow', value: formatStatusLabel(filters.workflowStatus, archiveWorkflowLabels) },
          { label: 'Rezultata', value: formatNumberBs(activeView === 'duplicates' ? duplicates.total : workspace.total) },
        ]}
        actions={(
          <Button variant="outlined" startIcon={<RefreshIcon />} onClick={refreshCurrentView}>
            Osvjezi
          </Button>
        )}
      />

      {message && <Alert severity="success" sx={{ mb: 2 }}>{message}</Alert>}
      {errorMessage && <Alert severity="error" sx={{ mb: 2 }}>{errorMessage}</Alert>}

      <KpiStrip items={kpis} />

      <FilterBar
        title="Radni filteri"
        summary={activeView === 'duplicates' ? 'Duplikati koriste naslov, trajanje i velicinu za grupisanje.' : 'Lista koristi paginirani archive workspace endpoint.'}
        actions={(
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Button
              variant={activeView === 'queue' ? 'contained' : 'outlined'}
              startIcon={<ReportProblemIcon />}
              onClick={(event) => handleViewChange(event, 'queue')}
            >
              Review queue
            </Button>
            <Button
              variant={activeView === 'all' ? 'contained' : 'outlined'}
              startIcon={<FindReplaceIcon />}
              onClick={(event) => handleViewChange(event, 'all')}
            >
              Svi materijali
            </Button>
            <Button
              variant={activeView === 'duplicates' ? 'contained' : 'outlined'}
              startIcon={<DeleteOutlineIcon />}
              onClick={(event) => handleViewChange(event, 'duplicates')}
            >
              Duplikati
            </Button>
          </Stack>
        )}
      >
        <Grid container spacing={1.5}>
          {activeView !== 'queue' && activeView !== 'duplicates' && (
            <Grid item xs={12} sm={6} md={2}>
              <FormControl fullWidth size="small">
                <InputLabel>Review</InputLabel>
                <Select name="reviewStatus" value={filters.reviewStatus} label="Review" onChange={handleFilterChange}>
                  {reviewOptions.map((option) => (
                    <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
          )}
          {activeView !== 'duplicates' && (
            <>
              <Grid item xs={12} sm={6} md={2}>
                <FormControl fullWidth size="small">
                  <InputLabel>Workflow</InputLabel>
                  <Select name="workflowStatus" value={filters.workflowStatus} label="Workflow" onChange={handleFilterChange}>
                    {workflowOptions.map((option) => (
                      <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} sm={6} md={2}>
                <FormControl fullWidth size="small">
                  <InputLabel>Kategorija</InputLabel>
                  <Select name="contentTypeId" value={filters.contentTypeId} label="Kategorija" onChange={handleFilterChange}>
                    <MenuItem value="all">Sve kategorije</MenuItem>
                    {activeContentTypes.map((type) => (
                      <MenuItem key={type._id} value={type._id}>{type.name}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
            </>
          )}
          <Grid item xs={12} md={activeView === 'duplicates' ? 6 : 3}>
            <TextField
              name="q"
              label="Pretraga"
              value={filters.q}
              onChange={handleFilterChange}
              fullWidth
              size="small"
            />
          </Grid>
          {activeView !== 'duplicates' && (
            <>
              <Grid item xs={12} sm={6} md={2}>
                <FormControl fullWidth size="small">
                  <InputLabel>Sort</InputLabel>
                  <Select name="sortBy" value={filters.sortBy} label="Sort" onChange={handleFilterChange}>
                    {sortOptions.map((option) => (
                      <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} sm={6} md={1}>
                <FormControl fullWidth size="small">
                  <InputLabel>Red</InputLabel>
                  <Select name="sortOrder" value={filters.sortOrder} label="Red" onChange={handleFilterChange}>
                    <MenuItem value="desc">Novo</MenuItem>
                    <MenuItem value="asc">Staro</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
            </>
          )}
        </Grid>
      </FilterBar>

      {activeView === 'duplicates' ? renderDuplicates() : renderVideoTable()}

      <Dialog open={tagDialog.open} onClose={() => setTagDialog({ open: false, video: null, value: '' })} fullWidth maxWidth="sm">
        <DialogTitle>Uredi tagove</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ fontWeight: 800, mb: 1 }}>
            {getVideoTitle(tagDialog.video)}
          </Typography>
          <TextField
            autoFocus
            label="Tagovi"
            helperText="Odvoji tagove zarezom."
            value={tagDialog.value}
            onChange={(event) => setTagDialog((state) => ({ ...state, value: event.target.value }))}
            fullWidth
            multiline
            minRows={3}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTagDialog({ open: false, video: null, value: '' })}>Odustani</Button>
          <Button variant="contained" startIcon={<SaveIcon />} onClick={saveTags}>Sacuvaj</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={metadataDialog.open} onClose={() => setMetadataDialog({ open: false, video: null, draft: {} })} fullWidth maxWidth="md">
        <DialogTitle>Uredi metadata</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 0 }}>
            <Grid item xs={12} md={6}>
              <TextField
                label="Finalni naslov"
                value={metadataDialog.draft.finalTitle || ''}
                onChange={(event) => setMetadataDialog((state) => ({
                  ...state,
                  draft: { ...state.draft, finalTitle: event.target.value },
                }))}
                fullWidth
                size="small"
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                label="Event"
                value={metadataDialog.draft.event || ''}
                onChange={(event) => setMetadataDialog((state) => ({
                  ...state,
                  draft: { ...state.draft, event: event.target.value },
                }))}
                fullWidth
                size="small"
              />
            </Grid>
            <Grid item xs={12} md={4}>
              <TextField
                type="date"
                label="Datum"
                value={metadataDialog.draft.tagDate || ''}
                onChange={(event) => setMetadataDialog((state) => ({
                  ...state,
                  draft: { ...state.draft, tagDate: event.target.value },
                }))}
                fullWidth
                size="small"
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            <Grid item xs={12} md={8}>
              <FormControl fullWidth size="small">
                <InputLabel>Kategorija</InputLabel>
                <Select
                  value={metadataDialog.draft.contentTypeId || ''}
                  label="Kategorija"
                  onChange={(event) => setMetadataDialog((state) => ({
                    ...state,
                    draft: { ...state.draft, contentTypeId: event.target.value },
                  }))}
                >
                  <MenuItem value="">Bez kategorije</MenuItem>
                  {activeContentTypes.map((type) => (
                    <MenuItem key={type._id} value={type._id}>{type.name}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12}>
              <TextField
                label="Tagovi"
                value={metadataDialog.draft.keywords || ''}
                onChange={(event) => setMetadataDialog((state) => ({
                  ...state,
                  draft: { ...state.draft, keywords: event.target.value },
                }))}
                fullWidth
                multiline
                minRows={2}
                size="small"
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                label="Archive review biljeska"
                value={metadataDialog.draft.archiveReviewNotes || ''}
                onChange={(event) => setMetadataDialog((state) => ({
                  ...state,
                  draft: { ...state.draft, archiveReviewNotes: event.target.value },
                }))}
                fullWidth
                multiline
                minRows={3}
                size="small"
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setMetadataDialog({ open: false, video: null, draft: {} })}>Odustani</Button>
          <Button variant="contained" startIcon={<SaveIcon />} onClick={saveMetadata}>Sacuvaj</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={reviewDialog.open} onClose={() => setReviewDialog({ open: false, video: null, status: 'needs_metadata', notes: '' })} fullWidth maxWidth="sm">
        <DialogTitle>Archive review</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ fontWeight: 800, mb: 1 }}>
            {getVideoTitle(reviewDialog.video)}
          </Typography>
          <FormControl fullWidth size="small" sx={{ mb: 2 }}>
            <InputLabel>Status</InputLabel>
            <Select
              value={reviewDialog.status}
              label="Status"
              onChange={(event) => setReviewDialog((state) => ({ ...state, status: event.target.value }))}
            >
              {reviewActionOptions.map((option) => (
                <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <TextField
            label="Biljeska"
            value={reviewDialog.notes}
            onChange={(event) => setReviewDialog((state) => ({ ...state, notes: event.target.value }))}
            fullWidth
            multiline
            minRows={3}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setReviewDialog({ open: false, video: null, status: 'needs_metadata', notes: '' })}>Odustani</Button>
          <Button
            variant="contained"
            startIcon={<SaveIcon />}
            onClick={() => saveReview(reviewDialog.video, reviewDialog.status, reviewDialog.notes)}
          >
            Sacuvaj
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={deleteDialog.open} onClose={() => setDeleteDialog({ open: false, video: null, keeper: null, reason: '' })} fullWidth maxWidth="sm">
        <DialogTitle>Obrisi duplikat</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>
            Brise se zapis duplikata i samo oni fajlovi koje ne referencira drugi video.
          </Alert>
          <Typography variant="body2">
            Duplikat: <strong>{getVideoTitle(deleteDialog.video)}</strong>
          </Typography>
          <Typography variant="body2" sx={{ mb: 2 }}>
            Keeper: <strong>{getVideoTitle(deleteDialog.keeper)}</strong>
          </Typography>
          <Divider sx={{ mb: 2 }} />
          <TextField
            label="Razlog"
            value={deleteDialog.reason}
            onChange={(event) => setDeleteDialog((state) => ({ ...state, reason: event.target.value }))}
            fullWidth
            multiline
            minRows={2}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialog({ open: false, video: null, keeper: null, reason: '' })}>Odustani</Button>
          <Button color="error" variant="contained" startIcon={<DeleteOutlineIcon />} onClick={deleteDuplicate}>
            Obrisi duplikat
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={correctionDialog.open}
        onClose={correctionDialog.busy
          ? undefined
          : () => setCorrectionDialog({ open: false, mode: 'dismiss', video: null, reason: '', busy: false })}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>
          {correctionDialog.mode === 'resolve' ? 'Potvrdi završenu ispravku' : 'Povuci oznaku ispravke'}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 2 }}>
            {getVideoTitle(correctionDialog.video)}
          </Typography>
          <TextField
            autoFocus
            label={correctionDialog.mode === 'resolve' ? 'Napomena o ispravci' : 'Obrazloženje povlačenja'}
            value={correctionDialog.reason}
            onChange={(event) => setCorrectionDialog((current) => ({ ...current, reason: event.target.value }))}
            multiline
            minRows={3}
            fullWidth
            required
          />
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setCorrectionDialog({ open: false, mode: 'dismiss', video: null, reason: '', busy: false })}
            disabled={correctionDialog.busy}
          >
            Odustani
          </Button>
          <Button
            variant="contained"
            color={correctionDialog.mode === 'resolve' ? 'success' : 'error'}
            disabled={correctionDialog.busy || !correctionDialog.reason.trim()}
            onClick={submitCorrectionDecision}
          >
            {correctionDialog.busy
              ? 'Radim...'
              : correctionDialog.mode === 'resolve'
                ? 'Potvrdi'
                : 'Povuci oznaku'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default ArchivistDashboard;
