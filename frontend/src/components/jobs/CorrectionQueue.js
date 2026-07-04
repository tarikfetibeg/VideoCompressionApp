import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
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
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import RefreshIcon from '@mui/icons-material/Refresh';
import SendIcon from '@mui/icons-material/Send';
import { Link } from 'react-router-dom';
import axiosInstance from '../../axiosConfig';
import { EmptyState, FilterBar, KpiStrip, StatusChip } from '../common/WorkspaceChrome';

const statusLabels = {
  reported: 'Prijavljeno',
  assigned: 'Dodijeljeno',
  in_edit: 'U montaži',
  ready_for_review: 'Spremno za pregled',
  resolved: 'Riješeno',
  dismissed: 'Odbačeno',
};

const formatDateTime = (value) => {
  if (!value) return 'N/A';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'N/A' : date.toLocaleString('bs-BA');
};

const CorrectionQueue = ({ role, userId }) => {
  const isProducer = ['Producer', 'Admin'].includes(role);
  const isEditor = ['Editor', 'VideoEditor'].includes(role);
  const [workspace, setWorkspace] = useState({ items: [], summary: {}, total: 0 });
  const [editors, setEditors] = useState([]);
  const [assignments, setAssignments] = useState({});
  const [scope, setScope] = useState('all');
  const [resolutionDialog, setResolutionDialog] = useState({ open: false, correction: null, note: '' });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setErrorMessage('');
    const requests = [axiosInstance.get('/corrections/workspace', {
      params: {
        limit: 50,
        scope: isEditor ? scope : undefined,
      },
    })];
    if (isProducer) requests.push(axiosInstance.get('/corrections/editors'));

    Promise.all(requests)
      .then(([correctionResponse, editorResponse]) => {
        setWorkspace({
          items: [],
          summary: {},
          total: 0,
          ...(correctionResponse.data || {}),
        });
        if (editorResponse) setEditors(Array.isArray(editorResponse.data) ? editorResponse.data : []);
      })
      .catch((error) => {
        console.error('Error loading correction queue:', error);
        setErrorMessage(error.response?.data?.message || 'Correction queue nije moguće učitati.');
      })
      .finally(() => setLoading(false));
  }, [isEditor, isProducer, scope]);

  useEffect(() => {
    load();
  }, [load]);

  const kpis = useMemo(() => [
    { label: 'Otvoreno', value: workspace.summary?.open || 0, note: 'Sve aktivne prijave' },
    ...(isProducer ? [{
      label: 'Nepročitano',
      value: workspace.summary?.unread || 0,
      note: 'Promjene od zadnjeg pregleda',
      color: 'error.main',
    }] : []),
    { label: 'Nedodijeljeno', value: workspace.summary?.unassigned || 0, note: 'Čeka producenta' },
    { label: 'Za pregled', value: workspace.summary?.ready || 0, note: 'Montaža završila' },
  ], [isProducer, workspace.summary]);

  const routeToEditor = (correction) => {
    const assignedEditorId = assignments[correction._id] || correction.assignedEditor?._id;
    if (!assignedEditorId) {
      setErrorMessage('Odaberi montažera.');
      return;
    }
    axiosInstance
      .patch(`/corrections/${correction._id}/route`, { assignedEditorId })
      .then((response) => {
        setMessage(response.data?.message || 'Ispravka je poslana montažeru.');
        load();
      })
      .catch((error) => setErrorMessage(error.response?.data?.message || 'Ispravku nije moguće proslijediti.'));
  };

  const updateStatus = (correction, status, resolutionNote = '') => {
    axiosInstance
      .patch(`/corrections/${correction._id}/status`, { status, resolutionNote })
      .then((response) => {
        setMessage(response.data?.message || 'Status je ažuriran.');
        setResolutionDialog({ open: false, correction: null, note: '' });
        load();
      })
      .catch((error) => setErrorMessage(error.response?.data?.message || 'Status nije moguće ažurirati.'));
  };

  const claimCorrection = (correction) => {
    axiosInstance
      .patch(`/corrections/${correction._id}/claim`)
      .then((response) => {
        setMessage(response.data?.message || 'Ispravka je preuzeta.');
        load();
      })
      .catch((error) => setErrorMessage(error.response?.data?.message || 'Ispravku nije moguće preuzeti.'));
  };

  return (
    <Box sx={{ mt: 2 }}>
      {message && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setMessage('')}>{message}</Alert>}
      {errorMessage && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setErrorMessage('')}>{errorMessage}</Alert>}
      <KpiStrip items={kpis} />
      <FilterBar
        title="Ispravke iz realizacije"
        summary={isProducer
          ? 'Prijave realizatora, automatski correction jobovi i usmjeravanje prema montaži.'
          : 'Correction jobovi dodijeljeni tebi.'}
        actions={(
          <Button startIcon={<RefreshIcon />} variant="outlined" onClick={load} disabled={loading}>
            Osvježi
          </Button>
        )}
      >
        {isEditor && (
          <FormControl size="small" sx={{ minWidth: 220, mb: 2 }}>
            <InputLabel>Prikaz ispravki</InputLabel>
            <Select
              value={scope}
              label="Prikaz ispravki"
              onChange={(event) => setScope(event.target.value)}
            >
              <MenuItem value="all">Sve otvorene</MenuItem>
              <MenuItem value="mine">Dodijeljene meni</MenuItem>
              <MenuItem value="unassigned">Nedodijeljene</MenuItem>
            </Select>
          </FormControl>
        )}
        {workspace.items.length === 0 ? (
          <EmptyState title="Nema otvorenih ispravki" description="Aktivne prijave realizatora pojavit će se ovdje." />
        ) : (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Materijal</TableCell>
                  <TableCell>Prijava</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Montažer</TableCell>
                  <TableCell align="right">Akcije</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {workspace.items.map((correction) => {
                  const assignedEditorId = correction.assignedEditor?._id || correction.assignedEditor || '';
                  const assignedToCurrentUser = assignedEditorId && assignedEditorId === userId;
                  const isUnassigned = !assignedEditorId;
                  return (
                  <TableRow key={correction._id} hover>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 800 }}>
                        {correction.video?.finalTitle || correction.video?.originalFilename || correction.video?.filename || 'Video'}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {formatDateTime(correction.updatedAt)} / {Number(correction.timestamp || 0).toFixed(2)}s
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ maxWidth: 320 }}>
                      <Typography variant="body2">{correction.note}</Typography>
                    </TableCell>
                    <TableCell>
                      <Stack spacing={0.5} alignItems="flex-start">
                        <StatusChip value={correction.status} maps={statusLabels} />
                        {correction.correctedBy?.username && (
                          <Typography variant="caption" color="text.secondary">
                            Ispravio: {correction.correctedBy.username}
                          </Typography>
                        )}
                      </Stack>
                    </TableCell>
                    <TableCell>
                      {isProducer ? (
                        <FormControl size="small" sx={{ minWidth: 180 }}>
                          <InputLabel>Montažer</InputLabel>
                          <Select
                            value={assignments[correction._id] || correction.assignedEditor?._id || ''}
                            label="Montažer"
                            onChange={(event) => setAssignments((current) => ({
                              ...current,
                              [correction._id]: event.target.value,
                            }))}
                          >
                            <MenuItem value="">Nije dodijeljeno</MenuItem>
                            {editors.map((editor) => (
                              <MenuItem key={editor._id} value={editor._id}>
                                {editor.username}
                              </MenuItem>
                            ))}
                          </Select>
                        </FormControl>
                      ) : (
                        correction.assignedEditor?.username || 'Nije dodijeljeno'
                      )}
                    </TableCell>
                    <TableCell align="right">
                      <Stack direction="row" spacing={0.5} justifyContent="flex-end" flexWrap="wrap" useFlexGap>
                        <Button
                          component={Link}
                          to={`/video-details/${correction.video?._id}?start=${Math.floor(correction.timestamp || 0)}`}
                          size="small"
                          startIcon={<OpenInNewIcon />}
                        >
                          Video
                        </Button>
                        {correction.correctionJob?._id && (
                          <Button component={Link} to={`/edit-jobs/${correction.correctionJob._id}`} size="small">
                            Job
                          </Button>
                        )}
                        {isProducer && (
                          <Button size="small" startIcon={<SendIcon />} onClick={() => routeToEditor(correction)}>
                            Pošalji
                          </Button>
                        )}
                        {isEditor && isUnassigned && (
                          <Button size="small" variant="contained" onClick={() => claimCorrection(correction)}>
                            Preuzmi
                          </Button>
                        )}
                        {isEditor && assignedToCurrentUser && correction.status !== 'in_edit' && correction.status !== 'ready_for_review' && (
                          <Button size="small" variant="outlined" onClick={() => updateStatus(correction, 'in_edit')}>
                            Započni
                          </Button>
                        )}
                        {isEditor && assignedToCurrentUser && correction.status === 'in_edit' && (
                          <Button size="small" variant="contained" onClick={() => updateStatus(correction, 'ready_for_review')}>
                            Spremno
                          </Button>
                        )}
                        {isProducer && correction.status === 'ready_for_review' && (
                          <Button
                            size="small"
                            variant="contained"
                            color="success"
                            onClick={() => setResolutionDialog({ open: true, correction, note: '' })}
                          >
                            Potvrdi ispravku
                          </Button>
                        )}
                      </Stack>
                    </TableCell>
                  </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </FilterBar>
      <Dialog
        open={resolutionDialog.open}
        onClose={() => setResolutionDialog({ open: false, correction: null, note: '' })}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Potvrdi završenu ispravku</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Potvrdom se klip uklanja iz aktivnog queuea, ali audit zapis i podaci o montažeru ostaju trajno sačuvani.
          </Typography>
          <TextField
            autoFocus
            label="Napomena o ispravci"
            value={resolutionDialog.note}
            onChange={(event) => setResolutionDialog((current) => ({ ...current, note: event.target.value }))}
            multiline
            minRows={3}
            fullWidth
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setResolutionDialog({ open: false, correction: null, note: '' })}>
            Odustani
          </Button>
          <Button
            variant="contained"
            color="success"
            disabled={!resolutionDialog.note.trim()}
            onClick={() => updateStatus(
              resolutionDialog.correction,
              'resolved',
              resolutionDialog.note.trim()
            )}
          >
            Potvrdi
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default CorrectionQueue;
