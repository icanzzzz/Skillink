export interface NameVersionSpec {
  name: string;
  version: string;
}

export function parseNameVersionSpec(
  value: string,
): NameVersionSpec | undefined {
  const separator = value.lastIndexOf('@');
  if (separator <= 0 || separator === value.length - 1) {
    return undefined;
  }

  return {
    name: value.slice(0, separator),
    version: value.slice(separator + 1),
  };
}
