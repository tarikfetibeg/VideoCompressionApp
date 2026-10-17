import React from 'react';
import ReactDOM from 'react-dom';
import App from './App';
import UserProvider from './contexts/UserContext';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import theme from './theme';

ReactDOM.render(
  <UserProvider>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <App />
    </ThemeProvider>
  </UserProvider>,
  document.getElementById('root')
);
