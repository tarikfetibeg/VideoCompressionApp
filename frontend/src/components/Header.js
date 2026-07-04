// Header.js

import React, { useContext } from 'react';
import { Link } from 'react-router-dom';
import { UserContext } from '../contexts/UserContext';
import { AppBar, Box, Button, Chip, Stack, Toolbar, Typography } from '@mui/material';
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings';
import AssignmentTurnedInIcon from '@mui/icons-material/AssignmentTurnedIn';
import FeedbackOutlinedIcon from '@mui/icons-material/FeedbackOutlined';
import Inventory2Icon from '@mui/icons-material/Inventory2';
import LogoutIcon from '@mui/icons-material/Logout';
import NewspaperIcon from '@mui/icons-material/Newspaper';
import TvIcon from '@mui/icons-material/Tv';
import VideoSettingsIcon from '@mui/icons-material/VideoSettings';

const Header = () => {
  const { user, logout } = useContext(UserContext);

  const handleLogout = () => {
    logout();
    window.location.href = '/login';
  };

  return (
    <AppBar position="static">
      <Toolbar sx={{ gap: 1, flexWrap: 'wrap', py: 0.75 }}>
        <Box sx={{ flexGrow: 1, minWidth: { xs: '100%', sm: 180 } }}>
          <Typography variant="h6" sx={{ fontWeight: 800, lineHeight: 1.1 }}>
            TV Station App
          </Typography>
          {user && (
            <Chip
              label={`${user.username || 'User'} / ${user.role || 'Role'}`}
              size="small"
              sx={{
                mt: 0.5,
                color: 'primary.contrastText',
                borderColor: 'rgba(255,255,255,0.45)',
              }}
              variant="outlined"
            />
          )}
        </Box>
        {user ? (
          <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap justifyContent="flex-end">
            {['Reporter', 'Admin'].includes(user?.role) && (
              <Button size="small" color="inherit" component={Link} to="/reporter-dashboard" startIcon={<NewspaperIcon />}>
                Reporter
              </Button>
            )}
            {['Editor', 'VideoEditor', 'Admin'].includes(user?.role) && (
              <Button size="small" color="inherit" component={Link} to="/editor-dashboard" startIcon={<AssignmentTurnedInIcon />}>
                Production
              </Button>
            )}
            {['Producer', 'Admin'].includes(user?.role) && (
              <Button size="small" color="inherit" component={Link} to="/producer-dashboard" startIcon={<VideoSettingsIcon />}>
                Producer
              </Button>
            )}
            {['Realizator', 'Admin'].includes(user?.role) && (
              <Button size="small" color="inherit" component={Link} to="/realizator-dashboard" startIcon={<TvIcon />}>
                Realizator
              </Button>
            )}
            {['Archivist', 'Admin'].includes(user?.role) && (
              <Button size="small" color="inherit" component={Link} to="/archivist-dashboard" startIcon={<Inventory2Icon />}>
                Archive
              </Button>
            )}
            {user?.role === 'Admin' && (
              <Button size="small" color="inherit" component={Link} to="/admin-dashboard" startIcon={<AdminPanelSettingsIcon />}>
                Admin
              </Button>
            )}
            <Button size="small" color="inherit" component={Link} to="/feedback" startIcon={<FeedbackOutlinedIcon />}>
              Feedback
            </Button>
            <Button size="small" color="inherit" onClick={handleLogout} startIcon={<LogoutIcon />}>
              Logout
            </Button>
          </Stack>
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
