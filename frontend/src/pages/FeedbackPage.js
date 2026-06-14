import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
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
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import { UserContext } from '../contexts/UserContext';
import axiosInstance from '../axiosConfig';

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

const statusLabels = {
  new: 'Novo',
  reviewing: 'U pregledu',
  planned: 'Planirano',
  fixed: 'Rijeseno',
  rejected: 'Odbijeno',
};

const priorityColors = {
  low: 'default',
  normal: 'primary',
  high: 'warning',
  urgent: 'error',
};

const initialForm = {
  title: '',
  description: '',
  type: 'suggestion',
  priority: 'normal',
  area: 'other',
};

const getOptionLabel = (options, value) =>
  options.find((option) => option.value === value)?.label || value || 'N/A';

const formatDateTime = (value) => {
  if (!value) return 'N/A';
  return new Date(value).toLocaleString();
};

const FeedbackPage = () => {
  const { user } = useContext(UserContext);
  const [form, setForm] = useState(initialForm);
  const [feedback, setFeedback] = useState([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const fetchFeedback = useCallback(() => {
    setLoading(true);

    axiosInstance
      .get('/feedback', { params: { limit: 50 } })
      .then((response) => {
        setFeedback(Array.isArray(response.data) ? response.data : []);
      })
      .catch((error) => {
        console.error('Error fetching feedback:', error);
        setErrorMessage('Nije moguce ucitati ranije prijave.');
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchFeedback();
  }, [fetchFeedback]);

  const sortedFeedback = useMemo(
    () => [...feedback].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)),
    [feedback]
  );

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
      .then((response) => {
        const created = response.data?.feedback;
        setFeedback((current) => (created ? [created, ...current] : current));
        setForm(initialForm);
        setMessage('Prijava je poslana adminu.');
      })
      .catch((error) => {
        console.error('Error submitting feedback:', error);
        setErrorMessage(error.response?.data?.message || 'Slanje prijave nije uspjelo.');
      })
      .finally(() => setSubmitting(false));
  };

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, bgcolor: 'background.default', minHeight: '100vh' }}>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={2}
        justifyContent="space-between"
        alignItems={{ xs: 'flex-start', md: 'center' }}
        sx={{ mb: 3 }}
      >
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 800 }}>
            Feedback
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Posalji bug, sugestiju ili produkcijski problem administratoru.
          </Typography>
        </Box>

        <Button
          variant="outlined"
          startIcon={<RefreshIcon />}
          onClick={fetchFeedback}
          disabled={loading}
        >
          Refresh
        </Button>
      </Stack>

      {message && <Alert severity="success" sx={{ mb: 2 }}>{message}</Alert>}
      {errorMessage && <Alert severity="error" sx={{ mb: 2 }}>{errorMessage}</Alert>}

      <Grid container spacing={3}>
        <Grid item xs={12} lg={5}>
          <Paper variant="outlined" sx={{ p: 3, borderRadius: 2 }}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
              <AddCommentIcon color="primary" />
              <Box>
                <Typography variant="h6" sx={{ fontWeight: 800 }}>
                  Nova prijava
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {user?.username || 'Korisnik'} / {user?.role || 'Role'}
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
                  placeholder="Sta se desilo, gdje u aplikaciji, sta si ocekivao/la da se desi?"
                />

                <Button
                  type="submit"
                  variant="contained"
                  startIcon={<SendIcon />}
                  disabled={submitting}
                >
                  {submitting ? 'Slanje...' : 'Posalji'}
                </Button>
              </Stack>
            </Box>
          </Paper>
        </Grid>

        <Grid item xs={12} lg={7}>
          <Paper variant="outlined" sx={{ p: 3, borderRadius: 2 }}>
            <Typography variant="h6" sx={{ fontWeight: 800, mb: 2 }}>
              Moje prijave
            </Typography>

            {sortedFeedback.length === 0 ? (
              <Alert severity="info">
                Nema ranijih prijava.
              </Alert>
            ) : (
              <Stack spacing={1.5}>
                {sortedFeedback.map((item) => (
                  <Paper key={item._id} variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                    <Stack
                      direction={{ xs: 'column', sm: 'row' }}
                      justifyContent="space-between"
                      spacing={1}
                    >
                      <Box sx={{ minWidth: 0 }}>
                        <Typography variant="subtitle1" sx={{ fontWeight: 800 }} noWrap>
                          {item.title}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {formatDateTime(item.createdAt)} / {getOptionLabel(areaOptions, item.area)}
                        </Typography>
                      </Box>
                      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                        <Chip
                          icon={<VisibilityOutlinedIcon />}
                          label={item.adminSeenAt ? 'Admin vidio' : 'Ceka pregled'}
                          size="small"
                          color={item.adminSeenAt ? 'success' : 'default'}
                          variant={item.adminSeenAt ? 'filled' : 'outlined'}
                        />
                        <Chip label={statusLabels[item.status] || item.status} size="small" />
                        <Chip
                          label={getOptionLabel(priorityOptions, item.priority)}
                          size="small"
                          color={priorityColors[item.priority] || 'default'}
                        />
                      </Stack>
                    </Stack>

                    <Typography variant="body2" color="text.secondary" sx={{ mt: 1, whiteSpace: 'pre-wrap' }}>
                      {item.description}
                    </Typography>

                    {item.adminSeenAt && (
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                        Pregledano: {formatDateTime(item.adminSeenAt)}
                        {item.adminSeenBy?.username ? ` / ${item.adminSeenBy.username}` : ''}
                      </Typography>
                    )}

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
                            {formatDateTime(item.adminResponseAt)}
                            {item.adminResponseBy?.username ? ` / ${item.adminResponseBy.username}` : ''}
                          </Typography>
                        )}
                      </>
                    )}
                  </Paper>
                ))}
              </Stack>
            )}
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
};

export default FeedbackPage;
