import React from 'react';
import { Box, TextField, Button } from '@mui/material';
import Autocomplete from '@mui/material/Autocomplete';

const SearchAndFilterComponent = ({ filters, setFilters, reporterOptions }) => {
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mb: 2 }}>
      <TextField
        label="Event"
        value={filters.event}
        onChange={(e) => setFilters({ ...filters, event: e.target.value })}
      />
      <TextField
        label="Location"
        value={filters.location}
        onChange={(e) => setFilters({ ...filters, location: e.target.value })}
      />
      <TextField
        label="Upload Date"
        type="date"
        InputLabelProps={{ shrink: true }}
        value={filters.date}
        onChange={(e) => setFilters({ ...filters, date: e.target.value })}
      />
      <Autocomplete
        options={reporterOptions}
        value={filters.uploader}
        onChange={(e, newValue) => setFilters({ ...filters, uploader: newValue || '' })}
        renderInput={(params) => <TextField {...params} label="Reporter" />}
        sx={{ width: 200 }}
      />
      <TextField
        label="Keywords"
        value={filters.keywords}
        onChange={(e) => setFilters({ ...filters, keywords: e.target.value })}
      />
      <Button variant="contained" onClick={() => setFilters({ event: '', location: '', date: '', uploader: '', keywords: '' })}>
        Clear Filters
      </Button>
    </Box>
  );
};

export default SearchAndFilterComponent;
