import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import App from './App';
import UserProvider from './contexts/UserContext';
import theme from './theme';
import { vi } from 'vitest';

vi.mock('./axiosConfig', () => ({
  __esModule: true,
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

test('renders application shell', async () => {
  render(
    <UserProvider>
      <ThemeProvider theme={theme}>
        <App />
      </ThemeProvider>
    </UserProvider>
  );

  expect(await screen.findByRole('heading', { name: /Prijava/i })).toBeInTheDocument();
  expect(await screen.findByText(/Za novi nalog kontaktiraj administratora/i)).toBeInTheDocument();
});
