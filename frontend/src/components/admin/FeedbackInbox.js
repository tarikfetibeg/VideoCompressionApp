import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import MarkEmailReadIcon from '@mui/icons-material/MarkEmailRead';
import RefreshIcon from '@mui/icons-material/Refresh';
import ReplyIcon from '@mui/icons-material/Reply';
import SaveIcon from '@mui/icons-material/Save';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import axiosInstance from '../../axiosConfig';

const statusOptions = [
  { value: 'all', label: 'Svi statusi' },
  { value: 'new', label: 'Novo' },
  { value: 'reviewing', label: 'U pregledu' },
  { value: 'planned', label: 'Planirano' },
  { value: 'fixed', label: 'Rijeseno' },
  { value: 'rejected', label: 'Odbijeno' },
];

const typeOptions = [
  { value: 'all', label: 'Svi tipovi' },
  { value: 'bug', label: 'Bug' },
  { value: 'suggestion', label: 'Sugestija' },
  { value: 'workflow_issue', label: 'Workflow problem' },
  { value: 'urgent_production_issue', label: 'Hitno za produkciju' },
];

const priorityOptions = [
  { value: 'all', label: 'Svi prioriteti' },
  { value: 'low', label: 'Nisko' },
  { value: 'normal', label: 'Normalno' },
  { value: 'high', label: 'Visoko' },
  { value: 'urgent', label: 'Hitno' },
];

