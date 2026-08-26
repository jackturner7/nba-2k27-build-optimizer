import type { BuildBody, Dataset, OptimizeRequest } from '../types.js';
import { validateBody } from './body.js';

/**
 * Expands an archetype preset into a full optimize request. The preset supplies
 * the body and the weightings; the caller may override the body (a user who
 * likes the 3-and-D preset but wants to be 6'6" instead of 6'7").
 */
export function requestFromArchetype(
  ds: Dataset,
  archetypeId: string,
  overrides: Partial<OptimizeRequest> & { body?: Partial<BuildBody> } = {}
): OptimizeRequest {
  const arch = ds.archetypes.find((a) => a.id === archetypeId);
  if (!arch) throw new Error(`Unknown archetype "${archetypeId}".`);

  const proposed: BuildBody = {
    position: overrides.body?.position ?? arch.position,
    heightInches: overrides.body?.heightInches ?? arch.suggestedBody.heightInches,
    weightPounds: overrides.body?.weightPounds ?? arch.suggestedBody.weightPounds,
    wingspanInches: overrides.body?.wingspanInches ?? arch.suggestedBody.wingspanInches,
  };
  const body = validateBody(ds, proposed).corrected;

  return {
    body,
    priorities: { ...arch.priorities, ...(overrides.priorities ?? {}) },
    minimums: { ...arch.constraints.minimums, ...(overrides.minimums ?? {}) },
    softTargets: { ...arch.constraints.softTargets, ...(overrides.softTargets ?? {}) },
    maximums: overrides.maximums ?? {},
    scoreWeights: overrides.scoreWeights ?? {},
    resultCount: overrides.resultCount ?? 3,
    archetypeId: arch.id,
    useCapBreakers: overrides.useCapBreakers ?? true,
    useBadgeBoosts: overrides.useBadgeBoosts ?? true,
  };
}
