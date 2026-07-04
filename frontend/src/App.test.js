import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import App from './App';
import UserProvider from './contexts/UserContext';
import theme from './theme';

jest.mock('./axiosConfig', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  },
}));

test('renders application shell', () => {
  render(
    <UserProvider>
      <ThemeProvider theme={theme}>
        <App />
      </ThemeProvider>
    </UserProvider>
  );

  expect(screen.getByRole('heading', { name: /Prijava/i })).toBeInTheDocument();
  expect(screen.getByText(/Za novi nalog kontaktiraj administratora/i)).toBeInTheDocument();
});
