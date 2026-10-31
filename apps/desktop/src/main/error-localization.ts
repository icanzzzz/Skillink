import {
  createTranslator,
  formatErrorMessage,
  type LanguageState,
} from '@skillink/shared';
import { CliCommandError } from './cli-adapter.js';

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * Translates a CLI adapter error for the current UI language. Only known
 * CliCommandError codes are translated; everything else is passed through
 * unchanged so no detail is lost.
 */
export function translateCliError(
  error: unknown,
  languageState: LanguageState,
): Error {
  if (!(error instanceof CliCommandError)) {
    return asError(error);
  }

  const translator = createTranslator(
    languageState.current,
    languageState.messages,
  );
  return new Error(
    formatErrorMessage(error.code, translator, error.message),
    { cause: error },
  );
}

/**
 * Loads the current language state before translating. If the state cannot
 * be loaded, the original error is returned unmodified.
 */
export async function localizeError(
  error: unknown,
  loadLanguageState: () => Promise<LanguageState>,
): Promise<Error> {
  try {
    return translateCliError(error, await loadLanguageState());
  } catch {
    return asError(error);
  }
}
