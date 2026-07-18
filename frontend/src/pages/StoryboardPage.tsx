import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  Paper,
  Slider,
  Stack,
  Step,
  StepLabel,
  Stepper,
  TextField,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import RefreshIcon from '@mui/icons-material/Refresh';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import SaveIcon from '@mui/icons-material/Save';
import axiosInstance from '../axiosConfig';
import { UserContext } from '../contexts/UserContext';
import VideoThumbnailPreview from '../components/common/VideoThumbnailPreview';
import {
  ConfirmDialog,
  EmptyState,
  StatusChip,
  WorkspaceHeader,
} from '../components/common/WorkspaceChrome';

type JobVideo = {
  _id: string;
  filename?: string;
  originalFilename?: string;
  event?: string;
  location?: string;
  duration?: number;
};

type JobSegment = {
  _id?: string;
  video?: JobVideo;
  startTime?: number;
  endTime?: number;
  notes?: string;
};

type StoryboardItem = {
  id?: string;
  clientKey: string;
  videoId: string;
  video: JobVideo;
  inMs: number;
  outMs: number;
  order: number;
  note: string;
};

type RoughCut = {
  version: number;
  status: 'draft' | 'submitted' | 'locked' | 'superseded';
  durationMs: number;
  items: Array<Omit<StoryboardItem, 'clientKey'>>;
  updatedAt?: string;
};

const FRAME_MS = 40;
const workflowSteps = ['Redoslijed klipova', 'Rezovi i napomene', 'Spremno za montažu'];
const statusLabels: Record<RoughCut['status'], string> = {
  draft: 'Nacrt',
  submitted: 'Poslano montaži',
  locked: 'Zaključano',
  superseded: 'Zamijenjena verzija',
};

const toMilliseconds = (value: unknown) => Math.max(0, Math.round(Number(value || 0) * 1000));
const clamp = (value: number, minimum: number, maximum: number) => (
  Math.min(maximum, Math.max(minimum, value))
);

const formatTime = (milliseconds: number) => {
  const safeMs = Math.max(0, Math.round(milliseconds || 0));
  const totalSeconds = Math.floor(safeMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const frames = Math.min(24, Math.floor((safeMs % 1000) / FRAME_MS));
  return [hours, minutes, seconds, frames].map((value) => String(value).padStart(2, '0')).join(':');
};

const formatSavedAt = (value?: string) => {
  if (!value) return 'Još nije sačuvano';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Sačuvano';
  return new Intl.DateTimeFormat('bs-BA', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date);
};

const withClientKeys = (items: Array<Omit<StoryboardItem, 'clientKey'> | StoryboardItem>) => (
  items.map((item, index) => ({
    ...item,
    clientKey: 'clientKey' in item && item.clientKey
      ? item.clientKey
      : item.id || `${item.videoId}-${index}`,
    order: index,
  })) as StoryboardItem[]
);

type TimeFieldProps = {
  label: string;
  valueMs: number;
  maximumMs: number;
  disabled: boolean;
  onCommit: (valueMs: number) => void;
};

const TimeField = ({ label, valueMs, maximumMs, disabled, onCommit }: TimeFieldProps) => {
  const [value, setValue] = useState((valueMs / 1000).toFixed(2));

  useEffect(() => {
    setValue((valueMs / 1000).toFixed(2));
  }, [valueMs]);

  const commit = () => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      setValue((valueMs / 1000).toFixed(2));
      return;
    }
    onCommit(clamp(Math.round(parsed * 1000), 0, maximumMs));
  };

  return (
    <TextField
      label={label}
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.querySelector('input')?.blur();
      }}
      disabled={disabled}
      type="number"
      size="small"
      helperText={formatTime(valueMs)}
      slotProps={{
        htmlInput: {
          min: 0,
          max: maximumMs / 1000,
          step: FRAME_MS / 1000,
        },
      }}
    />
  );
};

