import React, { useEffect, useMemo, useState } from 'react';
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
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import EditNoteIcon from '@mui/icons-material/EditNote';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import ReportProblemIcon from '@mui/icons-material/ReportProblem';
import SendIcon from '@mui/icons-material/Send';
import { Link } from 'react-router-dom';
import axios from '../../axiosConfig';
import { StatusChip } from '../common/WorkspaceChrome';

const typeOptions = [
  { value: 'picture', label: 'Slika' },
  { value: 'audio', label: 'Zvuk' },
  { value: 'edit', label: 'Montaža / rez' },
  { value: 'graphics', label: 'Grafika / titl' },
  { value: 'wrong_version', label: 'Pogrešna verzija' },
  { value: 'technical', label: 'Tehnička greška' },
  { value: 'other', label: 'Ostalo' },
];

const severityOptions = [
  { value: 'minor', label: 'Manja' },
  { value: 'major', label: 'Potrebna ispravka' },
  { value: 'blocking', label: 'Blokira korištenje' },
];

const statusLabels = {
  reported: 'Prijavljeno',
  assigned: 'Dodijeljeno',
  in_edit: 'U montaži',
  ready_for_review: 'Spremno za pregled',
  resolved: 'Završeno',
  dismissed: 'Odbačeno',
};

const severityLabels = {
  minor: 'Manja',
  major: 'Potrebna ispravka',
  blocking: 'Blokira korištenje',
};

const formatTime = (seconds) => {
  const value = Math.max(Number(seconds) || 0, 0);
  const minutes = Math.floor(value / 60);
  const remainder = (value % 60).toFixed(2).padStart(5, '0');
  return `${String(minutes).padStart(2, '0')}:${remainder}`;
};

const createIssue = (playheadSeconds = 0) => ({
  type: 'picture',
  severity: 'major',
  startSeconds: Number(playheadSeconds || 0).toFixed(2),
  endSeconds: '',
  note: '',
});

