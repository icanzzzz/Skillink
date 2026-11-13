import { describe, expect, it } from 'vitest';
import { EN_MESSAGES } from '@skillink/shared';
import { renderWithMessages } from '../i18n.test-utils.js';
import { ChoiceList } from './ChoiceList.js';

const items = [
  {
    value: 'alpha',
    label: 'Alpha',
    description: 'First skill',
    meta: '1.0.0',
  },
  {
    value: 'beta',
    label: 'Beta',
    description: 'Second skill',
    disabled: true,
    disabledReason: 'Already added',
  },
];

describe('ChoiceList', () => {
  it('renders checkboxes, selection and disabled state', () => {
    const html = renderWithMessages(
      <ChoiceList
        legend="Skills"
        items={items}
        selected={['alpha']}
        onToggle={() => {}}
        searchPlaceholder="Search skills"
        emptyMessage="No skills"
      />,
      EN_MESSAGES,
    );

    expect(html).toContain('type="checkbox"');
    expect(html).toContain('checked=""');
    expect(html).toContain('data-disabled="true"');
    expect(html).toContain('disabled=""');
    expect(html).toContain('aria-label="Skills"');
    expect(html).toContain('Already added');
  });

  it('renders the empty message when there are no items', () => {
    const html = renderWithMessages(
      <ChoiceList
        legend="Skills"
        items={[]}
        selected={[]}
        onToggle={() => {}}
        searchPlaceholder="Search skills"
        emptyMessage="No skills"
      />,
      EN_MESSAGES,
    );

    expect(html).toContain('No skills');
  });

  it('omits the search box when search is disabled', () => {
    const html = renderWithMessages(
      <ChoiceList
        legend="Skills"
        items={items}
        selected={[]}
        onToggle={() => {}}
        searchPlaceholder="Search skills"
        emptyMessage="No skills"
        searchable={false}
      />,
      EN_MESSAGES,
    );

    expect(html).not.toContain('type="search"');
  });
});
