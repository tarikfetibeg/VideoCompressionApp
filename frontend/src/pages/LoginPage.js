import React, { useContext, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import LoginIcon from '@mui/icons-material/Login';
import axios from '../axiosConfig';
import { UserContext } from '../contexts/UserContext';

const LoginPage = () => {
  const { login } = useContext(UserContext);
  const navigate = useNavigate();

  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const handleLogin = (event) => {
    event.preventDefault();
    setSubmitting(true);
    setErrorMessage('');

    axios
      .post('/auth/login', {
        username: loginUsername,
        password: loginPassword,
      })
      .then((response) => {
        const { token, user } = response.data;
        login({ ...user, token });
        navigate('/');
      })
      .catch((error) => {
        setErrorMessage(
          error.response?.data?.message ||
          error.message ||
          'Login nije uspio.'
        );
      })
      .finally(() => setSubmitting(false));
  };

  return (
    <Box
      sx={{
        minHeight: 'calc(100vh - 96px)',
        display: 'grid',
        placeItems: 'center',
        px: 2,
      }}
    >
      <Paper
        variant="outlined"
        component="form"
        onSubmit={handleLogin}
        sx={{
          width: '100%',
          maxWidth: 420,
          p: { xs: 2.5, sm: 3 },
          borderRadius: 1.5,
        }}
      >
        <Stack spacing={2}>
          <Box>
            <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 800 }}>
              VideoCompressionApp
            </Typography>
            <Typography variant="h4" sx={{ fontWeight: 900, lineHeight: 1.1 }}>
              Prijava
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
              Za novi nalog kontaktiraj administratora.
            </Typography>
          </Box>

          {errorMessage && <Alert severity="error">{errorMessage}</Alert>}

          <TextField
            label="Username"
            value={loginUsername}
            onChange={(event) => setLoginUsername(event.target.value)}
            fullWidth
            required
            autoFocus
          />
          <TextField
            label="Password"
            type="password"
            value={loginPassword}
            onChange={(event) => setLoginPassword(event.target.value)}
            fullWidth
            required
          />
          <Button type="submit" variant="contained" startIcon={<LoginIcon />} disabled={submitting}>
            {submitting ? 'Prijava...' : 'Login'}
          </Button>
        </Stack>
      </Paper>
    </Box>
  );
};

export default LoginPage;
