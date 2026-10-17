import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import UserProvider from '../contexts/UserContext';
import SessionRecoveryDialog from './SessionRecoveryDialog';
import axios from '../axiosConfig';
import { cancelSession, pauseSession } from '../utils/sessionRecovery';

jest.mock('../axiosConfig', () => ({ post: jest.fn() }));
const user = { id: 'one', username: 'reporter', role: 'Reporter', token: 'old' };

beforeEach(() => { cancelSession(); localStorage.setItem('user', JSON.stringify(user)); });
afterEach(() => { act(() => cancelSession()); localStorage.clear(); jest.clearAllMocks(); });

const mount = () => {
  render(<UserProvider><input data-testid="draft" defaultValue="Moj nespremljeni tekst" /><SessionRecoveryDialog /></UserProvider>);
  act(() => pauseSession());
};

it('places reauthentication above the fixed 1500 transfer panel layer', () => {
  mount();
  const layer = screen.getByRole('dialog').closest('.MuiDialog-root');
  expect(Number(window.getComputedStyle(layer).zIndex)).toBeGreaterThan(1500);
});

test('same-account login preserves mounted draft and replaces token', async () => {
  axios.post.mockResolvedValue({ data: { user: { ...user, token: undefined }, token: 'renewed' } });
  mount();
  fireEvent.change(screen.getByLabelText(/^Lozinka/), { target: { value: 'qa-password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Prijavi se' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.getByTestId('draft')).toHaveValue('Moj nespremljeni tekst');
  expect(JSON.parse(localStorage.getItem('user')).token).toBe('renewed');
});

test.each([{ ...user, id: 'other' }, { ...user, role: 'Admin' }])('different identity or role cannot inherit a draft', async (renewed) => {
  axios.post.mockResolvedValue({ data: { user: renewed, token: 'other-token' } });
  mount();
  fireEvent.change(screen.getByLabelText(/^Lozinka/), { target: { value: 'qa-password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Prijavi se' }));
  await screen.findByText(/Račun ili uloga su promijenjeni/);
  expect(JSON.parse(localStorage.getItem('user')).token).toBe('old');
  expect(screen.getByTestId('draft')).toHaveValue('Moj nespremljeni tekst');
  expect(screen.getByLabelText(/^Lozinka/)).toHaveValue('');
});

test('network failure leaves dialog and draft available for retry', async () => {
  axios.post.mockRejectedValue(new Error('Network error'));
  mount();
  fireEvent.change(screen.getByLabelText(/^Lozinka/), { target: { value: 'qa-password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Prijavi se' }));
  await screen.findByText(/Server nije dostupan/);
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(screen.getByTestId('draft')).toHaveValue('Moj nespremljeni tekst');
});
