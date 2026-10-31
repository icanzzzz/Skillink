import { z } from 'zod';
import { EN_MESSAGES } from './i18n-en.js';
import type { DoctorIssue } from './reports.js';

export const MAX_LANGUAGE_PACK_BYTES = 512 * 1024;
export const MAX_LANGUAGE_PACK_KEYS = 2000;
export const MAX_MESSAGE_LENGTH = 5000;

export type PluralCategory =
  | 'zero'
  | 'one'
  | 'two'
  | 'few'
  | 'many'
  | 'other';

export type MessageValue =
  | string
  | (Partial<Record<PluralCategory, string>> & { other: string });

export type MessageCatalog = Record<string, MessageValue>;

export interface Translator {
  readonly locale: string;
  t(
    key: string,
    params?: Record<string, string | number>,
    fallback?: string,
  ): string;
  has(key: string): boolean;
  formatDate(value: Date | string | number): string;
  formatNumber(value: number): string;
}

export interface LanguagePackSummary {
  locale: string;
  name: string;
  nativeName: string;
  version: string;
  direction: 'ltr' | 'rtl';
  messageCount: number;
  coverage: number;
  builtIn: boolean;
}

export interface LanguageState {
  current: string;
  direction: 'ltr' | 'rtl';
  packs: LanguagePackSummary[];
  messages: MessageCatalog;
}

export interface LocaleInstallReport {
  pack: LanguagePackSummary;
  missingKeys: string[];
  extraKeys: string[];
  active: boolean;
}

export interface SettingsFile {
  schemaVersion: 1;
  locale?: string;
}

export const LOCALE_PATTERN = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*$/;
export const MESSAGE_KEY_PATTERN = /^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+$/;

const LocaleSchema = z.string().regex(LOCALE_PATTERN, 'Invalid locale tag.');

const MessageTextSchema = z
  .string()
  .max(MAX_MESSAGE_LENGTH)
  .refine((value) => value.trim().length > 0, {
    message: 'Message text cannot be empty.',
  });

const PluralMessageSchema = z
  .object({
    zero: MessageTextSchema.optional(),
    one: MessageTextSchema.optional(),
    two: MessageTextSchema.optional(),
    few: MessageTextSchema.optional(),
    many: MessageTextSchema.optional(),
    other: MessageTextSchema,
  })
  .strict();

const MessageValueSchema = z.union([MessageTextSchema, PluralMessageSchema]);

export const LanguagePackSchema = z
  .object({
    schemaVersion: z.literal(1),
    locale: LocaleSchema,
    name: z.string().min(1).max(80),
    nativeName: z.string().min(1).max(80),
    version: z.string().min(1).max(64),
    direction: z.enum(['ltr', 'rtl']).default('ltr'),
    messages: z
      .record(
        z.string().max(120).regex(MESSAGE_KEY_PATTERN, 'Invalid message key.'),
        MessageValueSchema,
      )
      .refine(
        (messages) => Object.keys(messages).length <= MAX_LANGUAGE_PACK_KEYS,
        { message: `A language pack may contain at most ${MAX_LANGUAGE_PACK_KEYS} messages.` },
      ),
  })
  .strict();

export type LanguagePack = z.infer<typeof LanguagePackSchema>;

export const SettingsFileSchema = z
  .object({
    schemaVersion: z.literal(1),
    locale: LocaleSchema.optional(),
  })
  .strict();

export type MessageKey = keyof typeof EN_MESSAGES;

function hasOwn(object: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function interpolate(
  template: string,
  params: Record<string, string | number> | undefined,
): string {
  if (!params) {
    return template;
  }

  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (placeholder, name: string) =>
    hasOwn(params, name) ? String(params[name]) : placeholder,
  );
}

function isPluralValue(
  value: MessageValue,
): value is Partial<Record<PluralCategory, string>> & { other: string } {
  return typeof value === 'object' && value !== null;
}

