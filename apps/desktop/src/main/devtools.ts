export interface DevToolsInput {
  type: string;
  key: string;
  control: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
}

export function isDevToolsShortcut(
  input: DevToolsInput,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (input.type !== 'keyDown') {
    return false;
  }

  const key = input.key.toLowerCase();
  if (key === 'f12') {
    return true;
  }

  if (key !== 'i') {
    return false;
  }

  return platform === 'darwin'
    ? input.meta && input.alt
    : input.control && input.shift;
}
