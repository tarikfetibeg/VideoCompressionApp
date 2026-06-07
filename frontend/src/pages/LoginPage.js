import React, { useState, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from '../axiosConfig';
import {
  Box,
  Button,
  TextField,
  Alert,
  Typography,
} from '@mui/material';
import { UserContext } from '../contexts/UserContext';

const LoginPage = () => {
  const { login } = useContext(UserContext);
  const navigate = useNavigate();

  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  const [errorMessage, setErrorMessage] = useState('');

  const handleLogin = () => {
    axios
      .post('/auth/login', {
        username: loginUsername,
        password: loginPassword,
      })
      .then((response) => {
        const { token, user } = response.data;

        // Combine token and user data into one object
        const userData = { ...user, token };

        // Use login function from context
        login(userData);

        navigate('/');
      })
      .catch((error) => {
        setErrorMessage(
          error.response && error.response.data
            ? error.response.data.message
            : 'Login failed.'
        );
      });
  };

  return (
    <Box sx={{ mt: 4, maxWidth: 400, mx: 'auto' }}>
      <Typography variant="h5" sx={{ fontWeight: 800, mb: 1 }}>
        Login
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Za novi nalog kontaktiraj administratora.
      </Typography>

      {errorMessage && (
        <Alert severity="error" sx={{ mt: 2 }}>
          {errorMessage}
        </Alert>
      )}

      <Box sx={{ mt: 2 }}>
        <TextField
          label="Username"
          value={loginUsername}
          onChange={(e) => setLoginUsername(e.target.value)}
          fullWidth
          margin="normal"
        />
        <TextField
          label="Password"
          type="password"
          value={loginPassword}
          onChange={(e) => setLoginPassword(e.target.value)}
          fullWidth
          margin="normal"
        />
        <Button variant="contained" color="primary" onClick={handleLogin} fullWidth sx={{ mt: 2 }}>
          Login
        </Button>
      </Box>
    </Box>
  );
};

export default LoginPage;
