import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  Grid,
  InputLabel,
  LinearProgress,
  List,
  ListItemButton,
  ListItemText,
  ListSubheader,
  MenuItem,
  Pagination,
  Paper,
  Select,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import ArchiveIcon from '@mui/icons-material/Archive';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import EditIcon from '@mui/icons-material/Edit';
import RefreshIcon from '@mui/icons-material/Refresh';
import SecurityIcon from '@mui/icons-material/Security';
import TvIcon from '@mui/icons-material/Tv';
import { useNavigate, useParams } from 'react-router-dom';
import axiosInstance from '../axiosConfig';
import { UserContext } from '../contexts/UserContext';
import ProgramFinalPlayer from '../components/programFinals/ProgramFinalPlayer';
import {
  EmptyState,
  FilterBar,
  KpiStrip,
  StatusChip,
  WorkspaceHeader,
} from '../components/common/WorkspaceChrome';
import { uploadProgramFinalResumable } from '../services/resumableUploadClient';

const statusLabels = {
  draft: 'Nacrt',
  waiting_for_file: 'Nedostaje final',
  ingesting: 'Prijem fajla',
  processing: 'Izrada previewa',
  waiting_for_air: 'Čeka emitovanje',
  ready_for_archive_review: 'Spremno za pregled',
  archived: 'Arhivirano',
  quarantined: 'Karantin',
};

const statusTones = {
  waiting_for_file: 'warning',
  ingesting: 'info',
  processing: 'info',
  waiting_for_air: 'default',
  ready_for_archive_review: 'warning',
  archived: 'success',
  quarantined: 'error',
};

const emptyDraft = () => ({
  programTypeId: '',
  programId: '',
  airDate: new Date().toISOString().slice(0, 10),
  airTime: '18:00',
  editionLabel: '',
  title: '',
  historical: false,
  personId: '',
  roleId: '',
  file: null,
});

