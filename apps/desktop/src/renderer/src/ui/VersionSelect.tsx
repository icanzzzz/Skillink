import type { VersionChoice } from '../library.js';

export interface VersionSelectProps {
  /** Caption for assistive tech; also the meaning of the value column. */
  label: string;
  /** Library entry the version belongs to, shown next to the select. */
  name: string;
  options: VersionChoice[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

/**
 * Compact "entry + version" row. Repeating a full-width labelled field for
 * every picked skill made the package composer read as a wall of dropdowns,
 * so the entry name lives on the left and the select keeps a fixed width.
 */
export function VersionSelect({
  label,
  name,
  options,
  value,
  onChange,
  disabled,
}: VersionSelectProps) {
  const known = options.some((option) => option.value === value);

  return (
    <div className="version-select">
      <span className="version-select-name" title={name}>
        {name}
      </span>
      <select
        aria-label={`${label}: ${name}`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
      >
        {known ? null : <option value={value}>{value}</option>}
        {options.map((option) => (
          <option value={option.value} key={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
