import React from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Button, Paper, Stack, Typography } from '@mui/material';
import HomeIcon from '@mui/icons-material/Home';

const NotFoundPage = () => (
  <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '60vh', px: 2 }}>
    <Paper variant="outlined" sx={{ p: { xs: 3, md: 4 }, borderRadius: 1.5, maxWidth: 520, width: '100%' }}>
      <Stack spacing={2} alignItems="flex-start">
        <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 800 }}>
          404
        </Typography>
        <Typography variant="h4" sx={{ fontWeight: 900 }}>
          Stranica nije pronadjena
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Ruta ne postoji ili nemas pristup trazenom prikazu.
        </Typography>
        <Button component={RouterLink} to="/" variant="contained" startIcon={<HomeIcon />}>
          Nazad na workspace
        </Button>
      </Stack>
    </Paper>
  </Box>
);

export default NotFoundPage;
