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

  // Optional: Add console log for debugging
  console.log('User in Header:', user);

  return (
    <AppBar position="static">
      <Toolbar>
        <Typography variant="h6" sx={{ flexGrow: 1 }}>
          TV Station App
        </Typography>
        {user ? (
          <>
            {user?.role === 'Reporter' && (
              <Button color="inherit" component={Link} to="/reporter-dashboard">
                Reporter Dashboard
              </Button>
            )}
            {user?.role === 'Editor' && (
              <Button color="inherit" component={Link} to="/editor-dashboard">
                Editor Dashboard
              </Button>
            )}
            {/* Add buttons for other roles as needed */}
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
