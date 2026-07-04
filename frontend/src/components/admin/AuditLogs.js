import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Collapse,
  FormControl,
  Grid,
  IconButton,
  InputLabel,
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
  Typography,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import DownloadIcon from '@mui/icons-material/Download';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowRightIcon from '@mui/icons-material/KeyboardArrowRight';
import RefreshIcon from '@mui/icons-material/Refresh';
import axiosInstance from '../../axiosConfig';
import { ConfirmDialog, EmptyState, FilterBar, KpiStrip, StatusChip } from '../common/WorkspaceChrome';
import { auditSeverityLabels, formatNumberBs } from '../../utils/uiLabels';
import { getSearchParam } from '../../utils/searchParams';

const roleOptions = ['all', 'Reporter', 'Editor', 'VideoEditor', 'Producer', 'Realizator', 'Archivist', 'Admin'];

const severityOptions = [
  { value: 'all', label: 'All severity' },
  { value: 'critical', label: 'Critical' },
  { value: 'warning', label: 'Warning' },
  { value: 'info', label: 'Info' },
];

const severityColors = {
  critical: 'error',
  warning: 'warning',
  info: 'default',
};

const formatDateTime = (value) => {
  if (!value) return 'N/A';
  return new Date(value).toLocaleString();
};

const getUserLabel = (performedBy) => {
  if (!performedBy) return 'System';
  if (typeof performedBy === 'string') return performedBy;
  return `${performedBy.username || 'Unknown'}${performedBy.role ? ` / ${performedBy.role}` : ''}`;
};

const stringifyDetails = (details) => {
  if (!details) return '';

  try {
    return JSON.stringify(details);
  } catch (error) {
    return String(details);
  }
};

const summarizeValue = (value) => {
  if (Array.isArray(value)) return `${value.length} item(s)`;
  if (value && typeof value === 'object') return `${Object.keys(value).length} field(s)`;
  return String(value ?? '');
};

const summarizeDetails = (details) => {
  if (!details) return 'No details';
  if (typeof details !== 'object') return String(details).slice(0, 120);

  const priorityKeys = [
    'title',
    'filename',
    'originalName',
    'username',
    'role',
    'videoId',
    'jobId',
    'showDayId',
    'feedbackId',
    'status',
    'priority',
    'deleted',
    'skipped',
    'update',
  ];
  const keys = Object.keys(details);
  const selectedKeys = priorityKeys.filter((key) => keys.includes(key));
  const fallbackKeys = keys.filter((key) => !selectedKeys.includes(key));
  const summaryKeys = [...selectedKeys, ...fallbackKeys].slice(0, 3);

  if (summaryKeys.length === 0) return 'Empty details';

  return summaryKeys
    .map((key) => `${key}: ${summarizeValue(details[key])}`)
    .join(' / ');
};

const downloadTextFile = (filename, content, type) => {
  const blob = new Blob([content], { type });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
};

const escapeCsv = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;

