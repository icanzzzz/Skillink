import type { MessageCatalog } from './i18n.js';

/**
 * The authoritative English message catalog. Every language pack key must
 * exist here first; anything missing from a language pack falls back to
 * these strings.
 */
export const EN_MESSAGES = {
  'app.brand': 'Skillink',
  'app.tagline': 'skill & package manager',
  'app.nav.label': 'Navigate',
  'app.nav.overview': 'Overview',
  'app.nav.targets': 'Targets',
  'app.nav.skills': 'Skills',
  'app.nav.packages': 'Packages',
  'app.nav.history': 'History',
  'app.nav.doctor': 'Doctor',
  'app.eyebrow': 'WORKSPACE',
  'app.actions.applyRoutes': 'Apply routes',
  'app.status.working': 'Working…',
  'app.loading': 'Loading Skillink…',
  'app.errors.bridgeUnavailable': 'Skillink IPC bridge is unavailable.',

  'overview.stats.skills': {
    one: '{count} skill',
    other: '{count} skills',
  },

  'errors.INVALID_NAME': 'The name is invalid.',
  'errors.INVALID_VERSION': 'The version is invalid.',
  'errors.INVALID_PATH': 'The path is invalid.',
  'errors.UNSAFE_PATH': 'The path is unsafe.',
  'errors.PACKAGE_EXISTS': 'The package already exists.',
  'errors.PACKAGE_NOT_FOUND': 'The package was not found.',
  'errors.PACKAGE_CYCLE': 'The package contains a cycle.',
  'errors.PACKAGE_IN_USE': 'The package is in use.',
  'errors.PACKAGE_EMPTY': 'The package is empty.',
  'errors.PACKAGE_INTEGRITY_MISMATCH': 'The package integrity does not match.',
  'errors.SKILL_MD_REQUIRED': 'SKILL.md is required.',
  'errors.SKILL_MD_MISSING': 'SKILL.md is missing.',
  'errors.SKILL_INTEGRITY_MISMATCH': 'The skill integrity does not match.',
  'errors.SKILL_VERSION_CONFLICT': 'The skill version conflicts.',
  'errors.IMPORT_LIMIT_EXCEEDED': 'The import limit was exceeded.',
  'errors.VERSION_NOT_FOUND': 'The version was not found.',
  'errors.ROUTE_INVALID': 'The route configuration is invalid.',
  'errors.TARGET_EXISTS': 'The target already exists.',
  'errors.TARGET_NOT_FOUND': 'The target was not found.',
  'errors.HISTORY_NOT_FOUND': 'The history entry was not found.',
  'errors.VERSION_IN_USE': 'The version is in use.',
  'errors.UNMANAGED_CONFLICT': 'An unmanaged file conflicts with the target.',
  'errors.LINK_FAILED': 'The link could not be created.',
  'errors.IO_ERROR': 'A file operation failed.',
  'errors.IPC_FORBIDDEN': 'The IPC request was forbidden.',
  'errors.COPY_MODE_UNSUPPORTED': 'Copy mode is not supported here.',
  'errors.LANGUAGE_PACK_INVALID': 'The language pack is invalid.',
  'errors.LANGUAGE_PACK_NOT_FOUND': 'The language pack was not found.',
  'errors.LANGUAGE_PACK_EXISTS': 'The language pack is already installed.',
  'errors.LANGUAGE_PACK_BUILTIN': 'The built-in language cannot be changed.',

  'doctorIssues.MISSING_CONTENT': 'Skill content is missing: {name}@{version}',
  'doctorIssues.ORPHAN_CONTENT': 'Skill content is orphaned: {name}@{version}',
  'doctorIssues.ROUTE_MISSING_VERSION':
    'Route references a missing version: {name}@{version}',
  'doctorIssues.PACKAGE_INTEGRITY_MISMATCH':
    'Package integrity does not match: {name}@{version}',
  'doctorIssues.SKILL_NOT_FOUND': 'Skill not found: {name}@{version}',
  'doctorIssues.SKILL_MD_MISSING': 'SKILL.md is missing: {name}@{version}',
  'doctorIssues.SKILL_INTEGRITY_MISMATCH':
    'Skill integrity does not match: {name}@{version}',
  'doctorIssues.SKILL_VERSION_CONFLICT':
    'Skill version conflicts: {name}@{version}',
  'doctorIssues.UNSUPPORTED_MODE': 'Unsupported target mode: {targetId}',
  'doctorIssues.PACKAGE_CYCLE': 'Package cycle detected: {name}',
  'doctorIssues.PACKAGE_MISSING_VERSION':
    'Package references a missing version: {name}@{version}',
  'doctorIssues.UNUSED_PACKAGE_VERSION':
    'Package version is unused: {name}@{version}',
  'doctorIssues.LINK_ISSUE': 'Link issue in {targetId}: {name}@{version}',
  'doctorIssues.UNSAFE_PATH': 'Unsafe path: {path}',
  'doctorIssues.INVALID_CONFIG': 'Invalid configuration.',
} satisfies MessageCatalog;
