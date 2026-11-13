import { useState } from 'react';

export interface ChoiceItem {
  value: string;
  label: string;
  description?: string;
  meta?: string;
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
            (item.description ?? '').toLowerCase().includes(term),
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
                  {item.description === undefined ? null : (
                    <small>{item.description}</small>
                  )}
                  {item.disabled && item.disabledReason !== undefined ? (
                    <em>{item.disabledReason}</em>
                  ) : null}
                </span>
                {item.meta === undefined ? null : (
                  <code className="choice-meta">{item.meta}</code>
                )}
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
