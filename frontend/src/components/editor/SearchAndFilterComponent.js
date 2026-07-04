import React from 'react';
import {
  Button,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Select,
  TextField,
} from '@mui/material';
import Autocomplete from '@mui/material/Autocomplete';
import ClearIcon from '@mui/icons-material/Clear';
import SearchIcon from '@mui/icons-material/Search';
import { FilterBar } from '../common/WorkspaceChrome';

const processingOptions = [
  { value: 'all', label: 'Sva obrada' },
  { value: 'queued', label: 'Čeka obradu' },
  { value: 'processing', label: 'Obrada u toku' },
  { value: 'completed', label: 'Spremno' },
  { value: 'failed', label: 'Greška' },
];

const qcOptions = [
  { value: 'all', label: 'Svi QC statusi' },
  { value: 'pending', label: 'Čeka QC' },
  { value: 'passed', label: 'QC prošao' },
  { value: 'failed', label: 'QC problem' },
];

const broadcastOptions = [
  { value: 'all', label: 'Svi air statusi' },
  { value: 'not_ready', label: 'Nije spremno' },
  { value: 'qc_pending', label: 'Čeka QC' },
  { value: 'qc_failed', label: 'QC problem' },
  { value: 'ready_for_approval', label: 'Spremno za odobrenje' },
  { value: 'approved_for_air', label: 'Odobreno za eter' },
  { value: 'aired', label: 'Emitovano' },
  { value: 'archived', label: 'Arhivirano' },
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
    <FilterBar
      title="Radni filter"
      summary={`${resultCount} vidljivih materijala`}
      actions={(
        <Button startIcon={<ClearIcon />} variant="outlined" onClick={resetFilters}>
          Očisti
        </Button>
      )}
    >
      <Grid container spacing={2}>
        <Grid item xs={12} md={4}>
          <TextField
            label="Pretraga"
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
            renderInput={(params) => <TextField {...params} label="Lokacija" />}
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
            label="Datum"
            type="date"
            fullWidth
            InputLabelProps={{ shrink: true }}
            value={filters.date}
            onChange={(e) => updateFilter('date', e.target.value)}
          />
        </Grid>

        <Grid item xs={12} sm={6} md={2}>
          <FormControl fullWidth>
            <InputLabel>Kategorija</InputLabel>
            <Select
              value={filters.contentTypeId || 'all'}
              label="Kategorija"
              onChange={(e) => updateFilter('contentTypeId', e.target.value)}
            >
              <MenuItem value="all">Sve kategorije</MenuItem>
              {(options.contentTypes || []).map((type) => (
                <MenuItem key={type._id} value={type._id}>
                  {type.name || type.slug || 'Bez naziva'}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Grid>

        <Grid item xs={12} sm={6} md={2}>
          <FormControl fullWidth>
            <InputLabel>Materijal</InputLabel>
            <Select
              value={filters.status}
              label="Materijal"
              onChange={(e) => updateFilter('status', e.target.value)}
            >
              <MenuItem value="all">Sav materijal</MenuItem>
              <MenuItem value="raw">Sirovina</MenuItem>
              <MenuItem value="edited">Final / montaža</MenuItem>
            </Select>
          </FormControl>
        </Grid>

        <Grid item xs={12} sm={6} md={2}>
          <FormControl fullWidth>
            <InputLabel>Obrada</InputLabel>
            <Select
              value={filters.processingStatus}
              label="Obrada"
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
            <InputLabel>Air status</InputLabel>
            <Select
              value={filters.broadcastStatus}
              label="Air status"
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
    </FilterBar>
  );
};

export default SearchAndFilterComponent;
