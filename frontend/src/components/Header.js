// Header.js

import React, { useContext } from 'react';
import { Link } from 'react-router-dom';
import { UserContext } from '../contexts/UserContext';
import { AppBar, Toolbar, Typography, Button } from '@mui/material';

const Header = () => {
  const { user, logout } = useContext(UserContext);

  const handleLogout = () => {
    logout();
    window.location.href = '/login';
  };

  return (
    <AppBar position="static">
      <Toolbar>
        <Typography variant="h6" sx={{ flexGrow: 1 }}>
          TV Station App
        </Typography>
        {user ? (
          <>
            {['Reporter', 'Admin'].includes(user?.role) && (
              <Button color="inherit" component={Link} to="/reporter-dashboard">
                Reporter Desk
              </Button>
            )}
            {['Editor', 'VideoEditor', 'Producer', 'Admin'].includes(user?.role) && (
              <Button color="inherit" component={Link} to="/editor-dashboard">
                Production Desk
              </Button>
            )}
            {['Producer', 'Admin'].includes(user?.role) && (
              <Button color="inherit" component={Link} to="/producer-dashboard">
                Producer Desk
              </Button>
            )}
            {['Realizator', 'Producer', 'Admin'].includes(user?.role) && (
              <Button color="inherit" component={Link} to="/realizator-dashboard">
                Realizator Desk
              </Button>
            )}
            {user?.role === 'Admin' && (
              <Button color="inherit" component={Link} to="/admin-dashboard">
                Admin Dashboard
              </Button>
            )}
            {/* Add additional role-based buttons here if needed */}
            <Button color="inherit" onClick={handleLogout}>
              Logout
            </Button>
          </>
        ) : (
          <Button color="inherit" component={Link} to="/login">
            Login
          </Button>
        )}
      </Toolbar>
    </AppBar>
  );
};

export default Header;
