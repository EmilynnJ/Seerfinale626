import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Navigation } from '../components/Navigation';
import { Footer } from '../components/Footer';
import type { AuthStateWithError } from '../contexts/AuthContext';

const mockUseAuth = vi.fn();

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}));

function buildAuthState(
  overrides: Partial<AuthStateWithError> = {},
): AuthStateWithError {
  return {
    user: null,
    hasSession: false,
    isAuthenticated: false,
    isAuth0Authenticated: false,
    auth0Role: null,
    isLoading: false,
    authError: null,
    login: vi.fn(async () => {}),
    logout: vi.fn(),
    refreshUser: vi.fn(async () => {}),
    ...overrides,
  };
}

describe('signed-in navigation and footer state', () => {
  beforeEach(() => {
    mockUseAuth.mockReset();
  });

  it('shows sign in and hides dashboard links when there is no session', () => {
    mockUseAuth.mockReturnValue(buildAuthState());

    render(
      <MemoryRouter>
        <Navigation />
        <Footer />
      </MemoryRouter>,
    );

    expect(screen.getAllByText('Sign In').length).toBeGreaterThan(0);
    expect(screen.queryByText('Sign Out')).toBeNull();
    expect(screen.queryAllByRole('link', { name: 'Dashboard' })).toHaveLength(0);
  });

  it('shows dashboard and sign out when Auth0 session exists even before profile sync completes', () => {
    mockUseAuth.mockReturnValue(
      buildAuthState({
        hasSession: true,
        isAuthenticated: true,
        isAuth0Authenticated: true,
        authError: 'Profile sync failed',
      }),
    );

    render(
      <MemoryRouter>
        <Navigation />
        <Footer />
      </MemoryRouter>,
    );

    expect(screen.queryByText('Sign In')).toBeNull();
    expect(screen.getAllByText('Sign Out').length).toBeGreaterThan(0);
    expect(screen.queryAllByRole('link', { name: 'Dashboard' }).length).toBeGreaterThan(0);
  });
});
