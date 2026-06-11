import React, { useState } from 'react';
import {
  Alert,
  Button,
  Stack,
  Typography,
} from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import axiosInstance from '../../axiosConfig';

const acceptedBriefFormats = '.docx,.txt,.md,.rtf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown,application/rtf,text/rtf';

const BriefImportButton = ({ onImported, disabled = false }) => {
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const handleImport = (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';

    if (!file) return;

    const formData = new FormData();
    formData.append('briefDocument', file, file.name);

    setImporting(true);
    setMessage('');
    setErrorMessage('');

    axiosInstance
      .post('/edit-jobs/import-brief', formData)
      .then((response) => {
        const importedText = response.data?.text || '';
        const warnings = response.data?.warnings || [];

        onImported(importedText, response.data?.filename || file.name);
        setMessage(
          warnings.length > 0
            ? `Brief imported with ${warnings.length} warning(s).`
            : `Brief imported from ${response.data?.filename || file.name}.`
        );
      })
      .catch((error) => {
        console.error('Error importing brief:', error);
        setErrorMessage(error.response?.data?.message || 'Brief could not be imported.');
      })
      .finally(() => setImporting(false));
  };

  return (
    <Stack spacing={1}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
        <Button
          component="label"
          variant="outlined"
          startIcon={<UploadFileIcon />}
          disabled={disabled || importing}
        >
          {importing ? 'Importing...' : 'Import brief'}
          <input
            hidden
            type="file"
            accept={acceptedBriefFormats}
            onChange={handleImport}
          />
        </Button>
        <Typography variant="caption" color="text.secondary">
          DOCX, TXT, MD, RTF
        </Typography>
      </Stack>
      {message && <Alert severity="success">{message}</Alert>}
      {errorMessage && <Alert severity="error">{errorMessage}</Alert>}
    </Stack>
  );
};

export default BriefImportButton;
