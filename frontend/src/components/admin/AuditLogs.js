import React, { useEffect, useState } from 'react';
import { List, ListItem, ListItemText, Typography, Alert } from '@mui/material';
import axiosInstance from '../../axiosConfig';

const AuditLogs = () => {
  const [logs, setLogs] = useState([]);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    axiosInstance.get('/admin/audit-logs')
      .then(response => setLogs(response.data))
      .catch(err => {
        console.error('Error fetching audit logs:', err);
        setErrorMessage('Error fetching audit logs.');
      });
  }, []);

  return (
    <div>
      <Typography variant="h5" gutterBottom>
        Audit Logs
      </Typography>
      {errorMessage && <Alert severity="error" sx={{ mb: 2 }}>{errorMessage}</Alert>}
      {logs.length === 0 ? (
        <Typography>No audit logs available.</Typography>
      ) : (
        <List>
          {logs.map((log, index) => (
            <ListItem key={index}>
              <ListItemText
                primary={log.action}
                secondary={`${new Date(log.timestamp).toLocaleString()} - Performed by: ${log.performedBy}`}
              />
            </ListItem>
          ))}
        </List>
      )}
    </div>
  );
};

export default AuditLogs;
