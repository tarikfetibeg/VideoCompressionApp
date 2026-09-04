import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  ButtonBase,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Drawer,
  FormControl,
  Grid,
  IconButton,
  InputLabel,
  LinearProgress,
  MenuItem,
  Pagination,
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
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
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
import AssignmentIndIcon from '@mui/icons-material/AssignmentInd';
import LogoutIcon from '@mui/icons-material/Logout';
import CloseIcon from '@mui/icons-material/Close';
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
import VideoPlayer from '../components/VideoPlayer';
import VideoCorrectionPanel, { VideoIssueComposer } from '../components/corrections/VideoCorrectionPanel';
import { UserContext } from '../contexts/UserContext';
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
  const { user } = useContext(UserContext);
  const theme = useTheme();
  const mobileLayout = useMediaQuery(theme.breakpoints.down('md'));
  const [activeView, setActiveView] = useState('work');
  const [workspace, setWorkspace] = useState(defaultWorkspace);
  const [duplicates, setDuplicates] = useState(defaultDuplicateWorkspace);
  const [overview, setOverview] = useState({});
  const [contentTypes, setContentTypes] = useState([]);
  const [archivists, setArchivists] = useState([]);
  const [filters, setFilters] = useState({
    reviewStatus: 'all',
    workflowStatus: 'all',
    contentTypeId: 'all',
    q: '',
    sortBy: 'uploadDate',
    sortOrder: 'desc',
    assignment: 'mine',
    attention: 'review',
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
  const [reviewDialog, setReviewDialog] = useState({
    open: false,
    video: null,
    status: 'needs_metadata',
    notes: '',
    warnings: [],
    overrideReason: '',
  });
  const [deleteDialog, setDeleteDialog] = useState({ open: false, video: null, keeper: null, reason: '' });
  const [correctionDialog, setCorrectionDialog] = useState({
    open: false,
    mode: 'dismiss',
    video: null,
    reason: '',
    busy: false,
  });
  const [selectedVideoId, setSelectedVideoId] = useState('');
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [playheadSeconds, setPlayheadSeconds] = useState(0);
  const [seekRequest, setSeekRequest] = useState(null);
  const [issueComposerOpen, setIssueComposerOpen] = useState(false);
  const [correctionContext, setCorrectionContext] = useState(null);
  const [claimBusy, setClaimBusy] = useState(false);
  const [duplicateKeepers, setDuplicateKeepers] = useState({});
  const correctionFetchSequence = useRef(0);
  const workspaceFetchSequence = useRef(0);

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
    const sequence = workspaceFetchSequence.current + 1;
    workspaceFetchSequence.current = sequence;
    if (!silent) setLoading(true);
    setErrorMessage('');

    axiosInstance
      .get('/archive/videos/workspace', {
        params: {
          page,
          limit: pageSize,
          reviewStatus: activeView === 'work' ? 'all' : filters.reviewStatus,
          workflowStatus: filters.workflowStatus,
          assignment: activeView === 'work' ? filters.assignment : 'all',
          attention: activeView === 'work' ? filters.attention : 'all',
          contentTypeId: filters.contentTypeId,
          q: getSearchParam(debouncedSearch),
          sortBy: filters.sortBy,
          sortOrder: filters.sortOrder,
        },
      })
      .then((response) => {
        if (workspaceFetchSequence.current !== sequence) return;
        const nextWorkspace = { ...defaultWorkspace, ...response.data };
        setWorkspace(nextWorkspace);
        setSelectedVideoId((current) => (
          nextWorkspace.items.some((item) => item._id === current)
            ? current
            : nextWorkspace.items[0]?._id || ''
        ));
      })
      .catch((error) => {
        if (workspaceFetchSequence.current !== sequence) return;
        console.error('Error loading archive workspace:', error);
        setErrorMessage(error.response?.data?.message || 'Arhiva nije ucitana.');
      })
      .finally(() => {
        if (workspaceFetchSequence.current === sequence) setLoading(false);
      });
  }, [activeView, debouncedSearch, filters, page]);

  const selectedVideo = useMemo(
    () => workspace.items.find((video) => video._id === selectedVideoId) || null,
    [selectedVideoId, workspace.items]
  );

  const fetchCorrectionContext = useCallback(() => {
    const sequence = correctionFetchSequence.current + 1;
    correctionFetchSequence.current = sequence;
    if (!selectedVideoId) {
      setCorrectionContext(null);
      return;
    }
    axiosInstance.get(`/corrections/video/${selectedVideoId}/context`)
      .then((response) => {
        if (correctionFetchSequence.current === sequence) setCorrectionContext(response.data || null);
      })
      .catch(() => {
        if (correctionFetchSequence.current === sequence) setCorrectionContext(null);
      });
  }, [selectedVideoId]);

  useEffect(() => {
    fetchCorrectionContext();
  }, [fetchCorrectionContext]);

  useEffect(() => {
    setPlayheadSeconds(0);
    setSeekRequest(null);
  }, [selectedVideoId]);

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

  const replaceWorkspaceVideo = useCallback((nextVideo) => {
    if (!nextVideo?._id) return;
    setWorkspace((current) => ({
      ...current,
      items: current.items.map((item) => item._id === nextVideo._id ? nextVideo : item),
    }));
  }, []);

  const fetchArchivists = useCallback(() => {
    axiosInstance.get('/archive/metadata-options')
      .then((response) => setArchivists(response.data?.archivists || []))
      .catch(() => setArchivists([]));
  }, []);

  const selectNextVideo = useCallback((videoId) => {
    const currentIndex = workspace.items.findIndex((item) => item._id === videoId);
    const next = workspace.items[currentIndex + 1] || workspace.items[currentIndex - 1] || null;
    setSelectedVideoId(next?._id || '');
    if (!next) setMobileDetailOpen(false);
  }, [workspace.items]);

  const selectedAssignmentId = selectedVideo?.archiveAssignedTo?._id || selectedVideo?.archiveAssignedTo;
  const selectedClaimActive = Boolean(
    selectedAssignmentId
    && selectedVideo?.archiveAssignmentExpiresAt
    && new Date(selectedVideo.archiveAssignmentExpiresAt).getTime() > Date.now()
  );
  const selectedClaimMine = selectedClaimActive && String(selectedAssignmentId) === String(user?.id);
  const canOperateSelected = user?.role === 'Admin' || selectedClaimMine;

  const claimSelectedVideo = async () => {
    if (!selectedVideo) return;
    setClaimBusy(true);
    setErrorMessage('');
    try {
      const response = await axiosInstance.patch(`/archive/videos/${selectedVideo._id}/claim`);
      replaceWorkspaceVideo(response.data.video);
      setMessage(response.data?.message || 'Materijal je preuzet.');
      fetchOverview();
    } catch (error) {
      setErrorMessage(error.response?.data?.message || 'Materijal nije moguće preuzeti.');
    } finally {
      setClaimBusy(false);
    }
  };

  const releaseSelectedVideo = async () => {
    if (!selectedVideo) return;
    setClaimBusy(true);
    setErrorMessage('');
    try {
      const response = await axiosInstance.patch(`/archive/videos/${selectedVideo._id}/release`);
      replaceWorkspaceVideo(response.data.video);
      setMessage(response.data?.message || 'Materijal je oslobođen.');
      if (activeView === 'work' && filters.assignment === 'mine') selectNextVideo(selectedVideo._id);
      fetchVideos({ silent: true });
      fetchOverview();
    } catch (error) {
      setErrorMessage(error.response?.data?.message || 'Materijal nije moguće osloboditi.');
    } finally {
      setClaimBusy(false);
    }
  };

  const assignSelectedVideo = async (assignedToId) => {
    if (!selectedVideo || user?.role !== 'Admin') return;
    setClaimBusy(true);
    setErrorMessage('');
    try {
      const response = await axiosInstance.patch(`/archive/videos/${selectedVideo._id}/assignment`, { assignedToId });
      replaceWorkspaceVideo(response.data.video);
      setMessage(response.data?.message || 'Zaduženje je ažurirano.');
      fetchOverview();
    } catch (error) {
      setErrorMessage(error.response?.data?.message || 'Zaduženje nije moguće ažurirati.');
    } finally {
      setClaimBusy(false);
    }
  };

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
        selectNextVideo(video._id);
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
    fetchArchivists();
  }, [fetchArchivists, fetchContentTypes, fetchOverview]);

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
      .then((response) => {
        replaceWorkspaceVideo(response.data.video);
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
      .then((response) => {
        replaceWorkspaceVideo(response.data.video);
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
      .then((response) => {
        replaceWorkspaceVideo(response.data.video);
        setMessage('Kategorija je sacuvana.');
        fetchOverview();
        fetchVideos({ silent: true });
      })
      .catch((error) => {
        console.error('Error saving content type:', error);
        setErrorMessage(error.response?.data?.message || 'Kategorija nije sacuvana.');
      });
  };

  const saveReview = (video, status, notes = '', overrideWarnings = false, overrideReason = '') => {
    if (!video) return;
    setMessage('');
    setErrorMessage('');

    axiosInstance
      .patch(`/archive/videos/${video._id}/review`, {
        status,
        notes,
        overrideWarnings,
        overrideReason,
      })
      .then((response) => {
        replaceWorkspaceVideo(response.data.video);
        setReviewDialog({ open: false, video: null, status: 'needs_metadata', notes: '', warnings: [], overrideReason: '' });
        setMessage('Pregled je sačuvan.');
        if (['reviewed', 'duplicate'].includes(status)) selectNextVideo(video._id);
        fetchOverview();
        fetchVideos({ silent: true });
      })
      .catch((error) => {
        console.error('Error saving review:', error);
        if (error.response?.data?.code === 'ARCHIVE_REVIEW_WARNINGS') {
          setReviewDialog({
            open: true,
            video,
            status,
            notes,
            warnings: error.response.data.warnings || [],
            overrideReason: '',
          });
          return;
        }
        setErrorMessage(error.response?.data?.message || 'Pregled nije sačuvan.');
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
    {
      label: 'Moj red',
      value: formatNumberBs(workspace.summary.mine ?? 0),
      color: 'primary.main',
      active: activeView === 'work' && filters.assignment === 'mine',
      onClick: () => { setActiveView('work'); setPage(1); setFilters((current) => ({ ...current, assignment: 'mine', attention: 'all' })); },
    },
    {
      label: 'Nepreuzeto',
      value: formatNumberBs(workspace.summary.unassigned ?? 0),
      color: 'warning.main',
      active: activeView === 'work' && filters.assignment === 'unassigned',
      onClick: () => { setActiveView('work'); setPage(1); setFilters((current) => ({ ...current, assignment: 'unassigned', attention: 'all' })); },
    },
    {
      label: 'Treba metadata',
      value: formatNumberBs(workspace.summary.needsMetadata ?? overview.needsMetadata ?? 0),
      color: 'info.main',
      active: activeView === 'work' && filters.attention === 'metadata',
      onClick: () => { setActiveView('work'); setPage(1); setFilters((current) => ({ ...current, assignment: 'all', attention: 'metadata' })); },
    },
    {
      label: 'U montaži',
      value: formatNumberBs(workspace.summary.inEdit ?? 0),
      color: 'error.main',
      active: activeView === 'work' && filters.attention === 'in_edit',
      onClick: () => { setActiveView('work'); setPage(1); setFilters((current) => ({ ...current, assignment: 'all', attention: 'in_edit' })); },
    },
    {
      label: 'Spremno za potvrdu',
      value: formatNumberBs(workspace.summary.readyForReview ?? 0),
      color: 'success.main',
      active: activeView === 'work' && filters.attention === 'ready_for_review',
      onClick: () => { setActiveView('work'); setPage(1); setFilters((current) => ({ ...current, assignment: 'all', attention: 'ready_for_review' })); },
    },
    {
      label: activeView === 'duplicates' ? 'Grupe duplikata' : 'Označeni duplikati',
      value: formatNumberBs(overview.duplicateCandidateGroups ?? duplicates.summary.groups ?? 0),
      color: 'error.main',
      active: activeView === 'duplicates',
      onClick: () => { setActiveView('duplicates'); setDuplicatePage(1); },
    },
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

  const renderSelectedDetail = (mobile = false) => {
    if (!selectedVideo) {
      return <EmptyState title="Odaberite materijal" description="Detalji i preview prikazuju se nakon izbora iz radnog reda." />;
    }
    const requestStatus = correctionContext?.active?.status;
    const metadataWarnings = [
      !selectedVideo.finalTitle && 'naslov',
      !selectedVideo.tagDate && 'datum',
      !selectedVideo.contentType && !selectedVideo.finalCategory && 'kategorija',
      !selectedVideo.event && 'event',
      !selectedVideo.reporter && !selectedVideo.uploader && 'autor',
      (!selectedVideo.keywords || selectedVideo.keywords.length === 0) && 'tagovi',
    ].filter(Boolean);

    return (
      <Stack spacing={1.5} sx={{ p: mobile ? 2 : 0 }}>
        {mobile && (
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Typography variant="h6" sx={{ fontWeight: 850 }}>Pregled materijala</Typography>
            <IconButton onClick={() => setMobileDetailOpen(false)} aria-label="Zatvori pregled"><CloseIcon /></IconButton>
          </Stack>
        )}

        <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 1.5 }}>
          <Stack direction="row" justifyContent="space-between" spacing={1} alignItems="flex-start" sx={{ mb: 1 }}>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="h6" sx={{ fontWeight: 900, overflowWrap: 'anywhere' }}>{getVideoTitle(selectedVideo)}</Typography>
              <Typography variant="caption" color="text.secondary">
                {selectedVideo.event || 'Bez eventa'} / {formatDateTimeBs(selectedVideo.tagDate || selectedVideo.uploadDate)}
              </Typography>
            </Box>
            <Tooltip title="Otvori puni pregled">
              <IconButton component={Link} to={`/video-details/${selectedVideo._id}`}><OpenInNewIcon /></IconButton>
            </Tooltip>
          </Stack>
          <VideoPlayer
            key={selectedVideo._id}
            videoId={selectedVideo._id}
            compact
            readOnly
            onPlaybackPositionChange={setPlayheadSeconds}
            seekRequest={seekRequest}
          />
        </Paper>

        <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 1.5 }}>
          <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
            <StatusChip value={selectedVideo.archiveReviewStatus || 'unreviewed'} maps={archiveReviewLabels} />
            <StatusChip value={selectedVideo.processingStatus} maps={processingLabels} variant="outlined" />
            {selectedVideo.broadcastStatus && <StatusChip value={selectedVideo.broadcastStatus} maps={broadcastLabels} variant="outlined" />}
          </Stack>

          {selectedClaimActive ? (
            <Alert severity={selectedClaimMine ? 'info' : 'warning'} sx={{ mb: 1 }}>
              Preuzeo: {selectedVideo.archiveAssignedTo?.username || 'arhivista'} / do {formatDateTimeBs(selectedVideo.archiveAssignmentExpiresAt)}
            </Alert>
          ) : (
            <Alert severity="info" sx={{ mb: 1 }}>Materijal trenutno nije preuzet.</Alert>
          )}

          {user?.role === 'Admin' && (
            <FormControl fullWidth size="small" sx={{ mb: 1 }}>
              <InputLabel>Dodijeli arhivisti</InputLabel>
              <Select
                value={selectedClaimActive ? selectedAssignmentId || '' : ''}
                label="Dodijeli arhivisti"
                onChange={(event) => assignSelectedVideo(event.target.value)}
                disabled={claimBusy}
              >
                <MenuItem value="">Oslobodi zaduženje</MenuItem>
                {archivists.map((archivist) => (
                  <MenuItem key={archivist._id} value={archivist._id}>{archivist.username}</MenuItem>
                ))}
              </Select>
            </FormControl>
          )}

          {metadataWarnings.length > 0 && (
            <Alert severity="warning" variant="outlined" sx={{ mb: 1 }}>
              Nedostaje: {metadataWarnings.join(', ')}.
            </Alert>
          )}

          <Grid container spacing={1}>
            <Grid item xs={6}><Typography variant="caption" color="text.secondary">Kategorija</Typography><Typography variant="body2" sx={{ fontWeight: 750 }}>{selectedVideo.contentType?.name || selectedVideo.finalCategory || 'Nije unesena'}</Typography></Grid>
            <Grid item xs={6}><Typography variant="caption" color="text.secondary">Reporter</Typography><Typography variant="body2" sx={{ fontWeight: 750 }}>{getPersonName(selectedVideo.reporter)}</Typography></Grid>
            <Grid item xs={6}><Typography variant="caption" color="text.secondary">Montažer</Typography><Typography variant="body2" sx={{ fontWeight: 750 }}>{getPersonName(selectedVideo.editor)}</Typography></Grid>
            <Grid item xs={6}><Typography variant="caption" color="text.secondary">Veličina</Typography><Typography variant="body2" sx={{ fontWeight: 750 }}>{formatBytesBs(selectedVideo.sizeCompressed || selectedVideo.sizeOriginal || selectedVideo.sizePreview)}</Typography></Grid>
          </Grid>

          <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 1.5 }}>
            {!canOperateSelected && user?.role !== 'Admin' && (
              <Button variant="contained" startIcon={<AssignmentIndIcon />} onClick={claimSelectedVideo} disabled={claimBusy || (selectedClaimActive && !selectedClaimMine)}>
                Preuzmi
              </Button>
            )}
            {canOperateSelected && user?.role !== 'Admin' && (
              <Button variant="outlined" startIcon={<LogoutIcon />} onClick={releaseSelectedVideo} disabled={claimBusy}>Oslobodi</Button>
            )}
            <Button variant="outlined" startIcon={<EditNoteIcon />} onClick={() => openMetadataDialog(selectedVideo)} disabled={!canOperateSelected}>Uredi metadata</Button>
            <Button
              variant="outlined"
              color="warning"
              onClick={() => setReviewDialog({ open: true, video: selectedVideo, status: 'needs_metadata', notes: selectedVideo.archiveReviewNotes || '', warnings: [], overrideReason: '' })}
              disabled={!canOperateSelected}
            >
              Treba metadata
            </Button>
            <Button variant="contained" startIcon={<DoneAllIcon />} onClick={() => saveReview(selectedVideo, 'reviewed', selectedVideo.archiveReviewNotes || '')} disabled={!canOperateSelected}>
              Pregledano
            </Button>
          </Stack>
        </Paper>

        <VideoCorrectionPanel
          context={correctionContext}
          onTimestamp={(seconds) => {
            setPlayheadSeconds(seconds);
            setSeekRequest({ seconds, key: Date.now() });
          }}
          onReport={() => setIssueComposerOpen(true)}
          reportDisabled={!canOperateSelected}
        />

        {correctionContext?.active && ['reported', 'assigned'].includes(requestStatus) && (
          <Button
            variant="outlined"
            color="error"
            onClick={() => setCorrectionDialog({ open: true, mode: 'dismiss', video: selectedVideo, reason: '', busy: false })}
            disabled={!canOperateSelected}
          >
            Povuci oznaku ispravke
          </Button>
        )}

        {requestStatus === 'ready_for_review' && (
          <Button
            variant="contained"
            color="success"
            onClick={() => setCorrectionDialog({ open: true, mode: 'resolve', video: selectedVideo, reason: '', busy: false })}
            disabled={!canOperateSelected}
          >
            Potvrdi završenu ispravku
          </Button>
        )}
      </Stack>
    );
  };

  const renderVideoTable = () => (
    <Box>
      {loading && <LinearProgress sx={{ mb: 1 }} />}
      {workspace.items.length === 0 && !loading ? (
        <EmptyState
          title="Nema materijala u ovom redu"
          description="Promijenite scope ili attention filter i pokušajte ponovo."
          action={<Button variant="outlined" startIcon={<RefreshIcon />} onClick={refreshCurrentView}>Osvježi</Button>}
        />
      ) : (
        <Grid container spacing={2} alignItems="flex-start">
          <Grid item xs={12} md={5} lg={4}>
            <Paper variant="outlined" sx={{ borderRadius: 1.5, overflow: 'hidden' }}>
              <Box
                tabIndex={0}
                onKeyDown={(event) => {
                  if (!['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) return;
                  event.preventDefault();
                  const currentIndex = Math.max(workspace.items.findIndex((item) => item._id === selectedVideoId), 0);
                  const nextIndex = event.key === 'ArrowDown'
                    ? Math.min(currentIndex + 1, workspace.items.length - 1)
                    : event.key === 'ArrowUp'
                      ? Math.max(currentIndex - 1, 0)
                      : currentIndex;
                  const nextVideo = workspace.items[nextIndex];
                  if (nextVideo) setSelectedVideoId(nextVideo._id);
                  if (event.key === 'Enter' && mobileLayout) setMobileDetailOpen(true);
                }}
                sx={{ maxHeight: { md: 'calc(100vh - 330px)' }, overflowY: 'auto', outline: 'none' }}
              >
                {workspace.items.map((video) => {
                  const assignedTo = video.archiveAssignedTo?.username;
                  const selected = video._id === selectedVideoId;
                  return (
                    <ButtonBase
                      key={video._id}
                      onClick={() => {
                        setSelectedVideoId(video._id);
                        setCorrectionContext(null);
                        setPlayheadSeconds(0);
                        setSeekRequest(null);
                        if (mobileLayout) setMobileDetailOpen(true);
                      }}
                      sx={{
                        width: '100%',
                        p: 1.25,
                        textAlign: 'left',
                        alignItems: 'flex-start',
                        borderBottom: 1,
                        borderColor: 'divider',
                        bgcolor: selected ? 'action.selected' : 'background.paper',
                        '&:hover': { bgcolor: 'action.hover' },
                      }}
                    >
                      <Stack direction="row" spacing={1.25} sx={{ width: '100%', minWidth: 0 }}>
                        <VideoThumbnailPreview videoId={video._id} title={getVideoTitle(video)} width={112} height={63} enableScrubPreview />
                        <Box sx={{ minWidth: 0, flex: 1 }}>
                          <Typography variant="body2" sx={{ fontWeight: 850 }} noWrap>{getVideoTitle(video)}</Typography>
                          <Typography variant="caption" color="text.secondary" display="block" noWrap>{video.event || 'Bez eventa'}</Typography>
                          <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
                            <StatusChip value={video.archiveReviewStatus || 'unreviewed'} maps={archiveReviewLabels} size="small" />
                            {video.correctionStatus === 'needs_correction' && <StatusChip label="Ispravka" tone="error" size="small" />}
                          </Stack>
                          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                            {assignedTo ? `Arhivista: ${assignedTo}` : 'Nepreuzeto'}
                          </Typography>
                        </Box>
                      </Stack>
                    </ButtonBase>
                  );
                })}
              </Box>
            </Paper>
          </Grid>
          {!mobileLayout && (
            <Grid item md={7} lg={8}>
              <Box sx={{ position: 'sticky', top: 16 }}>{renderSelectedDetail()}</Box>
            </Grid>
          )}
        </Grid>
      )}
      {workspace.totalPages > 1 && (
        <Stack alignItems="center" sx={{ mt: 2 }}>
          <Pagination count={workspace.totalPages} page={page} onChange={(event, value) => setPage(value)} />
        </Stack>
      )}
      <Drawer
        anchor="right"
        open={mobileLayout && mobileDetailOpen}
        onClose={() => setMobileDetailOpen(false)}
        PaperProps={{ sx: { width: '100%', maxWidth: 680 } }}
      >
        {renderSelectedDetail(true)}
      </Drawer>
    </Box>
  );

  const renderDuplicates = () => (
    <Stack spacing={2}>
      {duplicatesLoading && <LinearProgress />}
      {duplicates.items.map((group, groupIndex) => {
        const keeperId = duplicateKeepers[group.key] || group.videos?.[0]?._id;
        const keeper = group.videos?.find((video) => video._id === keeperId) || group.videos?.[0];
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
                            <Button
                              size="small"
                              variant={isKeeper ? 'contained' : 'outlined'}
                              color="success"
                              onClick={() => setDuplicateKeepers((current) => ({ ...current, [group.key]: video._id }))}
                            >
                              {isKeeper ? 'Zadržava se' : 'Zadrži'}
                            </Button>
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
          { label: 'Prikaz', value: activeView === 'work' ? 'Radni red' : activeView === 'duplicates' ? 'Duplikati' : 'Pretraga arhive' },
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
              variant={activeView === 'work' ? 'contained' : 'outlined'}
              startIcon={<ReportProblemIcon />}
              onClick={(event) => handleViewChange(event, 'work')}
            >
              Radni red
            </Button>
            <Button
              variant={activeView === 'archive' ? 'contained' : 'outlined'}
              startIcon={<FindReplaceIcon />}
              onClick={(event) => handleViewChange(event, 'archive')}
            >
              Pretraga arhive
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
          {activeView === 'work' && (
            <>
              <Grid item xs={12} sm={6} md={2}>
                <FormControl fullWidth size="small">
                  <InputLabel>Scope</InputLabel>
                  <Select name="assignment" value={filters.assignment} label="Scope" onChange={handleFilterChange}>
                    <MenuItem value="mine">Moj red</MenuItem>
                    <MenuItem value="unassigned">Nepreuzeto</MenuItem>
                    <MenuItem value="all">Sve aktivno</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} sm={6} md={2}>
                <FormControl fullWidth size="small">
                  <InputLabel>Pažnja</InputLabel>
                  <Select name="attention" value={filters.attention} label="Pažnja" onChange={handleFilterChange}>
                    <MenuItem value="all">Sve</MenuItem>
                    <MenuItem value="review">Za pregled</MenuItem>
                    <MenuItem value="metadata">Treba metadata</MenuItem>
                    <MenuItem value="in_edit">U montaži</MenuItem>
                    <MenuItem value="ready_for_review">Spremno za potvrdu</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
            </>
          )}
          {activeView === 'archive' && (
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
          <Grid item xs={12} md={activeView === 'duplicates' ? 6 : activeView === 'work' ? 2 : 3}>
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

      <VideoIssueComposer
        open={issueComposerOpen}
        video={selectedVideo}
        playheadSeconds={playheadSeconds}
        correctionContext={correctionContext}
        onClose={() => setIssueComposerOpen(false)}
        onSubmitted={(result) => {
          setMessage(result?.message || 'Greške su poslane u montažu.');
          if (selectedVideo) selectNextVideo(selectedVideo._id);
          fetchCorrectionContext();
          fetchOverview();
          fetchVideos({ silent: true });
        }}
        onMetadataIssue={() => {
          setIssueComposerOpen(false);
          if (selectedVideo) {
            saveReview(
              selectedVideo,
              'needs_metadata',
              selectedVideo.archiveReviewNotes || 'Potrebna je dopuna metadata podataka.'
            );
            openMetadataDialog(selectedVideo);
          }
        }}
      />

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

      <Dialog open={reviewDialog.open} onClose={() => setReviewDialog({ open: false, video: null, status: 'needs_metadata', notes: '', warnings: [], overrideReason: '' })} fullWidth maxWidth="sm">
        <DialogTitle>Arhivistički pregled</DialogTitle>
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
            label="Bilješka"
            value={reviewDialog.notes}
            onChange={(event) => setReviewDialog((state) => ({ ...state, notes: event.target.value }))}
            fullWidth
            multiline
            minRows={3}
          />
          {(reviewDialog.warnings || []).length > 0 && (
            <Alert severity="warning" sx={{ mt: 2 }}>
              <Typography variant="body2" sx={{ fontWeight: 800 }}>Pregled ima upozorenja:</Typography>
              {(reviewDialog.warnings || []).map((warning) => (
                <Typography key={warning.code} variant="body2">• {warning.label}</Typography>
              ))}
            </Alert>
          )}
          {(reviewDialog.warnings || []).length > 0 && (
            <TextField
              label="Obrazloženje završetka"
              value={reviewDialog.overrideReason || ''}
              onChange={(event) => setReviewDialog((state) => ({ ...state, overrideReason: event.target.value }))}
              fullWidth
              multiline
              minRows={2}
              required
              sx={{ mt: 2 }}
            />
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setReviewDialog({ open: false, video: null, status: 'needs_metadata', notes: '', warnings: [], overrideReason: '' })}>Odustani</Button>
          <Button
            variant="contained"
            startIcon={<SaveIcon />}
            disabled={(reviewDialog.warnings || []).length > 0 && (reviewDialog.overrideReason || '').trim().length < 3}
            onClick={() => saveReview(
              reviewDialog.video,
              reviewDialog.status,
              reviewDialog.notes,
              (reviewDialog.warnings || []).length > 0,
              reviewDialog.overrideReason
            )}
          >
            {(reviewDialog.warnings || []).length > 0 ? 'Završi ipak' : 'Sačuvaj'}
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
