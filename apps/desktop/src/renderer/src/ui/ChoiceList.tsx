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
      {searchable ? (
        <input
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
            <label
              className={`choice-item${item.disabled ? ' is-disabled' : ''}`}
              data-disabled={item.disabled ? 'true' : undefined}
              key={item.value}
            >
              <input
                type="checkbox"
                checked={selected.includes(item.value)}
                disabled={item.disabled}
                onChange={() => onToggle(item.value)}
              />
              <span className="choice-name">{item.label}</span>
              {item.description === undefined ? null : (
                <small>{item.description}</small>
              )}
              {item.meta === undefined ? null : <code>{item.meta}</code>}
              {item.disabled && item.disabledReason !== undefined ? (
                <em>{item.disabledReason}</em>
              ) : null}
            </label>
          ))}
        </ul>
      )}
    </div>
  );
}
