import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { scheduleAuth0Redirect } from '../App';

describe('Auth0 redirect callback', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('waits briefly before navigating so Auth0 can hydrate session state', () => {
    const navigate = vi.fn();

    scheduleAuth0Redirect(navigate, '/dashboard/admin');

    expect(navigate).not.toHaveBeenCalled();

    vi.advanceTimersByTime(99);
    expect(navigate).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(navigate).toHaveBeenCalledWith('/dashboard/admin', { replace: true });
  });
});
