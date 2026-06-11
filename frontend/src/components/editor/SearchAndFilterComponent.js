import React from 'react';
import {
  Box,
  Button,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import Autocomplete from '@mui/material/Autocomplete';
import ClearIcon from '@mui/icons-material/Clear';
import SearchIcon from '@mui/icons-material/Search';

const processingOptions = [
  { value: 'all', label: 'All processing' },
  { value: 'queued', label: 'Queued' },
  { value: 'processing', label: 'Processing' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
];

const qcOptions = [
  { value: 'all', label: 'All QC' },
  { value: 'pending', label: 'Pending' },
  { value: 'passed', label: 'Passed' },
  { value: 'failed', label: 'Failed' },
];

const broadcastOptions = [
  { value: 'all', label: 'All broadcast' },
  { value: 'not_ready', label: 'Not ready' },
  { value: 'qc_pending', label: 'QC pending' },
  { value: 'qc_failed', label: 'QC failed' },
  { value: 'ready_for_approval', label: 'Ready' },
  { value: 'approved_for_air', label: 'Approved' },
  { value: 'aired', label: 'Aired' },
  { value: 'archived', label: 'Archived' },
];

const SearchAndFilterComponent = ({
  filters,
  setFilters,
  resetFilters,
  options,
  resultCount,
}) => {
  const updateFilter = (name, value) => {
    setFilters((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 2, borderRadius: 2 }}>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={2}
        justifyContent="space-between"
        alignItems={{ xs: 'flex-start', md: 'center' }}
        sx={{ mb: 2 }}
      >
        <Box>
          <Typography variant="h6" sx={{ fontWeight: 800 }}>
            Work Filter
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {resultCount} visible items
          </Typography>
        </Box>
        <Button startIcon={<ClearIcon />} variant="outlined" onClick={resetFilters}>
          Clear
        </Button>
      </Stack>

      <Grid container spacing={2}>
        <Grid item xs={12} md={4}>
          <TextField
            label="Search"
            fullWidth
            value={filters.search}
            onChange={(e) => updateFilter('search', e.target.value)}
            InputProps={{
              startAdornment: <SearchIcon fontSize="small" sx={{ mr: 1, color: 'text.secondary' }} />,
            }}
          />
        </Grid>

        <Grid item xs={12} sm={6} md={2}>
          <Autocomplete
            freeSolo
            options={options.events}
            value={filters.event}
            onInputChange={(event, newValue) => updateFilter('event', newValue || '')}
            renderInput={(params) => <TextField {...params} label="Event" />}
          />
        </Grid>

        <Grid item xs={12} sm={6} md={2}>
          <Autocomplete
            freeSolo
            options={options.locations}
            value={filters.location}
            onInputChange={(event, newValue) => updateFilter('location', newValue || '')}
            renderInput={(params) => <TextField {...params} label="Location" />}
          />
        </Grid>

        <Grid item xs={12} sm={6} md={2}>
          <Autocomplete
            freeSolo
            options={options.reporters}
            value={filters.uploader}
            onInputChange={(event, newValue) => updateFilter('uploader', newValue || '')}
            renderInput={(params) => <TextField {...params} label="Reporter" />}
          />
        </Grid>

        <Grid item xs={12} sm={6} md={2}>
          <TextField
            label="Date"
            type="date"
            fullWidth
            InputLabelProps={{ shrink: true }}
            value={filters.date}
            onChange={(e) => updateFilter('date', e.target.value)}
          />
        </Grid>

        <Grid item xs={12} sm={6} md={2}>
          <FormControl fullWidth>
            <InputLabel>Material</InputLabel>
            <Select
              value={filters.status}
              label="Material"
              onChange={(e) => updateFilter('status', e.target.value)}
            >
              <MenuItem value="all">All material</MenuItem>
              <MenuItem value="raw">Raw</MenuItem>
              <MenuItem value="edited">Edited</MenuItem>
            </Select>
          </FormControl>
        </Grid>

        <Grid item xs={12} sm={6} md={2}>
          <FormControl fullWidth>
            <InputLabel>Processing</InputLabel>
            <Select
              value={filters.processingStatus}
              label="Processing"
              onChange={(e) => updateFilter('processingStatus', e.target.value)}
            >
              {processingOptions.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Grid>

        <Grid item xs={12} sm={6} md={2}>
          <FormControl fullWidth>
            <InputLabel>QC</InputLabel>
            <Select
              value={filters.qcStatus}
              label="QC"
              onChange={(e) => updateFilter('qcStatus', e.target.value)}
            >
              {qcOptions.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <FormControl fullWidth>
            <InputLabel>Broadcast</InputLabel>
            <Select
              value={filters.broadcastStatus}
              label="Broadcast"
              onChange={(e) => updateFilter('broadcastStatus', e.target.value)}
            >
              {broadcastOptions.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Grid>
      </Grid>
    </Paper>
  );
};

export default SearchAndFilterComponent;
