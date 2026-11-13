import { useState } from 'react';

export interface ChoiceTag {
  tag: string;
  version: string;
}

export interface ChoiceItem {
  value: string;
  label: string;
  description?: string;
  tags?: readonly ChoiceTag[];
  disabled?: boolean;
  disabledReason?: string;
}

export interface ChoiceListProps {
  legend: string;
  items: ChoiceItem[];
  selected: readonly string[];
  onToggle: (value: string) => void;
  searchPlaceholder: string;
  emptyMessage: string;
  searchable?: boolean;
}

/**
 * Searchable checkbox list used wherever the user picks existing library
 * entries. The legend is rendered as a visible micro-caption so a dialog with
 * two of these still reads as two labelled sections.
 */
export function ChoiceList({
  legend,
  items,
  selected,
  onToggle,
  searchPlaceholder,
  emptyMessage,
  searchable = true,
}: ChoiceListProps) {
  const [search, setSearch] = useState('');
  const term = search.trim().toLowerCase();
  const visible =
    term === ''
      ? items
      : items.filter(
          (item) =>
            item.label.toLowerCase().includes(term) ||
            (item.description ?? '').toLowerCase().includes(term) ||
            (item.tags ?? []).some((entry) =>
              entry.tag.toLowerCase().includes(term),
            ),
        );

  return (
    <div className="choice-list">
      <p className="choice-legend">{legend}</p>
      {searchable ? (
        <input
          className="choice-search"
          type="search"
          aria-label={legend}
          placeholder={searchPlaceholder}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      ) : null}
      {visible.length === 0 ? (
        <p className="empty">{emptyMessage}</p>
      ) : (
        <ul className="choice-items">
          {visible.map((item) => (
            <li key={item.value}>
              <label
                className={`choice-item${item.disabled ? ' is-disabled' : ''}`}
                data-disabled={item.disabled ? 'true' : undefined}
              >
                <input
                  type="checkbox"
                  checked={selected.includes(item.value)}
                  disabled={item.disabled}
                  onChange={() => onToggle(item.value)}
                />
                <span className="choice-body">
                  <span className="choice-name">{item.label}</span>
                  {item.tags === undefined || item.tags.length === 0 ? null : (
                    <span className="choice-tags">
                      {item.tags.map((entry) => (
                        <span className="choice-tag" key={entry.tag}>
                          {entry.tag}
                          <em>{entry.version}</em>
                        </span>
                      ))}
                    </span>
                  )}
                  {item.description === undefined ? null : (
                    <small>{item.description}</small>
                  )}
                  {item.disabled && item.disabledReason !== undefined ? (
                    <em className="choice-reason">{item.disabledReason}</em>
                  ) : null}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