const bytes = (value) => {
  let size = Number(value || 0);
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(index === 0 || size >= 10 ? 0 : 1)} ${units[index]}`;
};

const dateLabel = (value) => value
  ? new Date(value).toLocaleDateString('bs-BA', { day: '2-digit', month: '2-digit', year: 'numeric' })
  : 'Bez datuma';

const titleOf = (item) => item?.title || item?.program?.name || 'Final emisije';

function FinalFormDialog({ open, catalogs, busy, onClose, onSubmit }) {
  const [draft, setDraft] = useState(emptyDraft);
  useEffect(() => {
    if (open) setDraft(emptyDraft());
  }, [open]);
  const filteredPrograms = useMemo(() => catalogs.programs.filter((program) => (
    !draft.programTypeId || String(program.programType?._id || program.programType || '') === draft.programTypeId
  )), [catalogs.programs, draft.programTypeId]);
  const selectedProgram = catalogs.programs.find((program) => program._id === draft.programId);

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="md">
      <DialogTitle>Novi final emisije</DialogTitle>
      <DialogContent>
        <Alert severity="info" sx={{ mb: 2 }}>
          Ovaj zapis je odvojen od priloga i TV arhive. Originalni master neće imati download endpoint.
        </Alert>
        <Grid container spacing={2}>
          <Grid item xs={12} md={6}>
            <FormControl fullWidth size="small">
              <InputLabel>Tip programa</InputLabel>
              <Select
                value={draft.programTypeId}
                label="Tip programa"
                onChange={(event) => setDraft((current) => ({ ...current, programTypeId: event.target.value, programId: '' }))}
              >
                {catalogs.types.filter((item) => item.active !== false).map((item) => (
                  <MenuItem key={item._id} value={item._id}>{item.name}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={6}>
            <FormControl fullWidth size="small">
              <InputLabel>Emisija</InputLabel>
              <Select
                value={draft.programId}
                label="Emisija"
                onChange={(event) => {
                  const program = catalogs.programs.find((item) => item._id === event.target.value);
                  setDraft((current) => ({
                    ...current,
                    programId: event.target.value,
                    title: current.title || program?.name || '',
                    airTime: program?.defaultTime || current.airTime,
                  }));
                }}
              >
                {filteredPrograms.map((item) => <MenuItem key={item._id} value={item._id}>{item.name}</MenuItem>)}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField
              label="Naslov izdanja"
              value={draft.title}
              onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
              fullWidth
              size="small"
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField
              label="Oznaka izdanja"
              placeholder="npr. Večernje izdanje"
              value={draft.editionLabel}
              onChange={(event) => setDraft((current) => ({ ...current, editionLabel: event.target.value }))}
              fullWidth
              size="small"
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              type="date"
              label="Datum emitovanja"
              value={draft.airDate}
              onChange={(event) => setDraft((current) => ({ ...current, airDate: event.target.value }))}
              InputLabelProps={{ shrink: true }}
              fullWidth
              size="small"
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              type="time"
              label="Termin"
              value={draft.airTime}
              onChange={(event) => setDraft((current) => ({ ...current, airTime: event.target.value }))}
              InputLabelProps={{ shrink: true }}
              fullWidth
              size="small"
            />
          </Grid>
          <Grid item xs={12}>
            <FormControlLabel
              control={(
                <Checkbox
                  checked={draft.historical}
                  onChange={(event) => setDraft((current) => ({ ...current, historical: event.target.checked }))}
                />
              )}
              label="Historijski unos bez rundown veze"
            />
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
              Kada opcija nije uključena, sistem automatski povezuje postojeći ShowDay iste emisije i datuma.
            </Typography>
          </Grid>
          <Grid item xs={12} md={6}>
            <FormControl fullWidth size="small">
              <InputLabel>Član ekipe</InputLabel>
              <Select
                value={draft.personId}
                label="Član ekipe"
                onChange={(event) => setDraft((current) => ({ ...current, personId: event.target.value }))}
              >
                {catalogs.people.filter((item) => item.active !== false).map((item) => (
                  <MenuItem key={item._id} value={item._id}>{item.name}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={6}>
            <FormControl fullWidth size="small">
              <InputLabel>Funkcija</InputLabel>
              <Select
                value={draft.roleId}
                label="Funkcija"
                onChange={(event) => setDraft((current) => ({ ...current, roleId: event.target.value }))}
              >
                {catalogs.roles.filter((item) => item.active !== false).map((item) => (
                  <MenuItem key={item._id} value={item._id}>{item.name}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12}>
            <Button component="label" variant="outlined" startIcon={<CloudUploadIcon />}>
              {draft.file ? draft.file.name : 'Odaberi master (opcionalno)'}
              <input
                hidden
                type="file"
                accept="video/*,.mxf,.mov,.mp4,.mkv,.avi,.mts,.m2ts"
                onChange={(event) => setDraft((current) => ({ ...current, file: event.target.files?.[0] || null }))}
              />
            </Button>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
              Bez fajla se kreira zadatak „Nedostaje final“. {selectedProgram ? `Odabrano: ${selectedProgram.name}.` : ''}
            </Typography>
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>Odustani</Button>
        <Button
          variant="contained"
          disabled={busy || !draft.programTypeId || !draft.programId || !draft.title.trim() || !draft.personId || !draft.roleId}
          onClick={() => onSubmit(draft)}
        >
          {busy ? 'Kreiram...' : 'Kreiraj final'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function CreditsDialog({ open, item, catalogs, busy, onClose, onSave }) {
  const [credits, setCredits] = useState([]);
  const [personId, setPersonId] = useState('');
  const [roleId, setRoleId] = useState('');
  useEffect(() => {
    if (open) {
      setCredits((item?.credits || []).map((credit) => ({
        personId: String(credit.person?._id || credit.person || ''),
        roleId: String(credit.role?._id || credit.role || ''),
        personName: credit.personNameSnapshot,
        roleName: credit.roleNameSnapshot,
      })));
    }
  }, [item, open]);
  const addCredit = () => {
    if (!personId || !roleId || credits.some((credit) => credit.personId === personId && credit.roleId === roleId)) return;
    setCredits((current) => [...current, {
      personId,
      roleId,
      personName: catalogs.people.find((entry) => entry._id === personId)?.name,
      roleName: catalogs.roles.find((entry) => entry._id === roleId)?.name,
    }]);
    setPersonId('');
    setRoleId('');
  };
  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>Ekipa emisije</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5} sx={{ mt: 0.5 }}>
          {credits.map((credit, index) => (
            <Stack key={`${credit.personId}-${credit.roleId}`} direction="row" spacing={1} alignItems="center">
              <Typography variant="body2" sx={{ flex: 1 }}>
                <strong>{credit.personName}</strong> · {credit.roleName}
              </Typography>
              <Button color="error" size="small" onClick={() => setCredits((current) => current.filter((_, itemIndex) => itemIndex !== index))}>
                Ukloni
              </Button>
            </Stack>
          ))}
          <Divider />
          <FormControl fullWidth size="small">
            <InputLabel>Osoba</InputLabel>
            <Select value={personId} label="Osoba" onChange={(event) => setPersonId(event.target.value)}>
              {catalogs.people.filter((entry) => entry.active !== false).map((entry) => (
                <MenuItem key={entry._id} value={entry._id}>{entry.name}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl fullWidth size="small">
            <InputLabel>Funkcija</InputLabel>
            <Select value={roleId} label="Funkcija" onChange={(event) => setRoleId(event.target.value)}>
              {catalogs.roles.filter((entry) => entry.active !== false).map((entry) => (
                <MenuItem key={entry._id} value={entry._id}>{entry.name}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <Button variant="outlined" onClick={addCredit} disabled={!personId || !roleId}>Dodaj člana</Button>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>Odustani</Button>
        <Button variant="contained" onClick={() => onSave(credits)} disabled={busy || credits.length === 0}>
          Sačuvaj ekipu
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function MetadataDialog({ open, item, catalogs, busy, onClose, onSave }) {
  const [draft, setDraft] = useState({});
  useEffect(() => {
    if (open && item) {
      setDraft({
        title: item.title || '',
        programTypeId: item.programType?._id || item.programType || '',
        programId: item.program?._id || item.program || '',
        airDate: item.airDate ? new Date(item.airDate).toISOString().slice(0, 10) : '',
        airTime: item.airTime || '',
        editionLabel: item.editionLabel || '',
      });
    }
  }, [item, open]);
  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>Metadata finala</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5} sx={{ mt: 0.5 }}>
          <TextField label="Naslov" value={draft.title || ''} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} size="small" fullWidth />
          <FormControl size="small" fullWidth>
            <InputLabel>Tip programa</InputLabel>
            <Select value={draft.programTypeId || ''} label="Tip programa" onChange={(event) => setDraft((current) => ({ ...current, programTypeId: event.target.value }))}>
              {catalogs.types.filter((entry) => entry.active !== false).map((entry) => <MenuItem key={entry._id} value={entry._id}>{entry.name}</MenuItem>)}
            </Select>
          </FormControl>
          <FormControl size="small" fullWidth>
            <InputLabel>Emisija</InputLabel>
            <Select
              value={draft.programId || ''}
              label="Emisija"
              disabled={Boolean(item?.showDay)}
              onChange={(event) => setDraft((current) => ({ ...current, programId: event.target.value }))}
            >
              {catalogs.programs.map((entry) => <MenuItem key={entry._id} value={entry._id}>{entry.name}</MenuItem>)}
            </Select>
          </FormControl>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <TextField type="date" label="Datum" value={draft.airDate || ''} disabled={Boolean(item?.showDay)} onChange={(event) => setDraft((current) => ({ ...current, airDate: event.target.value }))} InputLabelProps={{ shrink: true }} size="small" fullWidth />
            <TextField type="time" label="Termin" value={draft.airTime || ''} onChange={(event) => setDraft((current) => ({ ...current, airTime: event.target.value }))} InputLabelProps={{ shrink: true }} size="small" fullWidth />
          </Stack>
          <TextField label="Oznaka izdanja" value={draft.editionLabel || ''} onChange={(event) => setDraft((current) => ({ ...current, editionLabel: event.target.value }))} size="small" fullWidth />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>Odustani</Button>
        <Button variant="contained" onClick={() => onSave(draft)} disabled={busy || !draft.title?.trim() || !draft.programTypeId || !draft.programId || !draft.airDate || !draft.airTime}>Sačuvaj metadata</Button>
      </DialogActions>
    </Dialog>
  );
}

function ActionDialog({ state, onClose, onConfirm }) {
  const [reason, setReason] = useState('');
  const [confirmation, setConfirmation] = useState('');
  useEffect(() => {
    if (state.open) {
      setReason('');
      setConfirmation('');
    }
  }, [state.open]);
  const isArchive = state.kind === 'archive';
  const isAir = state.kind === 'air';
  const isPurge = state.kind === 'purge';
  const labels = {
    air: ['Potvrdi emitovanje', 'Potvrdi emitovanje'],
    archive: ['Arhiviraj final', 'Arhiviraj'],
    quarantine: ['Stavi verziju u karantin', 'Karantin'],
    restore: ['Vrati verziju iz karantina', 'Vrati'],
    purge: ['Trajno ukloni master iz karantina', 'Trajno ukloni'],
  };
  return (
    <Dialog open={state.open} onClose={state.busy ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>{labels[state.kind]?.[0] || 'Potvrda'}</DialogTitle>
      <DialogContent>
        {isArchive && state.warnings?.length > 0 && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            {state.warnings.map((warning) => <div key={warning.code}>{warning.label}</div>)}
          </Alert>
        )}
        {isAir && (
          <Alert severity="info" sx={{ mb: 2 }}>
            Final će nakon potvrde emitovanja preći u arhivski pregled čim je proxy spreman.
          </Alert>
        )}
        {!isArchive && !isAir && (
          <Alert severity={isPurge ? 'error' : 'warning'} sx={{ mb: 2 }}>
            {isPurge ? 'Ova akcija briše fizički master nakon isteka karantina. Metadata, checksum i audit ostaju.' : 'Master se neće moći koristiti dok je verzija u karantinu.'}
          </Alert>
        )}
        {(state.warnings?.length > 0 || (!isArchive && !isAir)) && (
          <TextField
            label={isArchive ? 'Obrazloženje upozorenja' : 'Razlog'}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            fullWidth
            multiline
            minRows={2}
          />
        )}
        {isPurge && (
          <TextField
            label="Upiši ID ili puni naslov finala"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            fullWidth
            sx={{ mt: 2 }}
          />
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={state.busy}>Odustani</Button>
        <Button
          variant="contained"
          color={isPurge || state.kind === 'quarantine' ? 'error' : 'primary'}
          disabled={state.busy || ((state.warnings?.length > 0 || (!isArchive && !isAir)) && reason.trim().length < 5) || (isPurge && !confirmation.trim())}
          onClick={() => onConfirm({ reason, confirmation })}
        >
          {state.busy ? 'Radim...' : labels[state.kind]?.[1] || 'Potvrdi'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

const ProgramFinalsPage = () => {
  const { user } = useContext(UserContext);
  const { programFinalId } = useParams();
  const navigate = useNavigate();
  const privileged = ['Archivist', 'Admin'].includes(user?.role);
  const canViewWorkQueue = privileged || ['Producer', 'Realizator'].includes(user?.role);
  const [tab, setTab] = useState('archive');
  const [filters, setFilters] = useState({
    q: '',
    programTypeId: '',
    programId: '',
    status: '',
    dateFrom: '',
    dateTo: '',
    airTime: '',
    personId: '',
    roleId: '',
  });
  const [debouncedQ, setDebouncedQ] = useState('');
  const [workspace, setWorkspace] = useState({ items: [], total: 0, totalPages: 1, summary: {} });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [selectedId, setSelectedId] = useState(programFinalId || '');
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [catalogs, setCatalogs] = useState({ types: [], programs: [], people: [], roles: [] });
  const [createOpen, setCreateOpen] = useState(false);
  const [creditsOpen, setCreditsOpen] = useState(false);
  const [metadataOpen, setMetadataOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [candidates, setCandidates] = useState([]);
  const [candidateMap, setCandidateMap] = useState({ open: false, candidate: null, programId: '', airDate: '', airTime: '', title: '', editionLabel: '' });
  const [actionDialog, setActionDialog] = useState({ open: false, kind: '', busy: false, warnings: [], version: null });
  const replacementFileRef = useRef(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedQ(filters.q.trim().length >= 2 ? filters.q.trim() : ''), 300);
    return () => window.clearTimeout(timeout);
  }, [filters.q]);

  const loadCatalogs = useCallback(async () => {
    const [types, programs, people, roles] = await Promise.all([
      axiosInstance.get('/program-types'),
      axiosInstance.get('/broadcast/programs'),
      axiosInstance.get('/production-people?active=true&limit=500'),
      axiosInstance.get('/production-roles'),
    ]);
    setCatalogs({
      types: types.data || [],
      programs: programs.data || [],
      people: people.data || [],
      roles: roles.data || [],
    });
  }, []);

  const loadWorkspace = useCallback(async () => {
    if (tab === 'watched') return;
    setLoading(true);
    setError('');
    try {
      const response = await axiosInstance.get('/program-finals/workspace', {
        params: {
          page,
          limit: 30,
          scope: tab === 'work' ? 'work' : 'archive',
          q: debouncedQ || undefined,
          programTypeId: filters.programTypeId || undefined,
          programId: filters.programId || undefined,
          status: filters.status || undefined,
          dateFrom: filters.dateFrom || undefined,
          dateTo: filters.dateTo || undefined,
          airTime: filters.airTime || undefined,
          personId: filters.personId || undefined,
          roleId: filters.roleId || undefined,
        },
      });
      setWorkspace(response.data || { items: [], total: 0, totalPages: 1, summary: {} });
      setSelectedId((current) => {
        if (programFinalId && current === programFinalId) return current;
        if ((response.data?.items || []).some((entry) => entry._id === current)) return current;
        return response.data?.items?.[0]?._id || '';
      });
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Finali emisija se ne mogu učitati.');
    } finally {
      setLoading(false);
    }
  }, [
    debouncedQ,
    filters.airTime,
    filters.dateFrom,
    filters.dateTo,
    filters.personId,
    filters.programId,
    filters.programTypeId,
    filters.roleId,
    filters.status,
    page,
    programFinalId,
    tab,
  ]);

  const loadCandidates = useCallback(async () => {
    if (!privileged || tab !== 'watched') return;
    setLoading(true);
    try {
      const response = await axiosInstance.get('/program-finals/ingest-candidates?limit=100');
      setCandidates(response.data?.items || []);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Watched-folder red se ne može učitati.');
    } finally {
      setLoading(false);
    }
  }, [privileged, tab]);

  const loadDetail = useCallback(async () => {
    if (!selectedId || tab === 'watched') {
      setDetail(null);
      return;
    }
    setDetailLoading(true);
    try {
      const response = await axiosInstance.get(`/program-finals/${selectedId}`);
      setDetail(response.data);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Detalji finala se ne mogu učitati.');
    } finally {
      setDetailLoading(false);
    }
  }, [selectedId, tab]);

  useEffect(() => { loadCatalogs().catch(() => setError('Katalozi finala se ne mogu učitati.')); }, [loadCatalogs]);
  useEffect(() => { loadWorkspace(); }, [loadWorkspace]);
  useEffect(() => { loadCandidates(); }, [loadCandidates]);
  useEffect(() => { loadDetail(); }, [loadDetail]);
  useEffect(() => {
    if (programFinalId) setSelectedId(programFinalId);
  }, [programFinalId]);

  const refresh = () => Promise.all([loadWorkspace(), loadDetail(), loadCandidates()]);

  const runUpload = async (id, file, replacementReason = '') => {
    setUploadProgress({ value: 0, label: `Pripremam ${file.name}` });
    const storageKey = `vca:program-final-upload:${id}:${file.name}:${file.size}:${file.lastModified}`;
    let current = {};
    try { current = JSON.parse(window.localStorage.getItem(storageKey) || '{}'); } catch (_error) { current = {}; }
    const result = await uploadProgramFinalResumable(id, file, replacementReason, current, {
      onPrepared: (state) => window.localStorage.setItem(storageKey, JSON.stringify(state)),
      onProgress: (offset, total) => setUploadProgress({
        value: total > 0 ? Math.round((offset / total) * 100) : 0,
        label: `${bytes(offset)} / ${bytes(total)}`,
      }),
    });
    if (result.status === 'completed') {
      window.localStorage.removeItem(storageKey);
      setUploadProgress({ value: 100, label: 'Upload i checksum provjera su završeni; proxy obrada je u redu čekanja.' });
    } else {
      setUploadProgress({ value: 100, label: 'Fajl je poslan. Server provjerava checksum u pozadini.' });
    }
    return result;
  };

  const createFinal = async (draft) => {
    setBusy(true);
    setError('');
    try {
      const response = await axiosInstance.post('/program-finals', {
        programTypeId: draft.programTypeId,
        programId: draft.programId,
        airDate: draft.airDate,
        airTime: draft.airTime,
        editionLabel: draft.editionLabel,
        title: draft.title,
        historical: draft.historical,
        credits: [{ personId: draft.personId, roleId: draft.roleId }],
      });
      const id = response.data?.item?._id;
      setCreateOpen(false);
      setSelectedId(id);
      navigate(`/program-finals/${id}`);
      const uploadResult = draft.file ? await runUpload(id, draft.file) : null;
      setMessage(uploadResult && uploadResult.status !== 'completed'
        ? 'Final je kreiran. Server još provjerava poslani master.'
        : 'Final je kreiran.');
      await refresh();
    } catch (requestError) {
      setError(requestError.response?.data?.message || requestError.message || 'Final se ne može kreirati.');
    } finally {
      setBusy(false);
    }
  };

  const uploadReplacement = async (file) => {
    if (!file || !detail?.item?._id) return;
    setBusy(true);
    try {
      const result = await runUpload(detail.item._id, file, detail.item.activeVersion ? 'Nova verzija mastera' : 'Početni master');
      setMessage(result.status === 'completed'
        ? 'Master je verificiran. Proxy obrada se nastavlja u pozadini.'
        : 'Master je poslan. Server provjerava checksum u pozadini.');
      await refresh();
    } catch (requestError) {
      setError(requestError.response?.data?.message || requestError.message || 'Upload nije uspio.');
    } finally {
      setBusy(false);
      if (replacementFileRef.current) replacementFileRef.current.value = '';
    }
  };

  const saveCredits = async (credits) => {
    setBusy(true);
    try {
      await axiosInstance.put(`/program-finals/${detail.item._id}/credits`, { credits });
      setCreditsOpen(false);
      setMessage('Ekipa je sačuvana.');
      await refresh();
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Ekipa se ne može sačuvati.');
    } finally {
      setBusy(false);
    }
  };

  const saveMetadata = async (metadata) => {
    setBusy(true);
    try {
      await axiosInstance.patch(`/program-finals/${detail.item._id}/metadata`, metadata);
      setMetadataOpen(false);
      setMessage('Metadata je sačuvana.');
      await refresh();
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Metadata se ne može sačuvati.');
    } finally {
      setBusy(false);
    }
  };

  const performAction = async ({ reason, confirmation }) => {
    const { kind, version } = actionDialog;
    setActionDialog((current) => ({ ...current, busy: true }));
    try {
      if (kind === 'archive') {
        await axiosInstance.post(`/program-finals/${detail.item._id}/archive-confirmation`, {
          overrideWarnings: (actionDialog.warnings || []).length > 0,
          overrideReason: reason,
        });
      } else if (kind === 'air') {
        await axiosInstance.post(`/program-finals/${detail.item._id}/air-confirmation`);
      } else {
        await axiosInstance.post(`/program-finals/${detail.item._id}/versions/${version._id}/${kind}`, { reason, confirmation });
      }
      setActionDialog({ open: false, kind: '', busy: false, warnings: [], version: null });
      setMessage(kind === 'archive'
        ? 'Final je arhiviran.'
        : kind === 'air' ? 'Emitovanje je potvrđeno.' : 'Zaštitna akcija je završena.');
      await refresh();
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Akcija nije uspjela.');
      setActionDialog((current) => ({ ...current, busy: false }));
    }
  };

  const importCandidate = async (candidate, mapping = {}) => {
    setBusy(true);
    try {
      await axiosInstance.post(`/program-finals/ingest-candidates/${candidate._id}/import`, {
        programId: mapping.programId || candidate.mappedProgram?._id || undefined,
        airDate: mapping.airDate || candidate.parsed?.airDate,
        airTime: mapping.airTime || candidate.parsed?.airTime,
        title: mapping.title || candidate.parsed?.title,
        editionLabel: mapping.editionLabel || candidate.parsed?.editionLabel,
      });
      setMessage('Watched-folder import je pokrenut.');
      setCandidateMap({ open: false, candidate: null, programId: '', airDate: '', airTime: '', title: '', editionLabel: '' });
      await loadCandidates();
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Kandidat se ne može importovati.');
    } finally {
      setBusy(false);
    }
  };

  const runFixity = async () => {
    setBusy(true);
    setError('');
    try {
      const response = await axiosInstance.post('/program-finals/maintenance/fixity/run');
      setMessage(response.data?.checked
        ? 'Fixity provjera jednog mastera je završena.'
        : 'Nema mastera koji trenutno čeka fixity provjeru.');
      await refresh();
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Fixity provjera nije uspjela.');
    } finally {
      setBusy(false);
    }
  };

  const item = detail?.item;
  const pendingIsPlayable = ['ready', 'active', 'superseded'].includes(item?.pendingVersion?.status);
  const displayedVersion = item?.status === 'archived' || !pendingIsPlayable
    ? (item?.activeVersion || item?.pendingVersion)
    : item?.pendingVersion;
  const playerVersionId = ['ready', 'active', 'superseded'].includes(displayedVersion?.status)
    ? displayedVersion?._id
    : '';
  const technical = displayedVersion?.codecMetadata || {};
  const groupedFinals = useMemo(() => {
    const groups = new Map();
    (workspace.items || []).forEach((entry) => {
      const date = entry.airDate ? new Date(entry.airDate) : null;
      const month = date && !Number.isNaN(date.getTime())
        ? date.toLocaleDateString('bs-BA', { month: 'long', year: 'numeric' })
        : 'Bez datuma';
      const typeName = entry.programType?.name || 'Nekategorisano';
      const programName = entry.program?.name || 'Nepoznata emisija';
      const key = `${typeName}::${programName}::${month}`;
      if (!groups.has(key)) groups.set(key, { key, label: `${typeName} / ${programName} / ${month}`, items: [] });
      groups.get(key).items.push(entry);
    });
    return Array.from(groups.values());
  }, [workspace.items]);

  const kpis = [
    { label: 'Nedostaje final', value: workspace.summary?.waiting_for_file || 0, onClick: () => setFilters((current) => ({ ...current, status: 'waiting_for_file' })), active: filters.status === 'waiting_for_file' },
    { label: 'Obrada', value: (workspace.summary?.ingesting || 0) + (workspace.summary?.processing || 0), onClick: () => setFilters((current) => ({ ...current, status: 'ingesting,processing' })), active: filters.status === 'ingesting,processing' },
    { label: 'Čeka emitovanje', value: workspace.summary?.waiting_for_air || 0, onClick: () => setFilters((current) => ({ ...current, status: 'waiting_for_air' })), active: filters.status === 'waiting_for_air' },
    { label: 'Spremno za pregled', value: workspace.summary?.ready_for_archive_review || 0, onClick: () => setFilters((current) => ({ ...current, status: 'ready_for_archive_review' })), active: filters.status === 'ready_for_archive_review' },
    { label: 'Karantin', value: workspace.summary?.quarantined || 0, color: 'error.main', onClick: () => setFilters((current) => ({ ...current, status: 'quarantined' })), active: filters.status === 'quarantined' },
  ];

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1800, mx: 'auto' }}>
      <WorkspaceHeader
        eyebrow="Zaštićena programska arhiva"
        title="Finali emisija"
        subtitle="Kompletne emitovane emisije, odvojene od priloga i produkcijskih klipova."
        chips={[{ label: 'Pristup', value: 'Samo pregled' }, { label: 'Download', value: 'Isključen' }]}
        actions={(
          <Stack direction="row" spacing={1}>
            <Button variant="outlined" startIcon={<RefreshIcon />} onClick={refresh}>Osvježi</Button>
            {user?.role === 'Admin' && (
              <Button variant="outlined" startIcon={<SecurityIcon />} onClick={runFixity} disabled={busy}>
                Fixity
              </Button>
            )}
            {privileged && <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreateOpen(true)}>Novi final</Button>}
          </Stack>
        )}
      />
      {error && <Alert severity="error" onClose={() => setError('')} sx={{ mb: 2 }}>{error}</Alert>}
      {message && <Alert severity="success" onClose={() => setMessage('')} sx={{ mb: 2 }}>{message}</Alert>}
      {uploadProgress && (
        <Paper variant="outlined" sx={{ p: 1.5, mb: 2 }}>
          <Stack direction="row" justifyContent="space-between" spacing={2}>
            <Typography variant="body2" sx={{ fontWeight: 800 }}>Upload finala</Typography>
            <Typography variant="caption">{uploadProgress.label}</Typography>
          </Stack>
          <LinearProgress variant="determinate" value={uploadProgress.value} sx={{ mt: 1 }} />
        </Paper>
      )}

      <Tabs
        value={tab}
        onChange={(_event, value) => { setTab(value); setPage(1); setSelectedId(''); setFilters((current) => ({ ...current, status: '' })); }}
        sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}
      >
        <Tab value="archive" label="Arhiva finala" />
        {canViewWorkQueue && <Tab value="work" label={privileged ? 'Radni red' : 'Moje emisije'} />}
        {privileged && <Tab value="watched" label="Watched folder" />}
      </Tabs>

      {tab !== 'watched' && (
        <>
          {tab === 'work' && <KpiStrip items={kpis} dense />}
          <FilterBar title="Pretraga i organizacija" summary="Tip programa → emisija → datum i termin">
            <Grid container spacing={1.5}>
              <Grid item xs={12} md={4}>
                <TextField
                  label="Pretraži naslov, emisiju ili člana ekipe"
                  value={filters.q}
                  onChange={(event) => { setFilters((current) => ({ ...current, q: event.target.value })); setPage(1); }}
                  fullWidth
                  size="small"
                />
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <FormControl fullWidth size="small">
                  <InputLabel>Tip programa</InputLabel>
                  <Select value={filters.programTypeId} label="Tip programa" onChange={(event) => { setFilters((current) => ({ ...current, programTypeId: event.target.value, programId: '' })); setPage(1); }}>
                    <MenuItem value="">Svi tipovi</MenuItem>
                    {catalogs.types.map((entry) => <MenuItem key={entry._id} value={entry._id}>{entry.name}</MenuItem>)}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <FormControl fullWidth size="small">
                  <InputLabel>Emisija</InputLabel>
                  <Select value={filters.programId} label="Emisija" onChange={(event) => { setFilters((current) => ({ ...current, programId: event.target.value })); setPage(1); }}>
                    <MenuItem value="">Sve emisije</MenuItem>
                    {catalogs.programs.filter((program) => !filters.programTypeId || String(program.programType?._id || program.programType || '') === filters.programTypeId).map((entry) => (
                      <MenuItem key={entry._id} value={entry._id}>{entry.name}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} md={2}>
                <Button fullWidth variant="text" onClick={() => setFilters({
                  q: '',
                  programTypeId: '',
                  programId: '',
                  status: '',
                  dateFrom: '',
                  dateTo: '',
                  airTime: '',
                  personId: '',
                  roleId: '',
                })}>Očisti</Button>
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <TextField
                  type="date"
                  label="Datum od"
                  value={filters.dateFrom}
                  onChange={(event) => { setFilters((current) => ({ ...current, dateFrom: event.target.value })); setPage(1); }}
                  InputLabelProps={{ shrink: true }}
                  fullWidth
                  size="small"
                />
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <TextField
                  type="date"
                  label="Datum do"
                  value={filters.dateTo}
                  onChange={(event) => { setFilters((current) => ({ ...current, dateTo: event.target.value })); setPage(1); }}
                  InputLabelProps={{ shrink: true }}
                  fullWidth
                  size="small"
                />
              </Grid>
              <Grid item xs={12} sm={6} md={2}>
                <TextField
                  type="time"
                  label="Termin"
                  value={filters.airTime}
                  onChange={(event) => { setFilters((current) => ({ ...current, airTime: event.target.value })); setPage(1); }}
                  InputLabelProps={{ shrink: true }}
                  fullWidth
                  size="small"
                />
              </Grid>
              <Grid item xs={12} sm={6} md={2}>
                <FormControl fullWidth size="small">
                  <InputLabel>Osoba</InputLabel>
                  <Select value={filters.personId} label="Osoba" onChange={(event) => { setFilters((current) => ({ ...current, personId: event.target.value })); setPage(1); }}>
                    <MenuItem value="">Sve osobe</MenuItem>
                    {catalogs.people.map((entry) => <MenuItem key={entry._id} value={entry._id}>{entry.name}</MenuItem>)}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} sm={6} md={2}>
                <FormControl fullWidth size="small">
                  <InputLabel>Funkcija</InputLabel>
                  <Select value={filters.roleId} label="Funkcija" onChange={(event) => { setFilters((current) => ({ ...current, roleId: event.target.value })); setPage(1); }}>
                    <MenuItem value="">Sve funkcije</MenuItem>
                    {catalogs.roles.map((entry) => <MenuItem key={entry._id} value={entry._id}>{entry.name}</MenuItem>)}
                  </Select>
                </FormControl>
              </Grid>
            </Grid>
          </FilterBar>

          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '380px minmax(0, 1fr)' }, gap: 2, alignItems: 'start' }}>
            <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
              <Box sx={{ px: 2, py: 1.5, borderBottom: 1, borderColor: 'divider' }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 900 }}>{workspace.total} finala</Typography>
              </Box>
              {loading ? (
                <Box sx={{ minHeight: 240, display: 'grid', placeItems: 'center' }}><CircularProgress size={28} /></Box>
              ) : workspace.items.length === 0 ? (
                <Box sx={{ p: 2 }}><EmptyState title="Nema finala" description="Promijeni filter ili kreiraj novi zapis." /></Box>
              ) : (
                <List disablePadding sx={{ maxHeight: { lg: 'calc(100vh - 330px)' }, overflowY: 'auto' }}>
                  {groupedFinals.map((group) => (
                    <React.Fragment key={group.key}>
                      <ListSubheader
                        disableSticky
                        sx={{ bgcolor: 'action.hover', color: 'text.secondary', fontWeight: 800, lineHeight: 2.5 }}
                      >
                        {group.label}
                      </ListSubheader>
                      {group.items.map((entry) => (
                        <ListItemButton
                          key={entry._id}
                          selected={selectedId === entry._id}
                          onClick={() => { setSelectedId(entry._id); navigate(`/program-finals/${entry._id}`); }}
                          divider
                          alignItems="flex-start"
                          sx={{ py: 1.5 }}
                        >
                          <ListItemText
                            primary={<Typography variant="body2" sx={{ fontWeight: 900 }}>{titleOf(entry)}</Typography>}
                            secondary={(
                              <Stack spacing={0.5} sx={{ mt: 0.5 }}>
                                <Typography variant="caption" color="text.secondary">
                                  {dateLabel(entry.airDate)} · {entry.airTime}
                                </Typography>
                                <Box><StatusChip value={entry.status} label={statusLabels[entry.status] || entry.status} tone={statusTones[entry.status]} /></Box>
                              </Stack>
                            )}
                          />
                        </ListItemButton>
                      ))}
                    </React.Fragment>
                  ))}
                </List>
              )}
              {workspace.totalPages > 1 && (
                <Box sx={{ p: 1.5, display: 'flex', justifyContent: 'center' }}>
                  <Pagination count={workspace.totalPages} page={page} onChange={(_event, value) => setPage(value)} size="small" />
                </Box>
              )}
            </Paper>

            <Box sx={{ position: { lg: 'sticky' }, top: { lg: 92 } }}>
              {detailLoading ? (
                <Paper variant="outlined" sx={{ minHeight: 420, display: 'grid', placeItems: 'center' }}><CircularProgress /></Paper>
              ) : !item ? (
                <EmptyState title="Odaberi final" description="Detalji i zaštićeni HLS prikazuju se ovdje." />
              ) : (
                <Paper variant="outlined" sx={{ p: { xs: 1.5, md: 2 } }}>
                  <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={1.5} sx={{ mb: 2 }}>
                    <Box>
                      <Typography variant="h6" sx={{ fontWeight: 900 }}>{titleOf(item)}</Typography>
                      <Typography variant="body2" color="text.secondary">
                        {item.programType?.name} · {item.program?.name} · {dateLabel(item.airDate)} u {item.airTime}
                      </Typography>
                    </Box>
                    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                      <StatusChip value={item.status} label={statusLabels[item.status] || item.status} tone={statusTones[item.status]} />
                      {item.editionLabel && <Chip size="small" label={item.editionLabel} variant="outlined" />}
                    </Stack>
                  </Stack>

                  {playerVersionId ? (
                    <ProgramFinalPlayer programFinalId={item._id} versionId={playerVersionId} />
                  ) : (
                    <Alert severity="warning">Master ili zaštićeni preview još nije dostupan.</Alert>
                  )}

                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ my: 2 }}>
                    {item.permissions?.canUpload && (
                      <Button component="label" variant="outlined" startIcon={<CloudUploadIcon />} disabled={busy}>
                        {item.activeVersion ? 'Dodaj novu verziju' : 'Dodaj master'}
                        <input
                          ref={replacementFileRef}
                          hidden
                          type="file"
                          accept="video/*,.mxf,.mov,.mp4,.mkv,.avi,.mts,.m2ts"
                          onChange={(event) => uploadReplacement(event.target.files?.[0])}
                        />
                      </Button>
                    )}
                    {item.permissions?.canEditCredits && <Button variant="outlined" startIcon={<EditIcon />} onClick={() => setCreditsOpen(true)}>Ekipa</Button>}
                    {item.permissions?.canEdit && <Button variant="outlined" startIcon={<EditIcon />} onClick={() => setMetadataOpen(true)}>Metadata</Button>}
                    {item.permissions?.canConfirmAir && (
                      <Button
                        variant="outlined"
                        startIcon={<TvIcon />}
                        onClick={() => setActionDialog({ open: true, kind: 'air', busy: false, warnings: [], version: null })}
                      >
                        Potvrdi emitovanje
                      </Button>
                    )}
                    {item.permissions?.canArchive && item.status === 'ready_for_archive_review' && (
                      <Button
                        variant="contained"
                        startIcon={<ArchiveIcon />}
                        onClick={() => setActionDialog({ open: true, kind: 'archive', busy: false, warnings: detail.archiveWarnings || [], version: item.pendingVersion })}
                      >
                        Arhiviraj final
                      </Button>
                    )}
                  </Stack>

                  {(detail.archiveWarnings || []).length > 0 && item.permissions?.canArchive && (
                    <Alert severity="warning" sx={{ mb: 2 }}>
                      {(detail.archiveWarnings || []).map((warning) => <div key={warning.code}>{warning.label}</div>)}
                    </Alert>
                  )}

                  <Divider sx={{ my: 2 }} />
                  <Typography variant="subtitle2" sx={{ fontWeight: 900, mb: 1 }}>Ekipa</Typography>
                  <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                    {(item.credits || []).map((credit) => (
                      <Chip key={credit._id || `${credit.personNameSnapshot}-${credit.roleNameSnapshot}`} label={`${credit.personNameSnapshot} · ${credit.roleNameSnapshot}`} size="small" variant="outlined" />
                    ))}
                    {(item.credits || []).length === 0 && <Typography variant="body2" color="text.secondary">Ekipa nije evidentirana.</Typography>}
                  </Stack>

                  <Grid container spacing={1.5} sx={{ mt: 1 }}>
                    <Grid item xs={6} md={3}><Typography variant="caption" color="text.secondary">Trajanje</Typography><Typography variant="body2" sx={{ fontWeight: 800 }}>{Math.round(Number(item.activeVersion?.proxy?.duration || item.pendingVersion?.proxy?.duration || 0) / 60)} min</Typography></Grid>
                    <Grid item xs={6} md={3}><Typography variant="caption" color="text.secondary">Verzija</Typography><Typography variant="body2" sx={{ fontWeight: 800 }}>v{item.activeVersion?.versionNumber || item.pendingVersion?.versionNumber || '-'}</Typography></Grid>
                    <Grid item xs={6} md={3}><Typography variant="caption" color="text.secondary">Proxy</Typography><Typography variant="body2" sx={{ fontWeight: 800 }}>{bytes(item.activeVersion?.proxy?.size || item.pendingVersion?.proxy?.size)}</Typography></Grid>
                    <Grid item xs={6} md={3}><Typography variant="caption" color="text.secondary">Download</Typography><Typography variant="body2" sx={{ fontWeight: 800 }}>Nije dozvoljen</Typography></Grid>
                    <Grid item xs={6} md={3}><Typography variant="caption" color="text.secondary">Video codec</Typography><Typography variant="body2" sx={{ fontWeight: 800 }}>{technical.videoCodec || '-'}</Typography></Grid>
                    <Grid item xs={6} md={3}><Typography variant="caption" color="text.secondary">Rezolucija</Typography><Typography variant="body2" sx={{ fontWeight: 800 }}>{technical.width && technical.height ? `${technical.width}×${technical.height}` : '-'}</Typography></Grid>
                    <Grid item xs={6} md={3}><Typography variant="caption" color="text.secondary">Frame rate</Typography><Typography variant="body2" sx={{ fontWeight: 800 }}>{technical.frameRate || '-'}</Typography></Grid>
                    <Grid item xs={6} md={3}><Typography variant="caption" color="text.secondary">Audio codec</Typography><Typography variant="body2" sx={{ fontWeight: 800 }}>{technical.hasAudio === false ? 'Bez audija' : technical.audioCodec || '-'}</Typography></Grid>
                  </Grid>

                  {item.permissions?.canManageProtection && (item.versions || []).length > 0 && (
                    <Box sx={{ mt: 2 }}>
                      <Divider sx={{ mb: 2 }} />
                      <Typography variant="subtitle2" sx={{ fontWeight: 900, mb: 1 }}>Zaštita i verzije</Typography>
                      <Stack spacing={1}>
                        {item.versions.map((version) => (
                          <Stack key={version._id} direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
                            <Typography variant="body2" sx={{ flex: 1 }}>
                              <strong>v{version.versionNumber}</strong> · {version.status} · {bytes(version.size)} · {version.sha256?.slice(0, 12)}…
                              {version.fixity?.lastResult ? ` · fixity: ${version.fixity.lastResult}` : ''}
                            </Typography>
                            {['ready', 'active', 'superseded'].includes(version.status) && (
                              <Button size="small" color="error" startIcon={<SecurityIcon />} onClick={() => setActionDialog({ open: true, kind: 'quarantine', busy: false, warnings: [], version })}>Karantin</Button>
                            )}
                            {version.status === 'quarantined' && (
                              <>
                                <Button size="small" onClick={() => setActionDialog({ open: true, kind: 'restore', busy: false, warnings: [], version })}>Vrati</Button>
                                <Button size="small" color="error" disabled={!version.purgeEligibleAt || new Date(version.purgeEligibleAt) > new Date()} onClick={() => setActionDialog({ open: true, kind: 'purge', busy: false, warnings: [], version })}>Purge</Button>
                              </>
                            )}
                          </Stack>
                        ))}
                      </Stack>
                    </Box>
                  )}
                </Paper>
              )}
            </Box>
          </Box>
        </>
      )}

      {tab === 'watched' && (
        <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
          <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider' }}>
            <Typography variant="h6" sx={{ fontWeight: 900 }}>Watched-folder red</Typography>
            <Typography variant="body2" color="text.secondary">Fajl se prihvata tek nakon 60 sekundi stabilne veličine i vremena izmjene.</Typography>
          </Box>
          {loading ? <Box sx={{ p: 5, textAlign: 'center' }}><CircularProgress /></Box> : candidates.length === 0 ? (
            <Box sx={{ p: 2 }}><EmptyState title="Watched folder je prazan" description="Media Edge će ovdje prikazati nove finale." /></Box>
          ) : (
            <List disablePadding>
              {candidates.map((candidate) => (
                <ListItemButton key={candidate._id} divider disableRipple>
                  <ListItemText
                    primary={<Typography variant="body2" sx={{ fontWeight: 900 }}>{candidate.filename}</Typography>}
                    secondary={`${candidate.parsed?.programSlug || 'Nepoznat program'} · ${candidate.parsed?.airDate || 'bez datuma'} · ${candidate.parsed?.airTime || 'bez termina'} · ${bytes(candidate.size)}`}
                  />
                  <StatusChip value={candidate.status} label={candidate.status} tone={candidate.status === 'failed' ? 'error' : candidate.status === 'needs_mapping' ? 'warning' : 'info'} />
                  {['ready', 'needs_mapping', 'failed'].includes(candidate.status) && (
                    <Button
                      sx={{ ml: 1 }}
                      size="small"
                      variant="outlined"
                      disabled={busy}
                      onClick={() => candidate.status === 'needs_mapping'
                        ? setCandidateMap({
                          open: true,
                          candidate,
                          programId: candidate.mappedProgram?._id || '',
                          airDate: candidate.parsed?.airDate || '',
                          airTime: candidate.parsed?.airTime || '',
                          title: candidate.parsed?.title || '',
                          editionLabel: candidate.parsed?.editionLabel || '',
                        })
                        : importCandidate(candidate)}
                    >
                      {candidate.status === 'needs_mapping' ? 'Poveži' : 'Importuj'}
                    </Button>
                  )}
                </ListItemButton>
              ))}
            </List>
          )}
        </Paper>
      )}

      <FinalFormDialog open={createOpen} catalogs={catalogs} busy={busy} onClose={() => setCreateOpen(false)} onSubmit={createFinal} />
      <CreditsDialog open={creditsOpen} item={item} catalogs={catalogs} busy={busy} onClose={() => setCreditsOpen(false)} onSave={saveCredits} />
      <MetadataDialog open={metadataOpen} item={item} catalogs={catalogs} busy={busy} onClose={() => setMetadataOpen(false)} onSave={saveMetadata} />
      <ActionDialog state={actionDialog} onClose={() => setActionDialog({ open: false, kind: '', busy: false, warnings: [], version: null })} onConfirm={performAction} />
      <Dialog open={candidateMap.open} onClose={busy ? undefined : () => setCandidateMap((current) => ({ ...current, open: false }))} fullWidth maxWidth="sm">
        <DialogTitle>Poveži watched-folder final</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ mt: 0.5 }}>
            <Typography variant="body2" sx={{ fontWeight: 800 }}>{candidateMap.candidate?.filename}</Typography>
            <FormControl size="small" fullWidth>
              <InputLabel>Emisija</InputLabel>
              <Select value={candidateMap.programId} label="Emisija" onChange={(event) => setCandidateMap((current) => ({ ...current, programId: event.target.value }))}>
                {catalogs.programs.map((program) => <MenuItem key={program._id} value={program._id}>{program.name}</MenuItem>)}
              </Select>
            </FormControl>
            <TextField type="date" label="Datum" value={candidateMap.airDate} onChange={(event) => setCandidateMap((current) => ({ ...current, airDate: event.target.value }))} InputLabelProps={{ shrink: true }} size="small" fullWidth />
            <TextField type="time" label="Termin" value={candidateMap.airTime} onChange={(event) => setCandidateMap((current) => ({ ...current, airTime: event.target.value }))} InputLabelProps={{ shrink: true }} size="small" fullWidth />
            <TextField label="Naslov" value={candidateMap.title} onChange={(event) => setCandidateMap((current) => ({ ...current, title: event.target.value }))} size="small" fullWidth />
            <TextField label="Oznaka izdanja" value={candidateMap.editionLabel} onChange={(event) => setCandidateMap((current) => ({ ...current, editionLabel: event.target.value }))} size="small" fullWidth />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCandidateMap((current) => ({ ...current, open: false }))} disabled={busy}>Odustani</Button>
          <Button variant="contained" disabled={busy || !candidateMap.programId || !candidateMap.airDate || !candidateMap.airTime || !candidateMap.title.trim()} onClick={() => importCandidate(candidateMap.candidate, candidateMap)}>Importuj</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default ProgramFinalsPage;
