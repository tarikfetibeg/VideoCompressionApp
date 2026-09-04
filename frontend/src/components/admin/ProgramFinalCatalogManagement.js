import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControl,
  InputLabel,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  Paper,
  Select,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import axiosInstance from '../../axiosConfig';

const roleGroups = [
  ['editorial', 'Uredništvo'],
  ['studio', 'Studio'],
  ['technical', 'Tehnika'],
  ['postproduction', 'Postprodukcija'],
  ['other', 'Ostalo'],
];

const ProgramFinalCatalogManagement = () => {
  const [tab, setTab] = useState('types');
  const [types, setTypes] = useState([]);
  const [roles, setRoles] = useState([]);
  const [people, setPeople] = useState([]);
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState({});
  const [editingId, setEditingId] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    const [typeResponse, roleResponse, peopleResponse, userResponse] = await Promise.all([
      axiosInstance.get('/program-types'),
      axiosInstance.get('/production-roles'),
      axiosInstance.get('/production-people?limit=500'),
      axiosInstance.get('/admin/users'),
    ]);
    setTypes(typeResponse.data || []);
    setRoles(roleResponse.data || []);
    setPeople(peopleResponse.data || []);
    setUsers(userResponse.data || []);
  }, []);

  useEffect(() => { load().catch(() => setError('Katalozi finalnih emisija se ne mogu učitati.')); }, [load]);

  const reset = (nextTab = tab) => {
    setEditingId('');
    setForm(nextTab === 'types'
      ? { name: '', slug: '', description: '', recommendedRoles: [], active: true }
      : nextTab === 'roles'
        ? { name: '', slug: '', group: 'other', order: 100, active: true }
        : { name: '', aliases: '', userId: '', active: true });
  };

  useEffect(() => { reset(tab); }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  const items = tab === 'types' ? types : tab === 'roles' ? roles : people;
  const endpoint = tab === 'types' ? '/program-types' : tab === 'roles' ? '/production-roles' : '/production-people';

  const edit = (item) => {
    setEditingId(item._id);
    if (tab === 'types') {
      setForm({
        name: item.name || '',
        slug: item.slug || '',
        description: item.description || '',
        recommendedRoles: (item.recommendedRoles || []).map((role) => role._id || role),
        active: item.active !== false,
      });
    } else if (tab === 'roles') {
      setForm({ name: item.name || '', slug: item.slug || '', group: item.group || 'other', order: item.order || 100, active: item.active !== false });
    } else {
      setForm({
        name: item.name || '',
        aliases: (item.aliases || []).join(', '),
        userId: item.user?._id || item.user || '',
        active: item.active !== false,
      });
    }
  };

  const save = async () => {
    setError('');
    try {
      const payload = tab === 'people'
        ? { ...form, aliases: String(form.aliases || '').split(',').map((value) => value.trim()).filter(Boolean) }
        : form;
      if (editingId) await axiosInstance.put(`${endpoint}/${editingId}`, payload);
      else await axiosInstance.post(endpoint, payload);
      setMessage('Katalog je sačuvan.');
      reset();
      await load();
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Katalog se ne može sačuvati.');
    }
  };

  return (
    <Box>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {message && <Alert severity="success" onClose={() => setMessage('')} sx={{ mb: 2 }}>{message}</Alert>}
      <Paper variant="outlined" sx={{ mb: 2 }}>
        <Tabs value={tab} onChange={(_event, value) => setTab(value)}>
          <Tab value="types" label="Tipovi programa" />
          <Tab value="roles" label="Funkcije ekipe" />
          <Tab value="people" label="Imenik" />
        </Tabs>
      </Paper>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'minmax(320px, 0.8fr) minmax(0, 1.2fr)' }, gap: 2, alignItems: 'start' }}>
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="h6" sx={{ fontWeight: 900, mb: 2 }}>
            {editingId ? 'Uredi stavku' : 'Nova stavka'}
          </Typography>
          <Stack spacing={1.5}>
            <TextField label={tab === 'people' ? 'Ime i prezime' : 'Naziv'} value={form.name || ''} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} size="small" fullWidth />
            {tab !== 'people' && <TextField label="Slug" value={form.slug || ''} onChange={(event) => setForm((current) => ({ ...current, slug: event.target.value }))} size="small" fullWidth />}
            {tab === 'types' && (
              <>
                <TextField label="Opis" value={form.description || ''} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} size="small" multiline minRows={2} fullWidth />
                <FormControl size="small" fullWidth>
                  <InputLabel>Preporučene funkcije</InputLabel>
                  <Select multiple value={form.recommendedRoles || []} label="Preporučene funkcije" onChange={(event) => setForm((current) => ({ ...current, recommendedRoles: event.target.value }))}>
                    {roles.map((role) => <MenuItem key={role._id} value={role._id}>{role.name}</MenuItem>)}
                  </Select>
                </FormControl>
              </>
            )}
            {tab === 'roles' && (
              <>
                <FormControl size="small" fullWidth>
                  <InputLabel>Grupa</InputLabel>
                  <Select value={form.group || 'other'} label="Grupa" onChange={(event) => setForm((current) => ({ ...current, group: event.target.value }))}>
                    {roleGroups.map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}
                  </Select>
                </FormControl>
                <TextField label="Redoslijed" type="number" value={form.order || 100} onChange={(event) => setForm((current) => ({ ...current, order: Number(event.target.value) }))} size="small" fullWidth />
              </>
            )}
            {tab === 'people' && (
              <>
                <TextField label="Aliasi, odvojeni zarezom" value={form.aliases || ''} onChange={(event) => setForm((current) => ({ ...current, aliases: event.target.value }))} size="small" fullWidth />
                <FormControl size="small" fullWidth>
                  <InputLabel>App korisnik (opcionalno)</InputLabel>
                  <Select value={form.userId || ''} label="App korisnik (opcionalno)" onChange={(event) => setForm((current) => ({ ...current, userId: event.target.value }))}>
                    <MenuItem value="">Nije povezan</MenuItem>
                    {users.map((user) => <MenuItem key={user._id} value={user._id}>{user.username} · {user.role}</MenuItem>)}
                  </Select>
                </FormControl>
              </>
            )}
            <Stack direction="row" spacing={1} alignItems="center">
              <Checkbox checked={form.active !== false} onChange={(event) => setForm((current) => ({ ...current, active: event.target.checked }))} />
              <Typography variant="body2">Aktivno</Typography>
            </Stack>
            <Stack direction="row" spacing={1}>
              <Button variant="contained" onClick={save} disabled={!String(form.name || '').trim()}>Sačuvaj</Button>
              {editingId && <Button onClick={() => reset()}>Odustani</Button>}
            </Stack>
          </Stack>
        </Paper>
        <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
          <List disablePadding>
            {items.map((item) => (
              <ListItemButton key={item._id} divider onClick={() => edit(item)}>
                <ListItemText
                  primary={<Typography variant="body2" sx={{ fontWeight: 900 }}>{item.name}</Typography>}
                  secondary={tab === 'types'
                    ? `${item.slug} · ${(item.recommendedRoles || []).length} preporučenih funkcija`
                    : tab === 'roles'
                      ? `${item.slug} · ${item.group}`
                      : [item.user?.username ? `App: ${item.user.username}` : '', (item.aliases || []).join(', ')].filter(Boolean).join(' · ') || 'Bez aliasa'}
                />
                <Typography variant="caption" color={item.active === false ? 'text.secondary' : 'success.main'}>{item.active === false ? 'Neaktivno' : 'Aktivno'}</Typography>
              </ListItemButton>
            ))}
          </List>
        </Paper>
      </Box>
    </Box>
  );
};

export default ProgramFinalCatalogManagement;