const StoryboardPage = () => {
  const { jobId = '' } = useParams();
  const { user } = useContext(UserContext);
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const [job, setJob] = useState<any>(null);
  const [items, setItems] = useState<StoryboardItem[]>([]);
  const [selectedKey, setSelectedKey] = useState('');
  const [version, setVersion] = useState(0);
  const [status, setStatus] = useState<RoughCut['status']>('draft');
  const [lastSavedAt, setLastSavedAt] = useState<string | undefined>();
  const [editable, setEditable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitDialogOpen, setSubmitDialogOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const mountedRef = useRef(true);
  const editRevisionRef = useRef(0);
  const savePromiseRef = useRef<Promise<number> | null>(null);

  useEffect(() => () => {
    mountedRef.current = false;
  }, []);

  useEffect(() => {
    if (!dirty) return undefined;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [dirty]);

  const buildInitialItems = useCallback((segments: JobSegment[]) => withClientKeys(
    (segments || [])
      .filter((segment) => segment.video?._id)
      .map((segment, index) => {
        const video = segment.video as JobVideo;
        const durationMs = Math.max(toMilliseconds(video.duration), 1000);
        const inMs = Math.min(toMilliseconds(segment.startTime), durationMs - FRAME_MS);
        const requestedOut = segment.endTime != null ? toMilliseconds(segment.endTime) : durationMs;
        const outMs = Math.max(inMs + FRAME_MS, Math.min(requestedOut || durationMs, durationMs));
        return {
          id: segment._id,
          videoId: video._id,
          video,
          inMs,
          outMs,
          order: index,
          note: segment.notes || '',
        };
      })
  ), []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    setConflict(false);
    try {
      const [jobResponse, roughCutResponse] = await Promise.all([
        axiosInstance.get(`/edit-jobs/${jobId}`),
        axiosInstance.get(`/v2/edit-jobs/${jobId}/rough-cut`),
      ]);
      const nextJob = jobResponse.data;
      const roughCut = roughCutResponse.data?.roughCut as RoughCut | null;
      const nextItems = roughCut?.items?.length
        ? withClientKeys(roughCut.items)
        : buildInitialItems(nextJob.segments);
      setJob(nextJob);
      setEditable(Boolean(roughCutResponse.data?.permissions?.edit));
      setVersion(roughCut?.version || 0);
      setStatus(roughCut?.status || 'draft');
      setLastSavedAt(roughCut?.updatedAt);
      setItems(nextItems);
      setSelectedKey((current) => (
        nextItems.some((item) => item.clientKey === current) ? current : nextItems[0]?.clientKey || ''
      ));
      editRevisionRef.current = 0;
      setDirty(false);
      setMessage('');
    } catch (requestError: any) {
      setError(requestError.response?.data?.message || 'Storyboard se ne može učitati.');
    } finally {
      setLoading(false);
    }
  }, [buildInitialItems, jobId]);

  useEffect(() => {
    load();
  }, [load]);

  const saveDraft = useCallback(async (force = false) => {
    if (!editable || conflict) return version;
    if (savePromiseRef.current) return savePromiseRef.current;
    if (!force && !dirty) return version;

    setSaving(true);
    setError('');
    const savedRevision = editRevisionRef.current;
    const request = axiosInstance.put(`/v2/edit-jobs/${jobId}/rough-cut`, {
      version,
      items: items.map(({ videoId, inMs, outMs, order, note }) => ({
        videoId,
        inMs,
        outMs,
        order,
        note,
      })),
    }).then((response) => {
      const nextVersion = Number(response.data?.roughCut?.version || version);
      if (mountedRef.current) {
        const unchangedSinceRequest = editRevisionRef.current === savedRevision;
        setVersion(nextVersion);
        setStatus(response.data?.roughCut?.status || 'draft');
        setLastSavedAt(response.data?.roughCut?.updatedAt || new Date().toISOString());
        setDirty(!unchangedSinceRequest);
        setMessage(unchangedSinceRequest ? 'Sve promjene su sačuvane.' : 'Čuvam i novije izmjene...');
      }
      return nextVersion;
    }).catch((requestError) => {
      if (mountedRef.current) {
        if (requestError.response?.status === 409) setConflict(true);
        setError(requestError.response?.data?.message || 'Storyboard se ne može sačuvati.');
      }
      throw requestError;
    }).finally(() => {
      if (mountedRef.current) setSaving(false);
      savePromiseRef.current = null;
    });
    savePromiseRef.current = request;
    return request;
  }, [conflict, dirty, editable, items, jobId, version]);

  useEffect(() => {
    if (!dirty || !editable || conflict || saving) return undefined;
    const timer = window.setTimeout(() => {
      saveDraft().catch(() => {});
    }, 900);
    return () => window.clearTimeout(timer);
  }, [conflict, dirty, editable, saveDraft, saving]);

  const markChanged = () => {
    editRevisionRef.current += 1;
    setDirty(true);
    setMessage('');
  };

  const mutateItem = (clientKey: string, patch: Partial<StoryboardItem>) => {
    setItems((current) => current.map((item) => (
      item.clientKey === clientKey ? { ...item, ...patch } : item
    )));
    markChanged();
  };

  const moveItem = (clientKey: string, direction: -1 | 1) => {
    setItems((current) => {
      const index = current.findIndex((item) => item.clientKey === clientKey);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.length) return current;
      const next = current.slice();
      [next[index], next[target]] = [next[target], next[index]];
      return next.map((item, itemIndex) => ({ ...item, order: itemIndex }));
    });
    markChanged();
  };

  const submit = async () => {
    setSubmitting(true);
    setError('');
    try {
      let submittedVersion = version;
      if (dirty || !submittedVersion) submittedVersion = await saveDraft(true);
      if (!submittedVersion) {
        setError('Storyboard se prvo mora sačuvati.');
        return;
      }
      const response = await axiosInstance.post(`/v2/edit-jobs/${jobId}/rough-cut/submit`, {
        version: submittedVersion,
      });
      setStatus(response.data?.roughCut?.status || 'submitted');
      setLastSavedAt(response.data?.roughCut?.updatedAt || new Date().toISOString());
      setMessage('Storyboard je poslan montaži. Montažer je dobio notifikaciju.');
      setSubmitDialogOpen(false);
    } catch (requestError: any) {
      if (requestError.response?.status === 409) setConflict(true);
      setError(requestError.response?.data?.message || 'Storyboard se ne može poslati.');
    } finally {
      setSubmitting(false);
    }
  };

  const selectedIndex = useMemo(
    () => items.findIndex((item) => item.clientKey === selectedKey),
    [items, selectedKey]
  );
  const selectedItem = selectedIndex >= 0 ? items[selectedIndex] : null;
  const selectedMaximumMs = selectedItem
    ? Math.max(toMilliseconds(selectedItem.video.duration), selectedItem.outMs, 1000)
    : 1000;
  const durationMs = useMemo(
    () => items.reduce((sum, item) => sum + Math.max(0, item.outMs - item.inMs), 0),
    [items]
  );
  const notesCount = useMemo(
    () => items.filter((item) => item.note.trim()).length,
    [items]
  );
  const workflowStep = status === 'submitted' || status === 'locked'
    ? workflowSteps.length
    : version > 0 || dirty
      ? 1
      : 0;

  if (loading) {
    return <Box sx={{ minHeight: '60vh', display: 'grid', placeItems: 'center' }}><CircularProgress /></Box>;
  }

  return (
    <Box sx={{ p: { xs: 1.5, md: 3 }, minHeight: '100vh', bgcolor: 'background.default' }}>
      <WorkspaceHeader
        eyebrow="Priprema montaže"
        title={job?.title ? `Storyboard: ${job.title}` : 'Storyboard'}
        subtitle="Reporterski redoslijed klipova, rezovi i napomene za montažu."
        chips={[
          { label: 'Verzija', value: version || 'novi nacrt' },
          { label: 'Status', value: statusLabels[status] },
          { label: 'Trajanje', value: formatTime(durationMs) },
        ]}
        actions={(
          <>
            <Button component={Link} to={`/edit-jobs/${jobId}`} variant="outlined" startIcon={<ArrowBackIcon />}>
              Job
            </Button>
            <Tooltip title="Učitaj podatke sa servera">
              <IconButton onClick={load} aria-label="Osvježi Storyboard">
                <RefreshIcon />
              </IconButton>
            </Tooltip>
            {editable && (
              <Button
                startIcon={<SaveIcon />}
                onClick={() => saveDraft(true).catch(() => {})}
                disabled={saving || conflict || items.length === 0 || (!dirty && version > 0)}
              >
                {saving ? 'Čuvam...' : 'Sačuvaj'}
              </Button>
            )}
            {editable && (
              <Button
                startIcon={<CheckCircleOutlineIcon />}
                onClick={() => setSubmitDialogOpen(true)}
                variant="contained"
                disabled={saving || submitting || conflict || items.length === 0}
              >
                Pošalji montaži
              </Button>
            )}
          </>
        )}
      />

      <Paper variant="outlined" sx={{ px: { xs: 1.5, md: 3 }, py: 1.5, mb: 2, borderRadius: 1.5 }}>
        <Stepper activeStep={workflowStep} orientation={isMobile ? 'vertical' : 'horizontal'}>
          {workflowSteps.map((step) => (
            <Step key={step}><StepLabel>{step}</StepLabel></Step>
          ))}
        </Stepper>
      </Paper>

      {!editable && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Storyboard je otvoren za pregled. Originalne sirovine i dalje su dostupne u detaljima joba.
        </Alert>
      )}
      {editable && status === 'submitted' && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Ova verzija je već poslana montaži. Nova promjena će napraviti sljedeću draft verziju.
        </Alert>
      )}
      {conflict && (
        <Alert
          severity="warning"
          action={<Button color="inherit" size="small" onClick={load}>Učitaj novu verziju</Button>}
          sx={{ mb: 2 }}
        >
          Drugi uređaj je sačuvao noviju verziju. Tvoje promjene nisu prepisale server.
        </Alert>
      )}
      {message && <Alert severity="success" sx={{ mb: 2 }}>{message}</Alert>}
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {items.length === 0 ? (
        <EmptyState title="Job nema video klipova" description="Dodaj sirovine u job pa ponovo otvori Storyboard." />
      ) : (
        <>
          <Paper variant="outlined" sx={{ p: 1.5, mb: 2, borderRadius: 1.5 }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 900 }}>Pregled cjeline</Typography>
              <Stack direction="row" spacing={0.75}>
                <Chip size="small" label={`${items.length} klipova`} variant="outlined" />
                <Chip size="small" label={`${notesCount} napomena`} variant="outlined" />
              </Stack>
            </Stack>
            <Stack direction="row" spacing={0.5} sx={{ overflowX: 'auto', pb: 0.25 }}>
              {items.map((item, index) => (
                <ButtonBase
                  key={item.clientKey}
                  onClick={() => setSelectedKey(item.clientKey)}
                  aria-label={`Otvori klip ${index + 1}`}
                  sx={{
                    flex: `${Math.max(item.outMs - item.inMs, 1000)} 1 0`,
                    minWidth: 48,
                    maxWidth: 180,
                    height: 38,
                    borderRadius: 1,
                    bgcolor: item.clientKey === selectedKey ? 'primary.main' : 'grey.100',
                    color: item.clientKey === selectedKey ? 'primary.contrastText' : 'text.primary',
                    border: 1,
                    borderColor: item.clientKey === selectedKey ? 'primary.main' : 'divider',
                    fontWeight: 900,
                  }}
                >
                  {index + 1}
                </ButtonBase>
              ))}
            </Stack>
          </Paper>

          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'minmax(300px, 0.82fr) minmax(0, 1.45fr)' },
              gap: 2,
              alignItems: 'start',
            }}
          >
            <Paper variant="outlined" sx={{ borderRadius: 1.5, overflow: 'hidden' }}>
              <Box sx={{ px: 1.5, py: 1.25, borderBottom: 1, borderColor: 'divider' }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 900 }}>Redoslijed</Typography>
                <Typography variant="caption" color="text.secondary">
                  {items.length} klipova / {formatTime(durationMs)}
                </Typography>
              </Box>
              <Stack
                divider={<Divider flexItem />}
                sx={{ maxHeight: { md: 'calc(100vh - 390px)' }, minHeight: { md: 360 }, overflowY: 'auto' }}
              >
                {items.map((item, index) => {
                  const selected = item.clientKey === selectedKey;
                  return (
                    <Box
                      key={item.clientKey}
                      role="button"
                      tabIndex={0}
                      aria-pressed={selected}
                      onClick={() => setSelectedKey(item.clientKey)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          setSelectedKey(item.clientKey);
                        }
                      }}
                      sx={{
                        display: 'grid',
                        gridTemplateColumns: '32px 80px minmax(0, 1fr) 36px',
                        gap: 1,
                        alignItems: 'center',
                        p: 1,
                        cursor: 'pointer',
                        bgcolor: selected ? 'action.selected' : 'background.paper',
                        borderLeft: 3,
                        borderLeftColor: selected ? 'primary.main' : 'transparent',
                        '&:hover': { bgcolor: selected ? 'action.selected' : 'action.hover' },
                        '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2 },
                      }}
                    >
                      <Typography variant="subtitle2" sx={{ fontWeight: 900, textAlign: 'center' }}>{index + 1}</Typography>
                      <VideoThumbnailPreview
                        videoId={item.videoId}
                        title={item.video.originalFilename || item.video.filename || 'Video'}
                        width={80}
                        height={45}
                        enableScrubPreview
                      />
                      <Box sx={{ minWidth: 0 }}>
                        <Typography variant="body2" sx={{ fontWeight: 850 }} noWrap>
                          {item.video.originalFilename || item.video.filename || 'Video materijal'}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" component="div" noWrap>
                          {formatTime(item.outMs - item.inMs)}
                          {item.note.trim() ? ' / napomena' : ''}
                        </Typography>
                      </Box>
                      {editable && (
                        <Stack spacing={0.1}>
                          <Tooltip title="Pomjeri gore">
                            <span>
                              <IconButton
                                size="small"
                                onClick={(event) => { event.stopPropagation(); moveItem(item.clientKey, -1); }}
                                disabled={index === 0}
                                aria-label={`Pomjeri klip ${index + 1} gore`}
                              >
                                <ArrowUpwardIcon fontSize="small" />
                              </IconButton>
                            </span>
                          </Tooltip>
                          <Tooltip title="Pomjeri dolje">
                            <span>
                              <IconButton
                                size="small"
                                onClick={(event) => { event.stopPropagation(); moveItem(item.clientKey, 1); }}
                                disabled={index === items.length - 1}
                                aria-label={`Pomjeri klip ${index + 1} dolje`}
                              >
                                <ArrowDownwardIcon fontSize="small" />
                              </IconButton>
                            </span>
                          </Tooltip>
                        </Stack>
                      )}
                    </Box>
                  );
                })}
              </Stack>
            </Paper>

            {selectedItem && (
              <Paper
                variant="outlined"
                sx={{
                  p: { xs: 1.5, md: 2 },
                  borderRadius: 1.5,
                  position: { md: 'sticky' },
                  top: { md: 112 },
                }}
              >
                <Stack direction="row" spacing={1} alignItems="flex-start" sx={{ mb: 1.5 }}>
                  <Chip label={selectedIndex + 1} color="primary" size="small" sx={{ fontWeight: 900 }} />
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 900 }} noWrap>
                      {selectedItem.video.originalFilename || selectedItem.video.filename || 'Video materijal'}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" component="div" noWrap>
                      {[selectedItem.video.event, selectedItem.video.location].filter(Boolean).join(' / ') || 'Bez dodatnih podataka'}
                    </Typography>
                  </Box>
                  <Tooltip title="Otvori puni video pregled">
                    <IconButton
                      component={Link}
                      to={`/video-details/${selectedItem.videoId}?start=${selectedItem.inMs / 1000}`}
                      size="small"
                      aria-label="Otvori puni video pregled"
                    >
                      <OpenInNewIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Stack>

                <Box sx={{ width: '100%', maxWidth: 640, aspectRatio: '16 / 9', mx: 'auto' }}>
                  <VideoThumbnailPreview
                    videoId={selectedItem.videoId}
                    title={selectedItem.video.originalFilename || selectedItem.video.filename || 'Video'}
                    width="100%"
                    height="100%"
                    enableScrubPreview
                  />
                </Box>

                <Box sx={{ mt: 2 }}>
                  <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.5 }}>
                    <Box>
                      <Typography variant="subtitle2" sx={{ fontWeight: 900 }}>Rez klipa</Typography>
                      <Typography variant="caption" color="text.secondary">
                        Odabrano {formatTime(selectedItem.outMs - selectedItem.inMs)}
                      </Typography>
                    </Box>
                    {editable && (
                      <Tooltip title="Vrati cijelo trajanje klipa">
                        <IconButton
                          size="small"
                          onClick={() => mutateItem(selectedItem.clientKey, { inMs: 0, outMs: selectedMaximumMs })}
                          aria-label="Vrati cijelo trajanje klipa"
                        >
                          <RestartAltIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                  </Stack>
                  <Slider
                    value={[selectedItem.inMs, selectedItem.outMs]}
                    min={0}
                    max={selectedMaximumMs}
                    step={FRAME_MS}
                    disabled={!editable}
                    onChange={(_event, value) => {
                      const [inMs, outMs] = value as number[];
                      if (outMs - inMs >= FRAME_MS) mutateItem(selectedItem.clientKey, { inMs, outMs });
                    }}
                    valueLabelDisplay="auto"
                    valueLabelFormat={formatTime}
                    getAriaLabel={(thumbIndex) => (
                      `${thumbIndex === 0 ? 'IN' : 'OUT'} tačka za ${selectedItem.video.originalFilename || selectedItem.video.filename || 'klip'}`
                    )}
                    sx={{ mt: 1 }}
                  />
                  <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1.25 }}>
                    <TimeField
                      label="IN (sekunde)"
                      valueMs={selectedItem.inMs}
                      maximumMs={Math.max(0, selectedItem.outMs - FRAME_MS)}
                      disabled={!editable}
                      onCommit={(inMs) => mutateItem(selectedItem.clientKey, {
                        inMs: Math.min(inMs, selectedItem.outMs - FRAME_MS),
                      })}
                    />
                    <TimeField
                      label="OUT (sekunde)"
                      valueMs={selectedItem.outMs}
                      maximumMs={selectedMaximumMs}
                      disabled={!editable}
                      onCommit={(outMs) => mutateItem(selectedItem.clientKey, {
                        outMs: Math.max(selectedItem.inMs + FRAME_MS, outMs),
                      })}
                    />
                  </Box>
                </Box>

                <TextField
                  label="Napomena montažeru"
                  value={selectedItem.note}
                  onChange={(event) => mutateItem(selectedItem.clientKey, { note: event.target.value })}
                  disabled={!editable}
                  multiline
                  minRows={3}
                  fullWidth
                  size="small"
                  sx={{ mt: 2 }}
                />

                <Stack
                  direction={{ xs: 'column', sm: 'row' }}
                  spacing={1}
                  justifyContent="space-between"
                  alignItems={{ xs: 'stretch', sm: 'center' }}
                  sx={{ mt: 2, pt: 1.5, borderTop: 1, borderColor: 'divider' }}
                >
                  <Box>
                    <StatusChip
                      label={saving ? 'Čuvanje u toku' : dirty ? 'Nesačuvane promjene' : 'Sačuvano na serveru'}
                      tone={saving || dirty ? 'warning' : 'success'}
                      variant="outlined"
                    />
                    <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.4 }}>
                      {formatSavedAt(lastSavedAt)} / {user?.username || 'korisnik'}
                    </Typography>
                  </Box>
                  {editable && (
                    <Button
                      variant="contained"
                      startIcon={<CheckCircleOutlineIcon />}
                      onClick={() => setSubmitDialogOpen(true)}
                      disabled={saving || submitting || conflict}
                    >
                      Pošalji montaži
                    </Button>
                  )}
                </Stack>
              </Paper>
            )}
          </Box>
        </>
      )}

      <ConfirmDialog
        open={submitDialogOpen}
        title="Pošalji Storyboard montaži?"
        description={`Montažer će dobiti verziju ${version || 1} sa ${items.length} klipova i trajanjem ${formatTime(durationMs)}.`}
        confirmLabel="Pošalji montaži"
        busy={submitting || saving}
        onClose={() => setSubmitDialogOpen(false)}
        onConfirm={submit}
      />
    </Box>
  );
};

export default StoryboardPage;
