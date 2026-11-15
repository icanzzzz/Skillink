import {
  SkillinkError,
  getSkillinkPaths,
  type SkillinkPaths,
} from '@skillink/shared';

export function resolveSkillinkPaths(input: {
  paths?: SkillinkPaths;
  home?: string;
}): SkillinkPaths {
  if (input.paths) {
    return input.paths;
  }
  if (!input.home) {
    throw new SkillinkError(
      'CONTROL_PLANE_REQUIRED',
      'No control plane is selected. Add a control plane or set SKILLINK_HOME.',
    );
  }
  return getSkillinkPaths(input.home);
}
