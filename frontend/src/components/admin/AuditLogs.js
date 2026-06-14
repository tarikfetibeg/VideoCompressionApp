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
import DownloadIcon from '@mui/icons-material/Download';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowRightIcon from '@mui/icons-material/KeyboardArrowRight';
import RefreshIcon from '@mui/icons-material/Refresh';
import axiosInstance from '../../axiosConfig';

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
  const [filters, setFilters] = useState({
    action: '',
    userId: 'all',
    role: 'all',
    severity: 'all',
    dateFrom: '',
    dateTo: '',
    search: '',
    limit: 250,
  });
  const [loading, setLoading] = useState(false);
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
      .get('/admin/audit-logs', {
        params: {
          ...filters,
          action: filters.action || undefined,
          search: filters.search || undefined,
          dateFrom: filters.dateFrom || undefined,
          dateTo: filters.dateTo || undefined,
        },
      })
      .then((response) => setLogs(Array.isArray(response.data) ? response.data : []))
      .catch((err) => {
        console.error('Error fetching audit logs:', err);
        setErrorMessage('Error fetching audit logs.');
      })
      .finally(() => setLoading(false));
  }, [filters]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const actionOptions = useMemo(() => {
    const actions = logs.map((log) => log.action).filter(Boolean);
    if (filters.action) actions.push(filters.action);
    return Array.from(new Set(actions)).sort();
  }, [filters.action, logs]);

  const stats = useMemo(() => ({
    total: logs.length,
    critical: logs.filter((log) => log.severity === 'critical').length,
    warning: logs.filter((log) => log.severity === 'warning').length,
    info: logs.filter((log) => log.severity === 'info').length,
  }), [logs]);

  const handleFilterChange = (event) => {
    const { name, value } = event.target;
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
        </Stack>
      </Stack>

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
            <Typography variant="overline" color="text.secondary">Critical</Typography>
            <Typography variant="h5" sx={{ fontWeight: 800 }}>{stats.critical}</Typography>
          </Paper>
        </Grid>
        <Grid item xs={6} md={3}>
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
            <Typography variant="overline" color="text.secondary">Warning</Typography>
            <Typography variant="h5" sx={{ fontWeight: 800 }}>{stats.warning}</Typography>
          </Paper>
        </Grid>
        <Grid item xs={6} md={3}>
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
            <Typography variant="overline" color="text.secondary">Info</Typography>
            <Typography variant="h5" sx={{ fontWeight: 800 }}>{stats.info}</Typography>
          </Paper>
        </Grid>
      </Grid>

      <Paper variant="outlined" sx={{ p: 2, mb: 3, borderRadius: 2 }}>
        <Grid container spacing={2}>
          <Grid item xs={12} md={3}>
            <TextField
              name="search"
              label="Search details"
              value={filters.search}
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
              inputProps={{ min: 1, max: 1000 }}
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
      </Paper>

      {logs.length === 0 ? (
        <Alert severity="info">
          No audit logs available for selected filters.
        </Alert>
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
                      <Chip
                        label={log.severity || 'info'}
                        size="small"
                        color={severityColors[log.severity] || 'default'}
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
    </Box>
  );
};

export default AuditLogs;
