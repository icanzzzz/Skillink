import { describe, expect, it } from 'vitest';
import { parseSkillFrontmatter } from './skill-md.js';

describe('parseSkillFrontmatter', () => {
  it('parses the description and scalar metadata', () => {
    const result = parseSkillFrontmatter(`---
name: pdf
description: PDF tools
metadata:
  author: Skillink
  featured: true
  count: 3
---

# PDF tools
`);

    expect(result).toEqual({
      name: 'pdf',
      description: 'PDF tools',
      metadata: {
        author: 'Skillink',
        featured: 'true',
        count: '3',
      },
    });
  });

  it('returns undefined when there is no frontmatter', () => {
    expect(parseSkillFrontmatter('# Plain skill\n')).toBeUndefined();
  });

  it('ignores malformed frontmatter instead of blocking import', () => {
    expect(
      parseSkillFrontmatter('---\ndescription: [unterminated\n---\n'),
    ).toBeUndefined();
  });

  it('does not end the frontmatter inside a YAML block scalar', () => {
    const result = parseSkillFrontmatter(`---
description: |
  first line
  ---
  second line
metadata:
  author: Skillink
---
`);

    expect(result?.description).toBe('first line\n---\nsecond line\n');
    expect(result?.metadata).toEqual({ author: 'Skillink' });
  });

  it('does not keep non-scalar metadata values', () => {
    const result = parseSkillFrontmatter(`---
description: Demo
metadata:
  tags:
    - one
  nested:
    key: value
  scalar: kept
---
`);

    expect(result?.metadata).toEqual({ scalar: 'kept' });
  });
});
