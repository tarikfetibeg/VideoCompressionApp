import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Divider,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Pagination,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import AddCommentIcon from '@mui/icons-material/AddComment';
import RefreshIcon from '@mui/icons-material/Refresh';
import ReplyIcon from '@mui/icons-material/Reply';
import SendIcon from '@mui/icons-material/Send';
import { UserContext } from '../contexts/UserContext';
import axiosInstance from '../axiosConfig';
import { EmptyState, KpiStrip, StatusChip, WorkspaceHeader } from '../components/common/WorkspaceChrome';
import {
  feedbackAreaLabels,
  feedbackStatusLabels,
  feedbackTypeLabels,
  formatDateTimeBs,
  formatNumberBs,
  priorityLabels,
} from '../utils/uiLabels';

const pageSize = 20;

const typeOptions = [
  { value: 'bug', label: 'Bug' },
  { value: 'suggestion', label: 'Sugestija' },
  { value: 'workflow_issue', label: 'Workflow problem' },
  { value: 'urgent_production_issue', label: 'Hitno za produkciju' },
];

const priorityOptions = [
  { value: 'low', label: 'Nisko' },
  { value: 'normal', label: 'Normalno' },
  { value: 'high', label: 'Visoko' },
  { value: 'urgent', label: 'Hitno' },
];

const areaOptions = [
  { value: 'reporter', label: 'Reporter' },
  { value: 'editor', label: 'Montaza' },
  { value: 'producer', label: 'Producent' },
  { value: 'realizator', label: 'Realizator' },
  { value: 'admin', label: 'Admin' },
  { value: 'login', label: 'Login' },
  { value: 'processing', label: 'Obrada videa' },
  { value: 'archive', label: 'Arhiva' },
  { value: 'other', label: 'Ostalo' },
];

const initialForm = {
  title: '',
  description: '',
  type: 'suggestion',
  priority: 'normal',
  area: 'other',
};

