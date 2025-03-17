// src/pages/AdminDashboard.js
import React, { useState } from 'react';
import {
  Box,
  Drawer,
  List,
  ListItem,
  ListItemText,
  AppBar,
  Toolbar,
  Typography,
} from '@mui/material';
import UserManagement from '../components/admin/UserManagement';
import VideoManagement from '../components/admin/VideoManagement';
import FfmpegSettings from '../components/admin/FfmpegSettings';
import AuditLogs from '../components/admin/AuditLogs';

const drawerWidth = 240;

const AdminDashboard = () => {
  const [activeSection, setActiveSection] = useState('users');

  const renderSection = () => {
    switch (activeSection) {
      case 'users':
        return <UserManagement />;
      case 'videos':
        return <VideoManagement />;
      case 'ffmpeg':
        return <FfmpegSettings />;
      case 'logs':
        return <AuditLogs />;
      default:
        return <UserManagement />;
    }
  };

  return (
    <Box sx={{ display: 'flex' }}>
      {/* Sidebar */}
      <Drawer
        variant="permanent"
        sx={{
          width: drawerWidth,
          flexShrink: 0,
          '& .MuiDrawer-paper': { width: drawerWidth, boxSizing: 'border-box' },
        }}
      >
        <Toolbar />
        <Box sx={{ overflow: 'auto' }}>
          <List>
            <ListItem button onClick={() => setActiveSection('users')}>
              <ListItemText primary="User Management" />
            </ListItem>
            <ListItem button onClick={() => setActiveSection('videos')}>
              <ListItemText primary="Video Management" />
            </ListItem>
            <ListItem button onClick={() => setActiveSection('ffmpeg')}>
              <ListItemText primary="FFmpeg Settings" />
            </ListItem>
            <ListItem button onClick={() => setActiveSection('logs')}>
              <ListItemText primary="Audit Logs" />
            </ListItem>
          </List>
        </Box>
      </Drawer>

      {/* Main Content */}
      <Box component="main" sx={{ flexGrow: 1, p: 3 }}>
        <AppBar
          position="fixed"
          sx={{ width: `calc(100% - ${drawerWidth}px)`, ml: `${drawerWidth}px` }}
        >
          <Toolbar>
            <Typography variant="h6" noWrap>
              Admin Dashboard
            </Typography>
          </Toolbar>
        </AppBar>
        <Toolbar />
        {renderSection()}
      </Box>
    </Box>
  );
};

export default AdminDashboard;
