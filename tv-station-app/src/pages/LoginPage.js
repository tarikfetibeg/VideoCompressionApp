import React, { useState, useContext } from 'react';
import axios from '../axiosConfig';
import { UserContext } from '../contexts/UserContext';
import { useNavigate } from 'react-router-dom';
import { Container, TextField, Button, Typography, Box, Alert } from '@mui/material';

const LoginPage = () => {
  const { login } = useContext(UserContext);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  // Move handleSubmit inside the component
  const handleSubmit = (e) => {
    e.preventDefault();

    axios
      .post('/auth/login', { username, password })
      .then((response) => {
        login(response.data); // Update UserContext and localStorage
        navigate('/'); // Redirect to home/dashboard
      })
      .catch((err) => {
        setError('Invalid username or password');
      });
  };

  // Return statement should be inside the component
  return (
    <Container maxWidth="sm">
      <Box sx={{ mt: 8 }}>
        <Typography variant="h4" component="h1" align="center">
          Login
        </Typography>
        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
        <Box component="form" onSubmit={handleSubmit} sx={{ mt: 2 }}>
          <TextField
            label="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            fullWidth
            margin="normal"
          />
          <TextField
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            fullWidth
            margin="normal"
          />
          <Button type="submit" variant="contained" fullWidth sx={{ mt: 2 }}>
            Login
          </Button>
        </Box>
      </Box>
    </Container>
  );
};

export default LoginPage;
