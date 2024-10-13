import React, { useState, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from '../axiosConfig';
import {
  Box,
  Button,
  TextField,
  Tabs,
  Tab,
  Alert,
} from '@mui/material';
import { UserContext } from '../contexts/UserContext';

const LoginPage = () => {
  const { login } = useContext(UserContext);
  const navigate = useNavigate();
  const [tabIndex, setTabIndex] = useState(0); // 0 for Login, 1 for Register

  // Login form state
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // Registration form state
  const [regUsername, setRegUsername] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regConfirmPassword, setRegConfirmPassword] = useState('');

  // Error and success messages
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const handleTabChange = (event, newValue) => {
    setTabIndex(newValue);
    setErrorMessage('');
    setSuccessMessage('');
  };

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

  const handleRegister = () => {
    if (regPassword !== regConfirmPassword) {
      setErrorMessage('Passwords do not match.');
      return;
    }

    axios
      .post('/auth/register', {
        username: regUsername,
        password: regPassword,
      })
      .then((response) => {
        setSuccessMessage('Registration successful. Please log in.');
        setRegUsername('');
        setRegPassword('');
        setRegConfirmPassword('');
        setTabIndex(0); // Switch to login tab
      })
      .catch((error) => {
        setErrorMessage(
          error.response && error.response.data
            ? error.response.data.message
            : 'Registration failed.'
        );
      });
  };

  return (
    <Box sx={{ mt: 4, maxWidth: 400, mx: 'auto' }}>
      <Tabs value={tabIndex} onChange={handleTabChange} centered>
        <Tab label="Login" />
        <Tab label="Register" />
      </Tabs>

      {errorMessage && (
        <Alert severity="error" sx={{ mt: 2 }}>
          {errorMessage}
        </Alert>
      )}
      {successMessage && (
        <Alert severity="success" sx={{ mt: 2 }}>
          {successMessage}
        </Alert>
      )}

      {tabIndex === 0 && (
        // Login Form
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
      )}

      {tabIndex === 1 && (
        // Registration Form
        <Box sx={{ mt: 2 }}>
          <TextField
            label="Username"
            value={regUsername}
            onChange={(e) => setRegUsername(e.target.value)}
            fullWidth
            margin="normal"
          />
          <TextField
            label="Password"
            type="password"
            value={regPassword}
            onChange={(e) => setRegPassword(e.target.value)}
            fullWidth
            margin="normal"
          />
          <TextField
            label="Confirm Password"
            type="password"
            value={regConfirmPassword}
            onChange={(e) => setRegConfirmPassword(e.target.value)}
            fullWidth
            margin="normal"
          />
          <Button
            variant="contained"
            color="primary"
            onClick={handleRegister}
            fullWidth
            sx={{ mt: 2 }}
          >
            Register
          </Button>
        </Box>
      )}
    </Box>
  );
};

export default LoginPage;
