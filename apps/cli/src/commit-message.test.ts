import { describe, expect, it } from 'vitest';
import { buildCliCommitMessage, inferScope } from './commit-message.js';

describe('commit messages', () => {
  it('prefers the command path for the scope', () => {
    expect(inferScope('skill add', ['route.json'])).toBe('skill');
    expect(inferScope('package create', ['skill.json'])).toBe('package');
    expect(inferScope('target remove', ['route.json'])).toBe('target');
    expect(inferScope('route add', ['route.json'])).toBe('route');
    expect(inferScope('gc', ['skill.json', 'skills/pdf/1.0.0/SKILL.md'])).toBe(
      'gc',
    );
  });

  it('derives a scope from changed files when the command is unknown', () => {
    expect(inferScope('', ['package.json'])).toBe('package');
    expect(inferScope('', ['skill.json'])).toBe('skill');
    expect(inferScope('', ['locales/zh-CN.json'])).toBe('locale');
    expect(inferScope('', ['skills/pdf/1.0.0/SKILL.md'])).toBe('skills');
    expect(inferScope('', ['route.json'])).toBe('route');
    expect(inferScope('', ['route.json', 'package.json'])).toBe('config');
    expect(inferScope('', [])).toBe('config');
  });

  it('builds a control commit message with command and changed files', () => {
    const message = buildCliCommitMessage({
      repo: 'control',
      commandPath: 'skill add',
      argv: ['skill', 'add', 'C:/src/pdf', '--name', 'pdf'],
      action: 'add',
      summary: 'pdf@1.0.0',
      changedFiles: ['route.json', 'skill.json'],
    });

    expect(message.split('\n')[0]).toBe('skillink(skill): add pdf@1.0.0');
    expect(message).toContain(
      'Command: skillink skill add C:/src/pdf --name pdf',
    );
    expect(message).toContain('Changed:\n- route.json\n- skill.json');
  });

  it('omits the command line when there are no arguments', () => {
    const message = buildCliCommitMessage({
      repo: 'control',
      commandPath: 'init',
      argv: [],
      action: 'initialize',
      summary: 'control plane',
      changedFiles: ['route.json'],
    });

    expect(message).not.toContain('Command:');
  });

  it('forces the skills scope in the skills repository', () => {
    const message = buildCliCommitMessage({
      repo: 'skills',
      commandPath: 'skill add',
      argv: ['skill', 'add', 'pdf'],
      action: 'add',
      summary: 'pdf@1.0.0',
      changedFiles: ['pdf/1.0.0/SKILL.md'],
    });

    expect(message.split('\n')[0]).toBe('skillink(skills): add pdf@1.0.0');
    expect(message).toContain('Changed:\n- pdf/1.0.0/SKILL.md');
  });

  it('truncates long subjects and long file lists', () => {
    const message = buildCliCommitMessage({
      repo: 'control',
      commandPath: 'package create',
      argv: ['package', 'create', 'b@1.0.0', '--skill', 'a@1.0.0'],
      action: 'create',
      summary: 'x'.repeat(200),
      changedFiles: Array.from({ length: 25 }, (_, index) => `file-${index}.json`),
    });
    const [subject] = message.split('\n');

    expect(subject!.length).toBeLessThanOrEqual(72);
    expect(subject!.endsWith('...')).toBe(true);
    expect(message).toContain('- file-19.json');
    expect(message).not.toContain('- file-20.json');
    expect(message).toContain('... and 5 more');
  });
});
