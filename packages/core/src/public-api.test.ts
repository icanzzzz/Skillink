import { describe, expect, it } from 'vitest';
import * as core from './index.js';

describe('public API', () => {
  it('exposes the documented core surface', () => {
    const surface = core as unknown as Record<string, unknown>;

    expect(surface.apply).toBeTypeOf('function');
    expect(surface.resolveTarget).toBeUndefined();
    expect(surface.removeObsoleteTargetSkills).toBeUndefined();
    expect(surface.findTarget).toBeUndefined();
    expect(surface.planMissingSkillContent).toBeUndefined();
    expect(surface.resolveLinkTarget).toBeUndefined();
  });
});
