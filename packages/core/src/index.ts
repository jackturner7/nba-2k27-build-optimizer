export * from './types.js';

export { buildDataset, checkReferentialIntegrity, verificationReport } from './data/loader.js';
export type { DataIssue, LoadResult, VerificationReport } from './data/loader.js';
export { datasetCoverage } from './data/coverage.js';
export { crossCheckBadges } from './data/crosscheck.js';
export type { CrossCheckConflict, CrossCheckReport, SecondSource } from './data/crosscheck.js';
export type { AttributeCoverage, CoverageReport } from './data/coverage.js';
export type { RawDatasetFiles } from './data/schema.js';

export {
  clamp,
  formatHeight,
  heightRange,
  parseHeight,
  validateBody,
  weightRange,
  wingspanRange,
} from './engine/body.js';
export type { BodyValidation, Range } from './engine/body.js';

export {
  baseAttributes,
  capBreakerGain,
  capBreakerTableFor,
  capBreakerTablesFor,
  capOverrideFor,
  capsWithBreakers,
  computeBudget,
  computeCaps,
  isCapBreakerEligible,
  lookupByBody,
  matchingRows,
  usableSlots,
} from './engine/caps.js';
export { CostModel, costModelFor } from './engine/cost.js';
export { collectBreakpoints, lastUsefulBreakpoint } from './engine/breakpoints.js';
export type { Breakpoint, BreakpointMap, BreakpointSource } from './engine/breakpoints.js';
export { evaluateBuild, quickScore } from './engine/evaluate.js';
export type { EvaluateOptions } from './engine/evaluate.js';
export { findWaste, planBadgeBoosts, planCapBreakers, unlockValue } from './engine/plans.js';
export {
  DEFAULT_SCORE_WEIGHTS,
  dependencyWarnings,
  effectiveAttributes,
  priorityWeights,
  resolveWeights,
  scoreBuild,
} from './engine/score.js';
export {
  badgeLevelFor,
  evaluateAnimations,
  evaluateBadges,
  evaluateTakeovers,
  evaluateTakeoversLight,
  levelName,
  levelOrder,
  levelWeight,
  nextAnimationThresholds,
  nextBadgeThresholds,
} from './engine/unlocks.js';
export { meetsBody, meetsRequirements, reachable } from './engine/requirements.js';

export { optimize } from './engine/optimize.js';

export { parseBuildRequest } from './nl/parse.js';
export type { ParseNote, ParsedBuildRequest } from './nl/parse.js';
export { aliasIndex, POSITION_ALIASES, INTENSITY_WORDS } from './nl/aliases.js';

export { requestFromArchetype } from './engine/archetype.js';
