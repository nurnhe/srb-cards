import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { getCachedUserId, setCachedUserId, clearAuthCache } from './authCache.js';

describe('authCache', () => {
  beforeEach(() => {
    clearAuthCache();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns null for a token never seen', () => {
    expect(getCachedUserId('nope')).toBeNull();
  });

  it('returns the cached user id right after setting it', () => {
    setCachedUserId('tok-1', 'user-a');
    expect(getCachedUserId('tok-1')).toBe('user-a');
  });

  it('keeps different tokens separate', () => {
    setCachedUserId('tok-1', 'user-a');
    setCachedUserId('tok-2', 'user-b');
    expect(getCachedUserId('tok-1')).toBe('user-a');
    expect(getCachedUserId('tok-2')).toBe('user-b');
  });

  it('still returns the cached id just under a minute later', () => {
    setCachedUserId('tok-1', 'user-a');
    vi.advanceTimersByTime(59_000);
    expect(getCachedUserId('tok-1')).toBe('user-a');
  });

  it('expires a minute after it was set', () => {
    setCachedUserId('tok-1', 'user-a');
    vi.advanceTimersByTime(60_001);
    expect(getCachedUserId('tok-1')).toBeNull();
  });

  it('drops an expired entry on read, so a later re-set starts a fresh minute', () => {
    setCachedUserId('tok-1', 'user-a');
    vi.advanceTimersByTime(60_001);
    expect(getCachedUserId('tok-1')).toBeNull(); // reads it out
    setCachedUserId('tok-1', 'user-a');
    vi.advanceTimersByTime(59_000);
    expect(getCachedUserId('tok-1')).toBe('user-a'); // fresh 60s window
  });
});