function hasText(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isUsableValue(value: MessageValue | undefined): value is MessageValue {
  if (value === undefined) {
    return false;
  }
  if (typeof value === 'string') {
    return hasText(value);
  }
  return hasText(value.other);
}

export function createTranslator(
  locale: string,
  messages: MessageCatalog,
): Translator {
  let pluralRules: Intl.PluralRules;
  try {
    pluralRules = new Intl.PluralRules(locale);
  } catch {
    pluralRules = new Intl.PluralRules('en');
  }

  const dateFormat = (() => {
    try {
      return new Intl.DateTimeFormat(locale, {
        dateStyle: 'medium',
        timeStyle: 'short',
      });
    } catch {
      return new Intl.DateTimeFormat('en', {
        dateStyle: 'medium',
        timeStyle: 'short',
      });
    }
  })();

  const numberFormat = (() => {
    try {
      return new Intl.NumberFormat(locale);
    } catch {
      return new Intl.NumberFormat('en');
    }
  })();

  function t(
    key: string,
    params?: Record<string, string | number>,
    fallback?: string,
  ): string {
    const localValue = hasOwn(messages, key) ? messages[key] : undefined;
    const value = isUsableValue(localValue)
      ? localValue
      : hasOwn(EN_MESSAGES, key)
        ? (EN_MESSAGES as MessageCatalog)[key]
        : undefined;

    if (value === undefined) {
      return fallback ?? key;
    }

    if (!isPluralValue(value)) {
      return hasText(value) ? interpolate(value, params) : (fallback ?? key);
    }

    const count = params?.count;
    const category =
      typeof count === 'number' && Number.isFinite(count)
        ? pluralRules.select(count)
        : 'other';
    const selected = value[category];
    const template = hasText(selected)
      ? selected
      : hasText(value.other)
        ? value.other
        : undefined;

    return template === undefined
      ? (fallback ?? key)
      : interpolate(template, params);
  }

  return {
    locale,
    t,
    has(key) {
      return isUsableValue(
        hasOwn(messages, key) ? messages[key] : undefined,
      );
    },
    formatDate(value) {
      const date = value instanceof Date ? value : new Date(value);
      if (Number.isNaN(date.getTime())) {
        return typeof value === 'string' ? value : String(value);
      }
      return dateFormat.format(date);
    },
    formatNumber(value) {
      return numberFormat.format(value);
    },
  };
}

/**
 * Matches a requested BCP 47 locale against available locales.
 * - exact match (case-insensitive) wins;
 * - a more specific request matches a less specific available locale;
 * - a bare language request matches the first available locale in that
 *   language;
 * - otherwise English is used when available;
 * - otherwise there is no match.
 */
export function matchLocale(
  requested: string,
  available: readonly string[],
): string | undefined {
  const normalized = requested.trim().replace(/_/g, '-').toLowerCase();
  if (!normalized) {
    return undefined;
  }

  const candidates = available.map((locale) => ({
    canonical: locale,
    normalized: locale.toLowerCase(),
  }));

  const exact = candidates.find(
    (candidate) => candidate.normalized === normalized,
  );
  if (exact) {
    return exact.canonical;
  }

  const lessSpecific = candidates.find((candidate) =>
    normalized.startsWith(`${candidate.normalized}-`),
  );
  if (lessSpecific) {
    return lessSpecific.canonical;
  }

  if (!normalized.includes('-')) {
    const sameLanguage = candidates.find(
      (candidate) => candidate.normalized.split('-')[0] === normalized,
    );
    if (sameLanguage) {
      return sameLanguage.canonical;
    }
  }

  return candidates.find((candidate) => candidate.normalized === 'en')
    ?.canonical;
}

function isEnglish(locale: string): boolean {
  return locale.toLowerCase() === 'en' || locale.toLowerCase().startsWith('en-');
}

export function formatErrorMessage(
  code: string,
  translator: Translator,
  fallback: string,
): string {
  if (isEnglish(translator.locale)) {
    return fallback;
  }

  const key = `errors.${code}`;
  if (!translator.has(key)) {
    return fallback;
  }

  return `${translator.t(key)} (${code})`;
}

export function formatDoctorIssue(
  issue: DoctorIssue,
  translator: Translator,
): string {
  if (isEnglish(translator.locale) || issue.code === 'INVALID_CONFIG') {
    return issue.message;
  }

  const key = `doctorIssues.${issue.code}`;
  if (!translator.has(key)) {
    return issue.message;
  }

  const params: Record<string, string> = {};
  for (const field of [
    'name',
    'version',
    'path',
    'targetId',
    'packageName',
  ] as const) {
    const value = issue[field];
    if (value !== undefined) {
      params[field] = value;
    }
  }

  return translator.t(key, params);
}
