import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  Grid,
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
import AddIcon from '@mui/icons-material/Add';
import LockResetIcon from '@mui/icons-material/LockReset';
import RefreshIcon from '@mui/icons-material/Refresh';
import axiosInstance from '../../axiosConfig';
import { EmptyState, FilterBar, KpiStrip, StatusChip } from '../common/WorkspaceChrome';
import { formatNumberBs, formatRole, roleLabels } from '../../utils/uiLabels';

const roles = ['Reporter', 'Editor', 'VideoEditor', 'Producer', 'Realizator', 'Archivist', 'Admin'];

const UserManagement = () => {
  const [users, setUsers] = useState([]);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [newPassword, setNewPassword] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [newUserRole, setNewUserRole] = useState('Reporter');
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const fetchUsers = () => {
    setLoading(true);
    axiosInstance
      .get('/admin/users')
      .then((response) => {
        setUsers(Array.isArray(response.data) ? response.data : []);
        setErrorMessage('');
      })
      .catch((err) => {
        console.error('Error fetching users:', err);
        setErrorMessage('Korisnici nisu ucitani.');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const filteredUsers = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return users.filter((user) => {
      const matchesRole = roleFilter === 'all' || user.role === roleFilter;
      const matchesSearch =
        !normalizedSearch ||
        [user.username, user.role, formatRole(user.role)]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(normalizedSearch));

      return matchesRole && matchesSearch;
    });
  }, [roleFilter, search, users]);

  const roleCounts = useMemo(() => {
    const counts = roles.reduce((acc, role) => ({ ...acc, [role]: 0 }), {});
    users.forEach((user) => {
      counts[user.role] = (counts[user.role] || 0) + 1;
    });
    return counts;
  }, [users]);

  const kpis = [
    { label: 'Ukupno', value: formatNumberBs(users.length) },
    { label: 'Admin', value: formatNumberBs(roleCounts.Admin), color: 'primary.main' },
    { label: 'Produkcija', value: formatNumberBs((roleCounts.Editor || 0) + (roleCounts.VideoEditor || 0) + (roleCounts.Producer || 0)) },
    { label: 'Reporter', value: formatNumberBs(roleCounts.Reporter) },
    { label: 'Arhiva', value: formatNumberBs(roleCounts.Archivist) },
    { label: 'Realizacija', value: formatNumberBs(roleCounts.Realizator) },
  ];

  const handleRoleChange = (userId, newRole) => {
    setMessage('');
    setErrorMessage('');

    axiosInstance
      .put(`/admin/users/${userId}`, { role: newRole })
      .then((response) => {
        setUsers((current) => current.map((user) => (user._id === userId ? response.data.user : user)));
        setMessage('Rola je azurirana.');
      })
      .catch((err) => {
        console.error('Error updating role:', err);
        setErrorMessage(err.response?.data?.message || 'Rola nije azurirana.');
      });
  };

  const handleCreateUser = () => {
    setMessage('');
    setErrorMessage('');

    axiosInstance
      .post('/admin/users', {
        username: newUsername,
        password: newUserPassword,
        role: newUserRole,
      })
      .then((response) => {
        setUsers((current) => [...current, response.data.user]);
        setMessage('Korisnik je kreiran.');
        setCreateDialogOpen(false);
        setNewUsername('');
        setNewUserPassword('');
        setNewUserRole('Reporter');
      })
      .catch((err) => {
        console.error('Error creating user:', err);
        setErrorMessage(err.response?.data?.message || 'Korisnik nije kreiran.');
      });
  };

  const handleOpenResetDialog = (userId) => {
    setSelectedUserId(userId);
    setResetDialogOpen(true);
  };

  const handleCloseResetDialog = () => {
    setResetDialogOpen(false);
    setSelectedUserId(null);
    setNewPassword('');
  };

  const handleResetPassword = () => {
    setMessage('');
    setErrorMessage('');

    axiosInstance
      .put(`/admin/users/${selectedUserId}/reset-password`, { newPassword })
      .then(() => {
        setMessage('Lozinka je resetovana.');
        handleCloseResetDialog();
      })
      .catch((err) => {
        console.error('Error resetting password:', err);
        setErrorMessage(err.response?.data?.message || 'Lozinka nije resetovana.');
      });
  };

  return (
    <Box>
      <FilterBar
        title="Korisnici i role"
        summary="Operativni pregled naloga, rola i resetovanja lozinki."
        actions={(
          <Stack direction="row" spacing={1}>
            <Button variant="outlined" startIcon={<RefreshIcon />} onClick={fetchUsers} disabled={loading}>
              Osvjezi
            </Button>
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreateDialogOpen(true)}>
              Novi korisnik
            </Button>
          </Stack>
        )}
      >
        <Grid container spacing={1.5}>
          <Grid item xs={12} md={8}>
            <TextField
              label="Pretraga"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              fullWidth
              size="small"
            />
          </Grid>
          <Grid item xs={12} md={4}>
            <FormControl fullWidth size="small">
              <InputLabel>Rola</InputLabel>
              <Select value={roleFilter} label="Rola" onChange={(event) => setRoleFilter(event.target.value)}>
                <MenuItem value="all">Sve role</MenuItem>
                {roles.map((role) => (
                  <MenuItem key={role} value={role}>{formatRole(role)}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
        </Grid>
      </FilterBar>

      {message && <Alert severity="success" sx={{ mb: 2 }}>{message}</Alert>}
      {errorMessage && <Alert severity="error" sx={{ mb: 2 }}>{errorMessage}</Alert>}

      <KpiStrip items={kpis} dense />

      {filteredUsers.length === 0 ? (
        <EmptyState title="Nema korisnika" description="Nema korisnika za trenutni filter." />
      ) : (
        <TableContainer sx={{ border: 1, borderColor: 'divider', borderRadius: 1.5 }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Korisnik</TableCell>
                <TableCell>Rola</TableCell>
                <TableCell align="right">Akcije</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredUsers.map((user) => (
                <TableRow key={user._id} hover>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 800 }}>
                      {user.username}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {user._id}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ minWidth: 220 }}>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <StatusChip label={formatRole(user.role)} variant="outlined" />
                      <FormControl size="small" sx={{ minWidth: 180 }}>
                        <InputLabel>Promijeni rolu</InputLabel>
                        <Select
                          value={user.role}
                          label="Promijeni rolu"
                          onChange={(event) => handleRoleChange(user._id, event.target.value)}
                        >
                          {roles.map((role) => (
                            <MenuItem key={role} value={role}>{roleLabels[role] || role}</MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </Stack>
                  </TableCell>
                  <TableCell align="right">
                    <Button variant="outlined" startIcon={<LockResetIcon />} onClick={() => handleOpenResetDialog(user._id)}>
                      Reset lozinke
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Dialog open={createDialogOpen} onClose={() => setCreateDialogOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Novi korisnik</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              autoFocus
              label="Username"
              fullWidth
              value={newUsername}
              onChange={(event) => setNewUsername(event.target.value)}
            />
            <TextField
              label="Lozinka"
              type="password"
              fullWidth
              helperText="Minimalno 8 karaktera."
              value={newUserPassword}
              onChange={(event) => setNewUserPassword(event.target.value)}
            />
            <FormControl fullWidth>
              <InputLabel>Rola</InputLabel>
              <Select value={newUserRole} label="Rola" onChange={(event) => setNewUserRole(event.target.value)}>
                {roles.map((role) => (
                  <MenuItem key={role} value={role}>{formatRole(role)}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateDialogOpen(false)}>Odustani</Button>
          <Button variant="contained" onClick={handleCreateUser}>Kreiraj</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={resetDialogOpen} onClose={handleCloseResetDialog} fullWidth maxWidth="sm">
        <DialogTitle>Reset lozinke</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            label="Nova lozinka"
            type="password"
            fullWidth
            helperText="Minimalno 8 karaktera."
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseResetDialog}>Odustani</Button>
          <Button variant="contained" onClick={handleResetPassword}>Resetuj</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default UserManagement;
