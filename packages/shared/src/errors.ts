export type SkillinkErrorCode =
  | 'INVALID_NAME'
  | 'INVALID_VERSION'
  | 'INVALID_PATH'
  | 'UNSAFE_PATH'
  | 'PACKAGE_EXISTS'
  | 'PACKAGE_NOT_FOUND'
  | 'PACKAGE_CYCLE'
  | 'PACKAGE_IN_USE'
  | 'PACKAGE_EMPTY'
  | 'PACKAGE_INTEGRITY_MISMATCH'
  | 'SKILL_MD_REQUIRED'
  | 'SKILL_MD_MISSING'
  | 'SKILL_INTEGRITY_MISMATCH'
  | 'SKILL_VERSION_CONFLICT'
  | 'IMPORT_LIMIT_EXCEEDED'
  | 'VERSION_NOT_FOUND'
  | 'ROUTE_INVALID'
  | 'TARGET_EXISTS'
  | 'TARGET_NOT_FOUND'
  | 'HISTORY_NOT_FOUND'
  | 'VERSION_IN_USE'
  | 'UNMANAGED_CONFLICT'
  | 'LINK_FAILED'
  | 'IO_ERROR'
  | 'IPC_FORBIDDEN'
  | 'COPY_MODE_UNSUPPORTED';

export class SkillinkError extends Error {
  readonly code: SkillinkErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(
    code: SkillinkErrorCode,
    message: string,
    details?: Record<string, unknown>,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'SkillinkError';
    this.code = code;
    this.details = details;
  }
}

export function isSkillinkError(error: unknown): error is SkillinkError {
  return error instanceof SkillinkError;
}
