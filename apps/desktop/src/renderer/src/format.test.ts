import { describe, expect, it } from 'vitest';
import { errorMessage, formatBytes } from './format.js';

describe('format helpers', () => {
  it('formats bytes at each unit boundary', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
  });

  it('extracts an error message', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom');
    expect(errorMessage('boom')).toBe('boom');
  });
});
