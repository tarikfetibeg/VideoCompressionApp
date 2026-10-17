import React, { useContext, useState } from 'react';
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography } from '@mui/material';
import LoginIcon from '@mui/icons-material/Login';
import LogoutIcon from '@mui/icons-material/Logout';
import axios from '../axiosConfig';
import { UserContext } from '../contexts/UserContext';
import { readStoredUser } from '../utils/sessionRecovery';

const SessionRecoveryDialog = () => {
  const { user, login, logout, sessionExpired, sessionIdentityChanged } = useContext(UserContext);
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [identityChanged, setIdentityChanged] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    if (submitting || identityChanged || sessionIdentityChanged) return;
    setSubmitting(true);
    setError('');
    try {
      const response = await axios.post('/auth/login', { username: user.username, password }, { skipSessionRecovery: true, timeout: 15000 });
      const renewed = response.data.user;
      if (String(renewed.id) !== String(user.id) || renewed.role !== user.role) {
        setPassword('');
        setIdentityChanged(true);
        setError('Račun ili uloga su promijenjeni. Odjavi se prije nove prijave; trenutni nespremljeni unos neće biti prenesen drugom računu.');
        return;
      }
      setPassword('');
      setIdentityChanged(false);
      login({ ...renewed, token: response.data.token });
    } catch (failure) {
      setError(failure.response?.data?.message || 'Server nije dostupan. Pokušaj ponovo bez zatvaranja radnog prostora.');
    } finally {
      setSubmitting(false);
    }
  };

  const exit = () => {
    if (!window.confirm('Odjava će ukloniti nespremljeni unos. Želiš li izaći iz radnog prostora?')) return;
    const current = readStoredUser();
    if (!current || (String(current.id) === String(user.id) && current.role === user.role)) logout();
    window.location.assign('/login');
  };

  return (
    <Dialog open={Boolean(user && sessionExpired)} disableEscapeKeyDown fullWidth maxWidth="xs"
      aria-labelledby="session-recovery-title" sx={{ zIndex: (theme) => Math.max(theme.zIndex.modal + 2, theme.zIndex.tooltip + 1, 1501) }}>
      <form onSubmit={submit}>
        <DialogTitle id="session-recovery-title">{sessionIdentityChanged ? 'Prijava je promijenjena' : 'Sesija je istekla'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Typography variant="body2">Prijavi se ponovo. Otvoreni ekran i nespremljeni unos ostaju sačuvani dok ne zatvoriš ili ponovo učitaš stranicu.</Typography>
            {error && <Alert severity="error">{error}</Alert>}
            {sessionIdentityChanged && <Alert severity="warning">Prijava je promijenjena ili završena u drugom tabu. Zatvori stari radni prostor prije nastavka; nacrt neće biti prenesen drugom računu.</Alert>}
            <TextField label="Korisničko ime" value={user?.username || ''} InputProps={{ readOnly: true }} autoComplete="username" />
            <TextField label="Lozinka" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required autoFocus disabled={submitting || identityChanged || sessionIdentityChanged} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button startIcon={<LogoutIcon />} onClick={exit} disabled={submitting}>Odjavi se</Button>
          <Button type="submit" variant="contained" startIcon={<LoginIcon />} disabled={submitting || identityChanged || sessionIdentityChanged}>{submitting ? 'Prijava...' : 'Prijavi se'}</Button>
        </DialogActions>
      </form>
    </Dialog>
  );
};

export default SessionRecoveryDialog;