const FeedbackPage = () => {
  const { user } = useContext(UserContext);
  const [form, setForm] = useState(initialForm);
  const [feedback, setFeedback] = useState([]);
  const [page, setPage] = useState(1);
  const [workspaceMeta, setWorkspaceMeta] = useState({
    total: 0,
    totalPages: 1,
    summary: {},
  });
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const fetchFeedback = useCallback(() => {
    setLoading(true);

    axiosInstance
      .get('/feedback/workspace', {
        params: {
          page,
          limit: pageSize,
          status: 'all',
        },
      })
      .then((response) => {
        setFeedback(Array.isArray(response.data?.items) ? response.data.items : []);
        setWorkspaceMeta({
          total: Number(response.data?.total) || 0,
          totalPages: Number(response.data?.totalPages) || 1,
          summary: response.data?.summary || {},
        });
      })
      .catch((error) => {
        console.error('Error fetching feedback:', error);
        setErrorMessage('Nije moguce ucitati ranije prijave.');
      })
      .finally(() => setLoading(false));
  }, [page]);

  useEffect(() => {
    fetchFeedback();
  }, [fetchFeedback]);

  const stats = useMemo(() => {
    const summary = workspaceMeta.summary || {};
    return [
      { label: 'Moje prijave', value: formatNumberBs(workspaceMeta.total) },
      { label: 'Novo', value: formatNumberBs(summary.new), color: Number(summary.new || 0) > 0 ? 'primary.main' : 'text.primary' },
      { label: 'U pregledu', value: formatNumberBs(summary.reviewing), color: Number(summary.reviewing || 0) > 0 ? 'warning.main' : 'text.primary' },
      { label: 'Planirano', value: formatNumberBs(summary.planned) },
      { label: 'Rijeseno', value: formatNumberBs(summary.fixed), color: Number(summary.fixed || 0) > 0 ? 'success.main' : 'text.primary' },
      { label: 'Hitno', value: formatNumberBs(summary.urgent), color: Number(summary.urgent || 0) > 0 ? 'error.main' : 'text.primary' },
    ];
  }, [workspaceMeta]);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({
      ...current,
      [name]: value,
    }));
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    setMessage('');
    setErrorMessage('');

    if (!form.title.trim() || !form.description.trim()) {
      setErrorMessage('Naslov i opis su obavezni.');
      return;
    }

    setSubmitting(true);

    axiosInstance
      .post('/feedback', {
        ...form,
        title: form.title.trim(),
        description: form.description.trim(),
        pageUrl: window.location.href,
      })
      .then(() => {
        setForm(initialForm);
        setMessage('Prijava je poslana adminu.');
        if (page === 1) {
          fetchFeedback();
        } else {
          setPage(1);
        }
      })
      .catch((error) => {
        console.error('Error submitting feedback:', error);
        setErrorMessage(error.response?.data?.message || 'Slanje prijave nije uspjelo.');
      })
      .finally(() => setSubmitting(false));
  };

  return (
    <Box>
      <WorkspaceHeader
        eyebrow="Feedback"
        title="Prijave i sugestije"
        subtitle="Posalji bug, sugestiju ili produkcijski problem administratoru i prati odgovor."
        chips={[
          { label: 'Korisnik', value: user?.username || 'N/A' },
          { label: 'Rola', value: user?.role || 'N/A' },
        ]}
        actions={(
          <Button variant="outlined" startIcon={<RefreshIcon />} onClick={fetchFeedback} disabled={loading}>
            Osvjezi
          </Button>
        )}
      />

      {message && <Alert severity="success" sx={{ mb: 2 }}>{message}</Alert>}
      {errorMessage && <Alert severity="error" sx={{ mb: 2 }}>{errorMessage}</Alert>}

      <KpiStrip items={stats} dense />

      <Grid container spacing={3}>
        <Grid item xs={12} lg={5}>
          <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 1.5 }}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
              <AddCommentIcon color="primary" />
              <Box>
                <Typography variant="h6" sx={{ fontWeight: 850 }}>
                  Nova prijava
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Kratko, konkretno i sa dovoljno konteksta za admin tim.
                </Typography>
              </Box>
            </Stack>

            <Box component="form" onSubmit={handleSubmit}>
              <Stack spacing={2}>
                <TextField
                  name="title"
                  label="Kratak naslov"
                  value={form.title}
                  onChange={handleChange}
                  fullWidth
                  required
                />

                <Grid container spacing={2}>
                  <Grid item xs={12} sm={4}>
                    <FormControl fullWidth>
                      <InputLabel>Tip</InputLabel>
                      <Select name="type" value={form.type} label="Tip" onChange={handleChange}>
                        {typeOptions.map((option) => (
                          <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Grid>
                  <Grid item xs={12} sm={4}>
                    <FormControl fullWidth>
                      <InputLabel>Prioritet</InputLabel>
                      <Select name="priority" value={form.priority} label="Prioritet" onChange={handleChange}>
                        {priorityOptions.map((option) => (
                          <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Grid>
                  <Grid item xs={12} sm={4}>
                    <FormControl fullWidth>
                      <InputLabel>Dio appa</InputLabel>
                      <Select name="area" value={form.area} label="Dio appa" onChange={handleChange}>
                        {areaOptions.map((option) => (
                          <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Grid>
                </Grid>

                <TextField
                  name="description"
                  label="Opis"
                  value={form.description}
                  onChange={handleChange}
                  fullWidth
                  required
                  multiline
                  minRows={7}
                />

                <Button type="submit" variant="contained" startIcon={<SendIcon />} disabled={submitting}>
                  {submitting ? 'Slanje...' : 'Posalji prijavu'}
                </Button>
              </Stack>
            </Box>
          </Paper>
        </Grid>

        <Grid item xs={12} lg={7}>
          <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 1.5 }}>
            <Typography variant="h6" sx={{ fontWeight: 850, mb: 2 }}>
              Moje prijave
            </Typography>

            {feedback.length === 0 ? (
              <EmptyState title="Nema prijava" description="Kada posaljes prijavu, status i admin odgovor bice ovdje." />
            ) : (
              <Stack spacing={1.5}>
                {feedback.map((item) => (
                  <Paper key={item._id} variant="outlined" sx={{ p: 2, borderRadius: 1.5 }}>
                    <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={1}>
                      <Box sx={{ minWidth: 0 }}>
                        <Typography variant="subtitle1" sx={{ fontWeight: 850 }} noWrap>
                          {item.title}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {formatDateTimeBs(item.createdAt)} / {feedbackAreaLabels[item.area] || item.area}
                        </Typography>
                      </Box>
                      <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                        <StatusChip
                          label={item.adminSeenAt ? 'Admin vidio' : 'Ceka pregled'}
                          tone={item.adminSeenAt ? 'success' : 'default'}
                          variant={item.adminSeenAt ? 'filled' : 'outlined'}
                        />
                        <StatusChip value={item.status} maps={feedbackStatusLabels} />
                        <StatusChip value={item.priority} maps={priorityLabels} variant="outlined" />
                        <StatusChip value={item.type} maps={feedbackTypeLabels} variant="outlined" />
                      </Stack>
                    </Stack>

                    <Typography variant="body2" color="text.secondary" sx={{ mt: 1, whiteSpace: 'pre-wrap' }}>
                      {item.description}
                    </Typography>

                    {item.adminResponse && (
                      <>
                        <Divider sx={{ my: 1.5 }} />
                        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
                          <ReplyIcon fontSize="small" color="primary" />
                          <Typography variant="caption" color="text.secondary">
                            Admin odgovor
                          </Typography>
                        </Stack>
                        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                          {item.adminResponse}
                        </Typography>
                        {item.adminResponseAt && (
                          <Typography variant="caption" color="text.secondary">
                            {formatDateTimeBs(item.adminResponseAt)}
                            {item.adminResponseBy?.username ? ` / ${item.adminResponseBy.username}` : ''}
                          </Typography>
                        )}
                      </>
                    )}
                  </Paper>
                ))}
              </Stack>
            )}

            {workspaceMeta.totalPages > 1 && (
              <Stack alignItems="center" sx={{ mt: 2 }}>
                <Pagination count={workspaceMeta.totalPages} page={page} onChange={(event, value) => setPage(value)} />
              </Stack>
            )}
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
};

export default FeedbackPage;
