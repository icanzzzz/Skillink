import type { VersionChoice } from '../library.js';

export interface VersionSelectProps {
  label: string;
  name: string;
  options: VersionChoice[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

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
    <label className="field version-select">
      <span>{label}</span>
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
    </label>
  );
}
