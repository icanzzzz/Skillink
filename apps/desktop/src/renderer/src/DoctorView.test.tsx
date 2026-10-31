import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DoctorView } from './DoctorView.js';
import { renderWithMessages } from './i18n.test-utils.js';

describe('DoctorView', () => {
  it('renders issue codes', () => {
    const html = renderToStaticMarkup(
      <DoctorView
        report={{
          ok: false,
          issues: [
            {
              code: 'MISSING_CONTENT',
              message: 'Library content is missing: demo@1.0.0',
            },
          ],
        }}
      />,
    );

    expect(html).toContain('MISSING_CONTENT');
    expect(html).toContain('Library content is missing');
    expect(html).toContain('Refresh');
  });

  it('renders a healthy state', () => {
    const html = renderToStaticMarkup(<DoctorView report={{ ok: true, issues: [] }} />);

    expect(html).toContain('healthy');
  });

  it('renders translated doctor text', () => {
    const html = renderWithMessages(
      <DoctorView report={{ ok: true, issues: [] }} />,
      { 'doctor.heading': '诊断医生' },
    );

    expect(html).toContain('诊断医生');
  });
});