const AuditLogs = () => {
  const [logs, setLogs] = useState([]);
  const [users, setUsers] = useState([]);
  const [expandedRows, setExpandedRows] = useState({});
  const [searchDraft, setSearchDraft] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [workspaceMeta, setWorkspaceMeta] = useState({
    total: 0,
    totalPages: 1,
    summary: {},
  });
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deletingLogs, setDeletingLogs] = useState(false);
  const [filters, setFilters] = useState({
    action: '',
    userId: 'all',
    role: 'all',
    severity: 'all',
    dateFrom: '',
    dateTo: '',
    limit: 250,
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

  const fetchLogs = useCallback(() => {
    setLoading(true);
    setErrorMessage('');

    axiosInstance
      .get('/admin/audit-logs/workspace', {
        params: {
          ...filters,
          page,
          action: filters.action || undefined,
          search: getSearchParam(debouncedSearch),
          dateFrom: filters.dateFrom || undefined,
          dateTo: filters.dateTo || undefined,
        },
      })
      .then((response) => {
        setLogs(Array.isArray(response.data?.items) ? response.data.items : []);
        setWorkspaceMeta({
          total: Number(response.data?.total) || 0,
          totalPages: Number(response.data?.totalPages) || 1,
          summary: response.data?.summary || {},
        });
      })
      .catch((err) => {
        console.error('Error fetching audit logs:', err);
        setErrorMessage('Error fetching audit logs.');
      })
      .finally(() => setLoading(false));
  }, [debouncedSearch, filters, page]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(searchDraft), 300);
    return () => window.clearTimeout(timer);
  }, [searchDraft]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const actionOptions = useMemo(() => {
    const actions = logs.map((log) => log.action).filter(Boolean);
    if (filters.action) actions.push(filters.action);
    return Array.from(new Set(actions)).sort();
  }, [filters.action, logs]);

  const stats = useMemo(() => ({
    total: workspaceMeta.summary.total ?? workspaceMeta.total ?? logs.length,
    critical: workspaceMeta.summary.critical ?? logs.filter((log) => log.severity === 'critical').length,
    warning: workspaceMeta.summary.warning ?? logs.filter((log) => log.severity === 'warning').length,
    info: workspaceMeta.summary.info ?? logs.filter((log) => log.severity === 'info').length,
  }), [logs, workspaceMeta]);

  const handleFilterChange = (event) => {
    const { name, value } = event.target;
    setPage(1);
    if (name === 'search') {
      setSearchDraft(value);
      return;
    }
    setFilters((current) => ({
      ...current,
      [name]: value,
    }));
  };

  const toggleDetails = (logId) => {
    setExpandedRows((current) => ({
      ...current,
      [logId]: !current[logId],
    }));
  };

  const exportJson = () => {
    downloadTextFile(
      `audit_logs_${Date.now()}.json`,
      JSON.stringify(logs, null, 2),
      'application/json;charset=utf-8'
    );
  };

  const exportCsv = () => {
    const rows = [
      ['timestamp', 'severity', 'action', 'performedBy', 'entity', 'details'],
      ...logs.map((log) => [
        formatDateTime(log.timestamp),
        log.severity,
        log.action,
        getUserLabel(log.performedBy),
        log.entity ? `${log.entity.type}:${log.entity.id}` : '',
        stringifyDetails(log.details),
      ]),
    ];

    downloadTextFile(
      `audit_logs_${Date.now()}.csv`,
      rows.map((row) => row.map(escapeCsv).join(',')).join('\n'),
      'text/csv;charset=utf-8'
    );
  };

  const deleteCurrentLogs = () => {
    setDeletingLogs(true);
    setMessage('');
    setErrorMessage('');

    axiosInstance
      .delete('/admin/audit-logs', {
        data: {
          ...filters,
          search: getSearchParam(debouncedSearch),
        },
      })
      .then((response) => {
        setMessage(response.data?.message || 'Audit logovi su obrisani.');
        setDeleteConfirmOpen(false);
        setExpandedRows({});
        fetchLogs();
      })
      .catch((error) => {
        console.error('Error deleting audit logs:', error);
        setErrorMessage(error.response?.data?.message || 'Audit logovi nisu obrisani.');
      })
      .finally(() => setDeletingLogs(false));
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
            Audit Logs
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Filtriran pregled sistemskih akcija, promjena i servisnih intervencija.
          </Typography>
        </Box>

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
          <Button variant="outlined" startIcon={<RefreshIcon />} onClick={fetchLogs} disabled={loading}>
            Refresh
          </Button>
          <Button variant="outlined" startIcon={<DownloadIcon />} onClick={exportCsv} disabled={logs.length === 0}>
            CSV
          </Button>
          <Button variant="outlined" startIcon={<DownloadIcon />} onClick={exportJson} disabled={logs.length === 0}>
            JSON
          </Button>
          <Button
            variant="outlined"
            color="error"
            startIcon={<DeleteIcon />}
            onClick={() => setDeleteConfirmOpen(true)}
            disabled={logs.length === 0 || loading}
          >
            Obrisi trenutne
          </Button>
        </Stack>
      </Stack>

      {message && <Alert severity="success" sx={{ mb: 2 }}>{message}</Alert>}
      {errorMessage && <Alert severity="error" sx={{ mb: 2 }}>{errorMessage}</Alert>}

      <KpiStrip
        items={[
          { label: 'Rezultata', value: formatNumberBs(stats.total) },
          { label: 'Kriticno', value: formatNumberBs(stats.critical), color: stats.critical > 0 ? 'error.main' : 'success.main' },
          { label: 'Upozorenja', value: formatNumberBs(stats.warning), color: stats.warning > 0 ? 'warning.main' : 'text.primary' },
          { label: 'Info', value: formatNumberBs(stats.info) },
        ]}
        dense
      />

      <FilterBar title="Audit filteri" summary="Pretraga je debounceovana, a lista je paginirana preko admin workspace endpointa.">
        <Grid container spacing={2}>
          <Grid item xs={12} md={3}>
            <TextField
              name="search"
              label="Search details"
              value={searchDraft}
              onChange={handleFilterChange}
              fullWidth
              size="small"
            />
          </Grid>
          <Grid item xs={12} md={2}>
            <TextField
              name="action"
              label="Action"
              value={filters.action}
              onChange={handleFilterChange}
              fullWidth
              size="small"
              select
            >
              <MenuItem value="">All actions</MenuItem>
              {actionOptions.map((action) => (
                <MenuItem key={action} value={action}>{action}</MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid item xs={6} md={2}>
            <FormControl fullWidth size="small">
              <InputLabel>User</InputLabel>
              <Select name="userId" value={filters.userId} label="User" onChange={handleFilterChange}>
                <MenuItem value="all">All users</MenuItem>
                {users.map((user) => (
                  <MenuItem key={user._id} value={user._id}>{user.username}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={6} md={2}>
            <FormControl fullWidth size="small">
              <InputLabel>Role</InputLabel>
              <Select name="role" value={filters.role} label="Role" onChange={handleFilterChange}>
                {roleOptions.map((role) => (
                  <MenuItem key={role} value={role}>{role === 'all' ? 'All roles' : role}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={6} md={1.5}>
            <FormControl fullWidth size="small">
              <InputLabel>Severity</InputLabel>
              <Select name="severity" value={filters.severity} label="Severity" onChange={handleFilterChange}>
                {severityOptions.map((option) => (
                  <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={6} md={1.5}>
            <TextField
              name="limit"
              label="Limit"
              value={filters.limit}
              onChange={handleFilterChange}
              fullWidth
              size="small"
              type="number"
              inputProps={{ min: 1, max: 200 }}
            />
          </Grid>
          <Grid item xs={6} md={2}>
            <TextField
              name="dateFrom"
              label="From"
              value={filters.dateFrom}
              onChange={handleFilterChange}
              fullWidth
              size="small"
              type="date"
              InputLabelProps={{ shrink: true }}
            />
          </Grid>
          <Grid item xs={6} md={2}>
            <TextField
              name="dateTo"
              label="To"
              value={filters.dateTo}
              onChange={handleFilterChange}
              fullWidth
              size="small"
              type="date"
              InputLabelProps={{ shrink: true }}
            />
          </Grid>
        </Grid>
      </FilterBar>

      {logs.length === 0 ? (
        <EmptyState
          title="Nema audit logova"
          description="Nema sistemskih akcija za odabrane filtere."
        />
      ) : (
        <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2 }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Time</TableCell>
                <TableCell>Severity</TableCell>
                <TableCell>Action</TableCell>
                <TableCell>User</TableCell>
                <TableCell>Entity</TableCell>
                <TableCell>Details</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {logs.map((log) => (
                <React.Fragment key={log._id}>
                  <TableRow hover>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      {formatDateTime(log.timestamp)}
                    </TableCell>
                    <TableCell>
                      <StatusChip
                        value={log.severity || 'info'}
                        maps={auditSeverityLabels}
                        tone={severityColors[log.severity] || 'default'}
                      />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>
                        {log.action}
                      </Typography>
                    </TableCell>
                    <TableCell>{getUserLabel(log.performedBy)}</TableCell>
                    <TableCell>
                      {log.entity ? (
                        <Chip label={`${log.entity.type}: ${log.entity.id}`} size="small" variant="outlined" />
                      ) : (
                        <Typography variant="caption" color="text.secondary">N/A</Typography>
                      )}
                    </TableCell>
                    <TableCell sx={{ maxWidth: 440 }}>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <IconButton
                          size="small"
                          onClick={() => toggleDetails(log._id)}
                          aria-label={expandedRows[log._id] ? 'Hide details' : 'Show details'}
                        >
                          {expandedRows[log._id] ? <KeyboardArrowDownIcon /> : <KeyboardArrowRightIcon />}
                        </IconButton>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            minWidth: 0,
                          }}
                        >
                          {summarizeDetails(log.details)}
                        </Typography>
                      </Stack>
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell colSpan={6} sx={{ py: 0, borderBottom: expandedRows[log._id] ? undefined : 0 }}>
                      <Collapse in={Boolean(expandedRows[log._id])} timeout="auto" unmountOnExit>
                        <Paper variant="outlined" sx={{ my: 1.5, p: 1.5, borderRadius: 2, bgcolor: 'action.hover' }}>
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                            Full details
                          </Typography>
                          <Typography
                            variant="caption"
                            component="pre"
                            sx={{
                              m: 0,
                              maxHeight: 260,
                              overflow: 'auto',
                              whiteSpace: 'pre-wrap',
                              wordBreak: 'break-word',
                              fontFamily: 'monospace',
                            }}
                          >
                            {stringifyDetails(log.details)}
                          </Typography>
                        </Paper>
                      </Collapse>
                    </TableCell>
                  </TableRow>
                </React.Fragment>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {workspaceMeta.totalPages > 1 && (
        <Stack alignItems="center" sx={{ mt: 2 }}>
          <Pagination count={workspaceMeta.totalPages} page={page} onChange={(event, value) => setPage(value)} />
          <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
            Stranica {page} / {workspaceMeta.totalPages}
          </Typography>
        </Stack>
      )}

      <ConfirmDialog
        open={deleteConfirmOpen}
        title="Obrisati audit logove?"
        description={`Ova akcija brise audit logove koji odgovaraju trenutnim filterima. Trenutno je ucitano ${logs.length} redova, a workspace total je ${workspaceMeta.total}.`}
        confirmLabel="Obrisi logove"
        confirmColor="error"
        busy={deletingLogs}
        onClose={() => setDeleteConfirmOpen(false)}
        onConfirm={deleteCurrentLogs}
      />
    </Box>
  );
};

export default AuditLogs;
