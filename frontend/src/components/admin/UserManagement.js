import React, { useEffect, useState } from 'react';
import {
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  Button,
  Box,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Dialog,
  DialogTitle,
  DialogContent,
  TextField,
  DialogActions,
  Alert,
  Typography,
} from '@mui/material';
import axiosInstance from '../../axiosConfig';

const roles = ['Reporter', 'Editor', 'VideoEditor', 'Producer', 'Admin'];

const UserManagement = () => {
  const [users, setUsers] = useState([]);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [newPassword, setNewPassword] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [newUserRole, setNewUserRole] = useState('Reporter');
  const [message, setMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = () => {
    axiosInstance.get('/admin/users')
      .then(response => setUsers(response.data))
      .catch(err => console.error('Error fetching users:', err));
  };

  const handleRoleChange = (userId, newRole) => {
    axiosInstance.put(`/admin/users/${userId}`, { role: newRole })
      .then(response => {
        setUsers(users.map(u => (u._id === userId ? response.data.user : u)));
        setMessage('User role updated successfully.');
        setErrorMessage('');
      })
      .catch(err => {
        console.error('Error updating role:', err);
        setErrorMessage('Error updating role.');
      });
  };

  const handleCreateUser = () => {
    axiosInstance.post('/admin/users', {
      username: newUsername,
      password: newUserPassword,
      role: newUserRole,
    })
      .then(response => {
        setUsers([...users, response.data.user]);
        setMessage('User created successfully.');
        setErrorMessage('');
        setCreateDialogOpen(false);
        setNewUsername('');
        setNewUserPassword('');
        setNewUserRole('Reporter');
      })
      .catch(err => {
        console.error('Error creating user:', err);
        setErrorMessage(err.response?.data?.message || 'Error creating user.');
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
    axiosInstance.put(`/admin/users/${selectedUserId}/reset-password`, { newPassword })
      .then(response => {
        setMessage('Password reset successfully.');
        setErrorMessage('');
        handleCloseResetDialog();
      })
      .catch(err => {
        console.error('Error resetting password:', err);
        setErrorMessage('Error resetting password.');
      });
  };

  return (
    <div>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h5" sx={{ fontWeight: 800 }}>
          User Management
        </Typography>
        <Button variant="contained" onClick={() => setCreateDialogOpen(true)}>
          Add User
        </Button>
      </Box>
      {message && <Alert severity="success" sx={{ mb: 2 }}>{message}</Alert>}
      {errorMessage && <Alert severity="error" sx={{ mb: 2 }}>{errorMessage}</Alert>}
      <Table>
        <TableHead>
          <TableRow>
            <TableCell>Username</TableCell>
            <TableCell>Role</TableCell>
            <TableCell>Actions</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {users.map(user => (
            <TableRow key={user._id}>
              <TableCell>{user.username}</TableCell>
              <TableCell>
                <FormControl variant="standard">
                  <InputLabel id={`role-label-${user._id}`}>Role</InputLabel>
                  <Select
                    labelId={`role-label-${user._id}`}
                    value={user.role}
                    onChange={(e) => handleRoleChange(user._id, e.target.value)}
                  >
                    {roles.map(role => (
                      <MenuItem key={role} value={role}>
                        {role}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </TableCell>
              <TableCell>
                <Button variant="outlined" onClick={() => handleOpenResetDialog(user._id)}>
                  Reset Password
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Dialog open={createDialogOpen} onClose={() => setCreateDialogOpen(false)}>
        <DialogTitle>Add User</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="Username"
            fullWidth
            variant="standard"
            value={newUsername}
            onChange={(e) => setNewUsername(e.target.value)}
          />
          <TextField
            margin="dense"
            label="Password"
            type="password"
            fullWidth
            variant="standard"
            helperText="Minimum 8 characters."
            value={newUserPassword}
            onChange={(e) => setNewUserPassword(e.target.value)}
          />
          <FormControl fullWidth variant="standard" sx={{ mt: 2 }}>
            <InputLabel id="new-user-role-label">Role</InputLabel>
            <Select
              labelId="new-user-role-label"
              value={newUserRole}
              onChange={(e) => setNewUserRole(e.target.value)}
            >
              {roles.map(role => (
                <MenuItem key={role} value={role}>
                  {role}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleCreateUser}>Create</Button>
        </DialogActions>
      </Dialog>

      {/* Reset Password Dialog */}
      <Dialog open={resetDialogOpen} onClose={handleCloseResetDialog}>
        <DialogTitle>Reset Password</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="New Password"
            type="password"
            fullWidth
            variant="standard"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseResetDialog}>Cancel</Button>
          <Button onClick={handleResetPassword}>Reset</Button>
        </DialogActions>
      </Dialog>
    </div>
  );
};

export default UserManagement;
