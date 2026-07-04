import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  FormControlLabel,
  Grid,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import axiosInstance from '../../axiosConfig';

const weekDays = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 0, label: 'Sun' },
];

const emptyProgram = {
  name: '',
  description: '',
  defaultTime: '',
  daysOfWeek: [],
  active: true,
};

const emptyType = {
  name: '',
  slug: '',
  description: '',
  active: true,
  autoExpireJobs: true,
  jobSlaHours: 72,
  jobGraceHours: 4,
};

const BroadcastProgramManagement = () => {
  const [programs, setPrograms] = useState([]);
  const [contentTypes, setContentTypes] = useState([]);
  const [programForm, setProgramForm] = useState(emptyProgram);
  const [typeForm, setTypeForm] = useState(emptyType);
  const [editingProgramId, setEditingProgramId] = useState('');
  const [editingTypeId, setEditingTypeId] = useState('');
  const [message, setMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const fetchData = () => {
    Promise.all([
      axiosInstance.get('/admin/broadcast-programs'),
      axiosInstance.get('/admin/broadcast-content-types'),
    ])
      .then(([programResponse, typeResponse]) => {
        setPrograms(Array.isArray(programResponse.data) ? programResponse.data : []);
        setContentTypes(Array.isArray(typeResponse.data) ? typeResponse.data : []);
      })
      .catch((error) => {
        console.error('Error fetching broadcast settings:', error);
        setErrorMessage('Broadcast settings could not be loaded.');
      });
  };

  useEffect(() => {
    fetchData();
  }, []);

  const toggleDay = (value) => {
    setProgramForm((current) => ({
      ...current,
      daysOfWeek: current.daysOfWeek.includes(value)
        ? current.daysOfWeek.filter((day) => day !== value)
        : [...current.daysOfWeek, value],
    }));
  };

  const resetProgramForm = () => {
    setProgramForm(emptyProgram);
    setEditingProgramId('');
  };

  const resetTypeForm = () => {
    setTypeForm(emptyType);
    setEditingTypeId('');
  };

  const saveProgram = () => {
    const request = editingProgramId
      ? axiosInstance.put(`/admin/broadcast-programs/${editingProgramId}`, programForm)
      : axiosInstance.post('/admin/broadcast-programs', programForm);

    request
      .then((response) => {
        setMessage(response.data?.message || 'Program saved.');
        setErrorMessage('');
        resetProgramForm();
        fetchData();
      })
      .catch((error) => {
        console.error('Error saving program:', error);
        setErrorMessage(error.response?.data?.message || 'Program could not be saved.');
      });
  };

  const saveContentType = () => {
    const request = editingTypeId
      ? axiosInstance.put(`/admin/broadcast-content-types/${editingTypeId}`, typeForm)
      : axiosInstance.post('/admin/broadcast-content-types', typeForm);

    request
      .then((response) => {
        setMessage(response.data?.message || 'Content type saved.');
        setErrorMessage('');
        resetTypeForm();
        fetchData();
      })
      .catch((error) => {
        console.error('Error saving content type:', error);
        setErrorMessage(error.response?.data?.message || 'Content type could not be saved.');
      });
  };

  const editProgram = (program) => {
    setEditingProgramId(program._id);
    setProgramForm({
      name: program.name || '',
      description: program.description || '',
      defaultTime: program.defaultTime || '',
      daysOfWeek: program.daysOfWeek || [],
      active: program.active !== false,
    });
  };

  const editContentType = (type) => {
    setEditingTypeId(type._id);
    setTypeForm({
      name: type.name || '',
      slug: type.slug || '',
      description: type.description || '',
      active: type.active !== false,
      autoExpireJobs: type.autoExpireJobs !== false,
      jobSlaHours: type.jobSlaHours || 72,
      jobGraceHours: type.jobGraceHours ?? 4,
    });
  };

  return (
    <Box>
      <Typography variant="h5" sx={{ fontWeight: 800, mb: 1 }}>
        Broadcast Programs
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Manage shows and content categories used by editors and producers.
      </Typography>

      {message && <Alert severity="success" sx={{ mb: 2 }}>{message}</Alert>}
      {errorMessage && <Alert severity="error" sx={{ mb: 2 }}>{errorMessage}</Alert>}

      <Grid container spacing={2}>
        <Grid item xs={12} lg={6}>
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
            <Typography variant="h6" sx={{ fontWeight: 800, mb: 2 }}>
              {editingProgramId ? 'Edit program' : 'New program'}
            </Typography>
            <Stack spacing={1.5}>
              <TextField
                label="Program name"
                value={programForm.name}
                onChange={(event) => setProgramForm((current) => ({ ...current, name: event.target.value }))}
                fullWidth
              />
              <TextField
                label="Default time"
                type="time"
                value={programForm.defaultTime}
                onChange={(event) => setProgramForm((current) => ({ ...current, defaultTime: event.target.value }))}
                InputLabelProps={{ shrink: true }}
                fullWidth
              />
              <TextField
                label="Description"
                value={programForm.description}
                onChange={(event) => setProgramForm((current) => ({ ...current, description: event.target.value }))}
                fullWidth
              />
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {weekDays.map((day) => (
                  <Chip
                    key={day.value}
                    label={day.label}
                    clickable
                    color={programForm.daysOfWeek.includes(day.value) ? 'primary' : 'default'}
                    onClick={() => toggleDay(day.value)}
                  />
                ))}
              </Stack>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={programForm.active}
                    onChange={(event) => setProgramForm((current) => ({ ...current, active: event.target.checked }))}
                  />
                }
                label="Active"
              />
              <Stack direction="row" spacing={1}>
                <Button variant="contained" onClick={saveProgram}>
                  Save program
                </Button>
                {editingProgramId && <Button onClick={resetProgramForm}>Cancel</Button>}
              </Stack>
            </Stack>
          </Paper>

          <TableContainer component={Paper} variant="outlined" sx={{ mt: 2, borderRadius: 2 }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Program</TableCell>
                  <TableCell>Time</TableCell>
                  <TableCell>Days</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align="right">Edit</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {programs.map((program) => (
                  <TableRow key={program._id} hover>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 800 }}>
                        {program.name}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {program.description || 'No description'}
                      </Typography>
                    </TableCell>
                    <TableCell>{program.defaultTime || 'N/A'}</TableCell>
                    <TableCell>
                      {(program.daysOfWeek || []).length > 0
                        ? program.daysOfWeek.map((day) => weekDays.find((item) => item.value === day)?.label || day).join(', ')
                        : 'Any'}
                    </TableCell>
                    <TableCell>
                      <Chip label={program.active ? 'Active' : 'Inactive'} size="small" color={program.active ? 'success' : 'default'} />
                    </TableCell>
                    <TableCell align="right">
                      <Button size="small" onClick={() => editProgram(program)}>Edit</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Grid>

        <Grid item xs={12} lg={6}>
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
            <Typography variant="h6" sx={{ fontWeight: 800, mb: 2 }}>
              {editingTypeId ? 'Edit content type' : 'New content type'}
            </Typography>
            <Stack spacing={1.5}>
              <TextField
                label="Name"
                value={typeForm.name}
                onChange={(event) => setTypeForm((current) => ({ ...current, name: event.target.value }))}
                fullWidth
              />
              <TextField
                label="Slug"
                value={typeForm.slug}
                onChange={(event) => setTypeForm((current) => ({ ...current, slug: event.target.value }))}
                fullWidth
              />
              <TextField
                label="Description"
                value={typeForm.description}
                onChange={(event) => setTypeForm((current) => ({ ...current, description: event.target.value }))}
                fullWidth
              />
              <Grid container spacing={1.5}>
                <Grid item xs={6}>
                  <TextField
                    label="SLA rok (sati)"
                    type="number"
                    value={typeForm.jobSlaHours}
                    onChange={(event) => setTypeForm((current) => ({ ...current, jobSlaHours: event.target.value }))}
                    inputProps={{ min: 1, max: 720 }}
                    fullWidth
                  />
                </Grid>
                <Grid item xs={6}>
                  <TextField
                    label="Grace period (sati)"
                    type="number"
                    value={typeForm.jobGraceHours}
                    onChange={(event) => setTypeForm((current) => ({ ...current, jobGraceHours: event.target.value }))}
                    inputProps={{ min: 0, max: 168 }}
                    fullWidth
                  />
                </Grid>
              </Grid>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={typeForm.autoExpireJobs}
                    onChange={(event) => setTypeForm((current) => ({ ...current, autoExpireJobs: event.target.checked }))}
                  />
                }
                label="Automatski premjesti istekle jobove u historiju"
              />
              <FormControlLabel
                control={
                  <Checkbox
                    checked={typeForm.active}
                    onChange={(event) => setTypeForm((current) => ({ ...current, active: event.target.checked }))}
                  />
                }
                label="Active"
              />
              <Stack direction="row" spacing={1}>
                <Button variant="contained" onClick={saveContentType}>
                  Save type
                </Button>
                {editingTypeId && <Button onClick={resetTypeForm}>Cancel</Button>}
              </Stack>
            </Stack>
          </Paper>

          <TableContainer component={Paper} variant="outlined" sx={{ mt: 2, borderRadius: 2 }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Type</TableCell>
                  <TableCell>Slug</TableCell>
                  <TableCell>SLA</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align="right">Edit</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {contentTypes.map((type) => (
                  <TableRow key={type._id} hover>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 800 }}>
                        {type.name}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {type.description || 'No description'}
                      </Typography>
                    </TableCell>
                    <TableCell>{type.slug}</TableCell>
                    <TableCell>
                      <Typography variant="body2">{type.jobSlaHours || 72}h + {type.jobGraceHours ?? 4}h</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {type.autoExpireJobs === false ? 'Bez automatskog isteka' : 'Automatski istek'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip label={type.active ? 'Active' : 'Inactive'} size="small" color={type.active ? 'success' : 'default'} />
                    </TableCell>
                    <TableCell align="right">
                      <Button size="small" onClick={() => editContentType(type)}>Edit</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Grid>
      </Grid>
    </Box>
  );
};

export default BroadcastProgramManagement;