const areaOptions = [
  { value: 'all', label: 'Sva podrucja' },
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

const priorityColors = {
  low: 'default',
  normal: 'primary',
  high: 'warning',
  urgent: 'error',
};

const statusColors = {
  new: 'primary',
  reviewing: 'warning',
  planned: 'secondary',
  fixed: 'success',
  rejected: 'default',
};

const getLabel = (options, value) =>
  options.find((option) => option.value === value)?.label || value || 'N/A';

const formatDateTime = (value) => {
  if (!value) return 'N/A';
  return new Date(value).toLocaleString();
};

const FeedbackCard = ({ feedback, users, onUpdate, onComment, onMarkSeen }) => {
  const [draft, setDraft] = useState({
    status: feedback.status || 'new',
    priority: feedback.priority || 'normal',
    assignedTo: feedback.assignedTo?._id || '',
    adminComment: feedback.adminComment || '',
    adminResponse: feedback.adminResponse || '',
  });
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);
  const [commenting, setCommenting] = useState(false);
  const [markingSeen, setMarkingSeen] = useState(false);

  useEffect(() => {
    setDraft({
      status: feedback.status || 'new',
      priority: feedback.priority || 'normal',
      assignedTo: feedback.assignedTo?._id || '',
      adminComment: feedback.adminComment || '',
      adminResponse: feedback.adminResponse || '',
    });
  }, [feedback]);

  const handleDraftChange = (event) => {
    const { name, value } = event.target;
    setDraft((current) => ({
      ...current,
      [name]: value,
    }));
  };

  const handleSave = () => {
    setSaving(true);
    onUpdate(feedback._id, draft).finally(() => setSaving(false));
  };

  const handleComment = () => {
    if (!comment.trim()) return;
    setCommenting(true);
    onComment(feedback._id, comment.trim())
      .then(() => setComment(''))
      .finally(() => setCommenting(false));
  };

  const handleMarkSeen = () => {
    setMarkingSeen(true);
    onMarkSeen(feedback._id).finally(() => setMarkingSeen(false));
  };

  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
      <Stack
        direction={{ xs: 'column', lg: 'row' }}
        spacing={2}
        justifyContent="space-between"
      >
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
            <Chip
              label={getLabel(statusOptions, feedback.status)}
              size="small"
              color={statusColors[feedback.status] || 'default'}
            />
            <Chip
              label={getLabel(priorityOptions, feedback.priority)}
              size="small"
              color={priorityColors[feedback.priority] || 'default'}
            />
            <Chip label={getLabel(typeOptions, feedback.type)} size="small" variant="outlined" />
            <Chip label={getLabel(areaOptions, feedback.area)} size="small" variant="outlined" />
            <Chip
              icon={<VisibilityOutlinedIcon />}
              label={feedback.adminSeenAt ? 'Seen' : 'Not seen'}
              size="small"
              color={feedback.adminSeenAt ? 'success' : 'default'}
              variant={feedback.adminSeenAt ? 'filled' : 'outlined'}
            />
          </Stack>

          <Typography variant="h6" sx={{ fontWeight: 800 }} noWrap>
            {feedback.title}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {formatDateTime(feedback.createdAt)} / {feedback.submittedBy?.username || 'Unknown'} / {feedback.submittedByRole || feedback.submittedBy?.role || 'Role'}
          </Typography>
          <Typography variant="body2" sx={{ mt: 1, whiteSpace: 'pre-wrap' }}>
            {feedback.description}
          </Typography>

          {feedback.pageUrl && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
              Page: {feedback.pageUrl}
            </Typography>
          )}

          {feedback.adminSeenAt && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
              Seen: {formatDateTime(feedback.adminSeenAt)}
              {feedback.adminSeenBy?.username ? ` / ${feedback.adminSeenBy.username}` : ''}
            </Typography>
          )}
        </Box>

        <Box sx={{ width: { xs: '100%', lg: 390 }, flexShrink: 0 }}>
          <Grid container spacing={1.5}>
            <Grid item xs={6}>
              <FormControl fullWidth size="small">
                <InputLabel>Status</InputLabel>
                <Select name="status" value={draft.status} label="Status" onChange={handleDraftChange}>
                  {statusOptions.filter((option) => option.value !== 'all').map((option) => (
                    <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={6}>
              <FormControl fullWidth size="small">
                <InputLabel>Prioritet</InputLabel>
                <Select name="priority" value={draft.priority} label="Prioritet" onChange={handleDraftChange}>
                  {priorityOptions.filter((option) => option.value !== 'all').map((option) => (
                    <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12}>
              <FormControl fullWidth size="small">
                <InputLabel>Assigned to</InputLabel>
                <Select name="assignedTo" value={draft.assignedTo} label="Assigned to" onChange={handleDraftChange}>
                  <MenuItem value="">Nije dodijeljeno</MenuItem>
                  {users.map((user) => (
                    <MenuItem key={user._id} value={user._id}>
                      {user.username} / {user.role}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12}>
              <TextField
                name="adminComment"
                label="Interna admin biljeska"
                value={draft.adminComment}
                onChange={handleDraftChange}
                fullWidth
                size="small"
                multiline
                minRows={2}
                helperText="Ovo vidi admin tim, ne korisnik koji je poslao prijavu."
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                name="adminResponse"
                label="Odgovor korisniku"
                value={draft.adminResponse}
                onChange={handleDraftChange}
                fullWidth
                size="small"
                multiline
                minRows={2}
                helperText="Ovaj tekst vidi korisnik u svojim prijavama."
              />
            </Grid>
            <Grid item xs={12}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                <Button
                  fullWidth
                  variant="outlined"
                  startIcon={<MarkEmailReadIcon />}
                  onClick={handleMarkSeen}
                  disabled={markingSeen || Boolean(feedback.adminSeenAt)}
                >
                  {feedback.adminSeenAt ? 'Seen' : 'Mark seen'}
                </Button>
                <Button
                  fullWidth
                  variant="contained"
                  startIcon={<SaveIcon />}
                  onClick={handleSave}
                  disabled={saving}
                >
                  {saving ? 'Saving...' : 'Save triage'}
                </Button>
              </Stack>
            </Grid>
          </Grid>
        </Box>
      </Stack>

      {feedback.adminResponse && (
        <Paper variant="outlined" sx={{ mt: 2, p: 1.5, borderRadius: 2, bgcolor: 'action.hover' }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
            <ReplyIcon fontSize="small" color="primary" />
            <Typography variant="caption" color="text.secondary">
              Public response
            </Typography>
          </Stack>
          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
            {feedback.adminResponse}
          </Typography>
          {feedback.adminResponseAt && (
            <Typography variant="caption" color="text.secondary">
              {formatDateTime(feedback.adminResponseAt)}
              {feedback.adminResponseBy?.username ? ` / ${feedback.adminResponseBy.username}` : ''}
            </Typography>
          )}
        </Paper>
      )}

      <Divider sx={{ my: 2 }} />

      <Grid container spacing={1.5} alignItems="flex-start">
        <Grid item xs={12} md={8}>
          {feedback.comments?.length > 0 ? (
            <Stack spacing={1}>
              {feedback.comments.map((item) => (
                <Box key={item._id || `${item.createdAt}-${item.body}`}>
                  <Typography variant="caption" color="text.secondary">
                    {item.author?.username || 'Admin'} / {formatDateTime(item.createdAt)}
                  </Typography>
                  <Typography variant="body2">{item.body}</Typography>
                </Box>
              ))}
            </Stack>
          ) : (
            <Typography variant="body2" color="text.secondary">
              Nema internih komentara.
            </Typography>
          )}
        </Grid>
        <Grid item xs={12} md={4}>
          <Stack spacing={1}>
            <TextField
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              label="Interni komentar"
              size="small"
              fullWidth
              multiline
              minRows={2}
            />
            <Button
              variant="outlined"
              startIcon={<AddCommentIcon />}
              onClick={handleComment}
              disabled={commenting || !comment.trim()}
            >
              Add comment
            </Button>
          </Stack>
        </Grid>
      </Grid>
    </Paper>
  );
};

const FeedbackInbox = () => {
  const [feedback, setFeedback] = useState([]);
  const [users, setUsers] = useState([]);
  const [filters, setFilters] = useState({
    status: 'new',
    type: 'all',
    priority: 'all',
    area: 'all',
    search: '',
  });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const fetchUsers = useCallback(() => {
    axiosInstance
      .get('/admin/users')
      .then((response) => setUsers(Array.isArray(response.data) ? response.data : []))
      .catch((error) => console.error('Error fetching users:', error));
  }, []);

  const fetchFeedback = useCallback(() => {
    setLoading(true);
    setErrorMessage('');

    axiosInstance
      .get('/feedback', { params: { ...filters, limit: 300 } })
      .then((response) => setFeedback(Array.isArray(response.data) ? response.data : []))
      .catch((error) => {
        console.error('Error fetching feedback inbox:', error);
        setErrorMessage('Nije moguce ucitati feedback inbox.');
      })
      .finally(() => setLoading(false));
  }, [filters]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  useEffect(() => {
    fetchFeedback();
  }, [fetchFeedback]);

  const stats = useMemo(() => ({
    total: feedback.length,
    urgent: feedback.filter((item) => item.priority === 'urgent').length,
    newItems: feedback.filter((item) => item.status === 'new').length,
    unseen: feedback.filter((item) => !item.adminSeenAt).length,
    open: feedback.filter((item) => ['new', 'reviewing', 'planned'].includes(item.status)).length,
  }), [feedback]);

  const handleFilterChange = (event) => {
    const { name, value } = event.target;
    setFilters((current) => ({
      ...current,
      [name]: value,
    }));
  };

  const updateFeedback = (feedbackId, payload) => {
    setMessage('');
    setErrorMessage('');

    return axiosInstance
      .patch(`/feedback/${feedbackId}`, payload)
      .then((response) => {
        setFeedback((current) =>
          current.map((item) => (item._id === feedbackId ? response.data.feedback : item))
        );
        setMessage('Feedback je azuriran.');
      })
      .catch((error) => {
        console.error('Error updating feedback:', error);
        setErrorMessage(error.response?.data?.message || 'Azuriranje feedbacka nije uspjelo.');
      });
  };

  const commentFeedback = (feedbackId, body) => {
    setMessage('');
    setErrorMessage('');

    return axiosInstance
      .post(`/feedback/${feedbackId}/comments`, { body })
      .then((response) => {
        setFeedback((current) =>
          current.map((item) => (item._id === feedbackId ? response.data.feedback : item))
        );
        setMessage('Komentar je dodan.');
      })
      .catch((error) => {
        console.error('Error commenting feedback:', error);
        setErrorMessage(error.response?.data?.message || 'Komentar nije spremljen.');
      });
  };

  const markFeedbackSeen = (feedbackId) => {
    setMessage('');
    setErrorMessage('');

    return axiosInstance
      .post(`/feedback/${feedbackId}/seen`)
      .then((response) => {
        setFeedback((current) =>
          current.map((item) => (item._id === feedbackId ? response.data.feedback : item))
        );
        setMessage('Prijava je oznacena kao pregledana.');
      })
      .catch((error) => {
        console.error('Error marking feedback as seen:', error);
        setErrorMessage(error.response?.data?.message || 'Oznacavanje prijave nije uspjelo.');
      });
  };

  return (
    <Box>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        justifyContent="space-between"
        alignItems={{ xs: 'flex-start', md: 'center' }}
        spacing={2}
        sx={{ mb: 3 }}
      >
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 800 }}>
            Feedback Inbox
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Bug reports, sugestije korisnika i operativni problemi na jednom mjestu.
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

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={6} md={3}>
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
            <Typography variant="overline" color="text.secondary">Loaded</Typography>
            <Typography variant="h5" sx={{ fontWeight: 800 }}>{stats.total}</Typography>
          </Paper>
        </Grid>
        <Grid item xs={6} md={3}>
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
            <Typography variant="overline" color="text.secondary">Open</Typography>
            <Typography variant="h5" sx={{ fontWeight: 800 }}>{stats.open}</Typography>
          </Paper>
        </Grid>
        <Grid item xs={6} md={3}>
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
            <Typography variant="overline" color="text.secondary">New</Typography>
            <Typography variant="h5" sx={{ fontWeight: 800 }}>{stats.newItems}</Typography>
          </Paper>
        </Grid>
        <Grid item xs={6} md={3}>
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
            <Typography variant="overline" color="text.secondary">Urgent</Typography>
            <Typography variant="h5" sx={{ fontWeight: 800 }}>{stats.urgent}</Typography>
          </Paper>
        </Grid>
        <Grid item xs={6} md={3}>
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
            <Typography variant="overline" color="text.secondary">Unseen</Typography>
            <Typography variant="h5" sx={{ fontWeight: 800 }}>{stats.unseen}</Typography>
          </Paper>
        </Grid>
      </Grid>

      <Paper variant="outlined" sx={{ p: 2, mb: 3, borderRadius: 2 }}>
        <Grid container spacing={2}>
          <Grid item xs={12} md={4}>
            <TextField
              name="search"
              label="Search"
              value={filters.search}
              onChange={handleFilterChange}
              fullWidth
              size="small"
            />
          </Grid>
          <Grid item xs={6} md={2}>
            <FormControl fullWidth size="small">
              <InputLabel>Status</InputLabel>
              <Select name="status" value={filters.status} label="Status" onChange={handleFilterChange}>
                {statusOptions.map((option) => (
                  <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={6} md={2}>
            <FormControl fullWidth size="small">
              <InputLabel>Tip</InputLabel>
              <Select name="type" value={filters.type} label="Tip" onChange={handleFilterChange}>
                {typeOptions.map((option) => (
                  <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={6} md={2}>
            <FormControl fullWidth size="small">
              <InputLabel>Prioritet</InputLabel>
              <Select name="priority" value={filters.priority} label="Prioritet" onChange={handleFilterChange}>
                {priorityOptions.map((option) => (
                  <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={6} md={2}>
            <FormControl fullWidth size="small">
              <InputLabel>Podrucje</InputLabel>
              <Select name="area" value={filters.area} label="Podrucje" onChange={handleFilterChange}>
                {areaOptions.map((option) => (
                  <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
        </Grid>
      </Paper>

      {feedback.length === 0 ? (
        <Alert severity="info">
          Nema prijava za trenutne filtere.
        </Alert>
      ) : (
        <Stack spacing={2}>
          {feedback.map((item) => (
            <FeedbackCard
              key={item._id}
              feedback={item}
              users={users}
              onUpdate={updateFeedback}
              onComment={commentFeedback}
              onMarkSeen={markFeedbackSeen}
            />
          ))}
        </Stack>
      )}
    </Box>
  );
};

export default FeedbackInbox;