export const VideoIssueComposer = ({
  open,
  video,
  playheadSeconds = 0,
  correctionContext = null,
  onClose,
  onSubmitted,
  onMetadataIssue,
}) => {
  const [issues, setIssues] = useState([createIssue(playheadSeconds)]);
  const [editors, setEditors] = useState([]);
  const [assignedEditorId, setAssignedEditorId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !video?._id) return;
    setIssues([createIssue(playheadSeconds)]);
    setError('');
  }, [open, video?._id]);

  useEffect(() => {
    if (!open || !video?._id) return;
    setAssignedEditorId(correctionContext?.suggestedEditorId || '');
    axios.get('/corrections/editors')
      .then((response) => setEditors(Array.isArray(response.data) ? response.data : []))
      .catch(() => setEditors([]));
  }, [correctionContext?.suggestedEditorId, open, video?._id]);

  const valid = issues.length > 0 && issues.every((issue) => (
    issue.note.trim().length >= 3
    && Number(issue.startSeconds) >= 0
    && (issue.endSeconds === '' || Number(issue.endSeconds) >= Number(issue.startSeconds))
  ));

  const updateIssue = (index, field, value) => {
    setIssues((current) => current.map((issue, issueIndex) => (
      issueIndex === index ? { ...issue, [field]: value } : issue
    )));
  };

  const removeIssue = (index) => {
    setIssues((current) => current.filter((issue, issueIndex) => issueIndex !== index));
  };

  const submit = async () => {
    if (!valid || !video?._id) return;
    setBusy(true);
    setError('');
    try {
      const response = await axios.post(`/corrections/video/${video._id}/issues`, {
        assignedEditorId: assignedEditorId || null,
        issues: issues.map((issue) => ({
          ...issue,
          startSeconds: Number(issue.startSeconds),
          endSeconds: issue.endSeconds === '' ? null : Number(issue.endSeconds),
        })),
      });
      onSubmitted?.(response.data);
      onClose?.();
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Greške nije moguće poslati u montažu.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="md">
      <DialogTitle>Označi greške i pošalji u montažu</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ fontWeight: 800, mb: 1 }}>
          {video?.finalTitle || video?.originalFilename || video?.filename || 'Video'}
        </Typography>
        <Alert severity="info" sx={{ mb: 2 }}>
          Trenutna pozicija playera je {formatTime(playheadSeconds)}. Možete evidentirati do 20 problema u jednom slanju.
        </Alert>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        <Stack spacing={1.5}>
          {issues.map((issue, index) => (
            <Paper key={index} variant="outlined" sx={{ p: 1.5, borderRadius: 1.5 }}>
              <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 850 }}>Greška {index + 1}</Typography>
                {issues.length > 1 && (
                  <IconButton size="small" onClick={() => removeIssue(index)} aria-label={`Ukloni grešku ${index + 1}`}>
                    <CloseIcon fontSize="small" />
                  </IconButton>
                )}
              </Stack>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mb: 1 }}>
                <FormControl size="small" fullWidth>
                  <InputLabel>Tip</InputLabel>
                  <Select value={issue.type} label="Tip" onChange={(event) => updateIssue(index, 'type', event.target.value)}>
                    {typeOptions.map((option) => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}
                  </Select>
                </FormControl>
                <FormControl size="small" fullWidth>
                  <InputLabel>Ozbiljnost</InputLabel>
                  <Select value={issue.severity} label="Ozbiljnost" onChange={(event) => updateIssue(index, 'severity', event.target.value)}>
                    {severityOptions.map((option) => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}
                  </Select>
                </FormControl>
                <TextField
                  size="small"
                  type="number"
                  label="Početak (s)"
                  value={issue.startSeconds}
                  inputProps={{ min: 0, step: 0.01 }}
                  onChange={(event) => updateIssue(index, 'startSeconds', event.target.value)}
                  fullWidth
                />
                <TextField
                  size="small"
                  type="number"
                  label="Kraj (s), opcionalno"
                  value={issue.endSeconds}
                  inputProps={{ min: 0, step: 0.01 }}
                  onChange={(event) => updateIssue(index, 'endSeconds', event.target.value)}
                  fullWidth
                />
              </Stack>
              <TextField
                label="Opis problema"
                value={issue.note}
                onChange={(event) => updateIssue(index, 'note', event.target.value)}
                fullWidth
                multiline
                minRows={2}
                size="small"
                required
                inputProps={{ 'aria-label': 'Opis problema' }}
              />
            </Paper>
          ))}
        </Stack>

        <Button
          startIcon={<AddIcon />}
          onClick={() => setIssues((current) => [...current, createIssue(playheadSeconds)])}
          disabled={issues.length >= 20}
          sx={{ mt: 1 }}
        >
          Dodaj još jednu grešku
        </Button>

        <Divider sx={{ my: 2 }} />
        <FormControl size="small" fullWidth>
          <InputLabel>Montažer</InputLabel>
          <Select
            value={editors.some((editor) => editor._id === assignedEditorId) ? assignedEditorId : ''}
            label="Montažer"
            onChange={(event) => setAssignedEditorId(event.target.value)}
          >
            <MenuItem value="">Nedodijeljeno, obavijesti Producenta</MenuItem>
            {editors.map((editor) => (
              <MenuItem key={editor._id} value={editor._id}>{editor.username}</MenuItem>
            ))}
          </Select>
        </FormControl>
        {onMetadataIssue && (
          <Button startIcon={<EditNoteIcon />} onClick={onMetadataIssue} sx={{ mt: 1 }}>
            Problem je u metadata, kategoriji ili tagovima
          </Button>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>Odustani</Button>
        <Button variant="contained" startIcon={<SendIcon />} onClick={submit} disabled={busy || !valid}>
          {busy ? 'Šaljem...' : 'Pošalji montažeru'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

const VideoCorrectionPanel = ({ context, onTimestamp, onReport, reportDisabled = false }) => {
  const active = context?.active;
  const issues = useMemo(() => active?.issues || [], [active?.issues]);

  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 1.5 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1} sx={{ mb: 1 }}>
        <Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 850 }}>Kontrola i ispravke</Typography>
          <Typography variant="caption" color="text.secondary">
            Evidencija problema vezana za tačan kadar.
          </Typography>
        </Box>
        <ReportProblemIcon color={active ? 'error' : 'action'} />
      </Stack>

      {!active ? (
        <Alert severity="success" variant="outlined">Nema otvorene ispravke.</Alert>
      ) : (
        <Stack spacing={1}>
          <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
            <StatusChip label={statusLabels[active.status] || active.status} tone={active.status === 'ready_for_review' ? 'warning' : 'error'} />
            <StatusChip label={`${issues.length} ${issues.length === 1 ? 'problem' : 'problema'}`} variant="outlined" />
            <StatusChip label={severityLabels[active.highestSeverity] || active.highestSeverity} variant="outlined" tone={active.highestSeverity === 'blocking' ? 'error' : 'warning'} />
          </Stack>
          <Typography variant="body2">
            Montažer: <strong>{active.assignedEditor?.username || 'Nije dodijeljen'}</strong>
          </Typography>
          <Stack spacing={0.5}>
            {issues.slice(0, 6).map((issue, index) => (
              <Button
                key={issue._id || index}
                size="small"
                variant="text"
                onClick={() => onTimestamp?.(Number(issue.startSeconds) || 0)}
                sx={{ justifyContent: 'flex-start', textAlign: 'left' }}
              >
                {formatTime(issue.startSeconds)} / {typeOptions.find((option) => option.value === issue.type)?.label || 'Ostalo'}: {issue.note}
              </Button>
            ))}
          </Stack>
          {active.correctionJob?._id && (
            <Button
              component={Link}
              to={`/edit-jobs/${active.correctionJob._id}`}
              startIcon={<OpenInNewIcon />}
              size="small"
              variant="outlined"
            >
              Otvori correction job
            </Button>
          )}
        </Stack>
      )}

      {onReport && (
        <Button
          fullWidth
          variant={active ? 'outlined' : 'contained'}
          color="warning"
          startIcon={<ReportProblemIcon />}
          onClick={onReport}
          disabled={reportDisabled}
          sx={{ mt: 1.5 }}
        >
          {active ? 'Dodaj novu grešku' : 'Označi grešku'}
        </Button>
      )}
    </Paper>
  );
};

export default VideoCorrectionPanel;
