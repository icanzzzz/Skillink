import { describe, expect, it } from 'vitest';
import { parseNameVersionSpec } from './spec.js';

describe('parseNameVersionSpec', () => {
  it('parses the last @ as the version separator', () => {
    expect(parseNameVersionSpec('pdf@1.0.0')).toEqual({
      name: 'pdf',
      version: '1.0.0',
    });
    expect(parseNameVersionSpec('@scope/pdf@1.0.0')).toEqual({
      name: '@scope/pdf',
      version: '1.0.0',
    });
  });

  it('rejects missing name or version', () => {
    expect(parseNameVersionSpec('pdf')).toBeUndefined();
    expect(parseNameVersionSpec('@1.0.0')).toBeUndefined();
    expect(parseNameVersionSpec('pdf@')).toBeUndefined();
  });
});
