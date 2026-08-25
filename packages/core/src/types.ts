/**
 * Core domain types for the NBA 2K27 build optimizer.
 *
 * Nothing in this file encodes a game value. Every number the engine uses is
 * loaded from /data/<datasetId>/*.json at runtime so the data can be replaced
 * without touching code.
 */

export type AttributeId = string;
export type PositionId = string;
export type BadgeId = string;
export type BadgeLevelId = string;
export type AnimationId = string;
export type TakeoverId = string;
export type PriorityGroupId = string;

export type VerificationStatus =
  | 'verified'
  | 'community-verified'
  | 'estimated'
  | 'unverified'
  | 'deprecated';

export interface Verification {
  status: VerificationStatus;
  source?: string | null;
  notes?: string | null;
  lastReviewed?: string | null;
}

/** A single attribute minimum. */
export interface AttributeRequirement {
  attribute: AttributeId;
  min: number;
}

/** Satisfying any one branch satisfies the clause. 2K27 uses these heavily. */
export interface AnyOfRequirement {
  anyOf: AttributeRequirement[];
}

/**
 * One clause of a requirement list. The list itself is an AND; a clause is
 * either a single minimum or an "any of" choice.
 */
export type RequirementClause = AttributeRequirement | AnyOfRequirement;

export interface BodyRequirement {
  minHeightInches?: number;
  maxHeightInches?: number;
  minWeightPounds?: number;
  maxWeightPounds?: number;
  minWingspanInches?: number;
  maxWingspanInches?: number;
}

// ---------------------------------------------------------------------------
// Dataset shapes
// ---------------------------------------------------------------------------

export interface AttributeCategory {
  id: string;
  name: string;
  color: string;
}

export interface AttributeDef {
  id: AttributeId;
  name: string;
  short: string;
  category: string;
  costCurve: string;
  verification: Verification;
}

export interface PriorityGroup {
  id: PriorityGroupId;
  name: string;
  /** Attributes this priority directly buys. */
  attributes: AttributeId[];
  /** Attributes that make the primary ones work; weighted lower. */
  supporting: AttributeId[];
}

export interface CostCurveRange {
  from: number;
  to: number;
  costPerPoint: number;
}

export interface CostCurve {
  id: string;
  name: string;
  ranges: CostCurveRange[];
  verification: Verification;
}

export interface PositionDef {
  id: PositionId;
  name: string;
  heightInchesMin: number;
  heightInchesMax: number;
  secondaryPositions: PositionId[];
  verification: Verification;
}

export interface BodyModel {
  heightInchesMin: number;
  heightInchesMax: number;
  weightModel: {
    kind: string;
    referenceHeightInches: number;
    minWeightAtReference: number;
    maxWeightAtReference: number;
    minWeightPerInch: number;
    maxWeightPerInch: number;
    absoluteMin: number;
    absoluteMax: number;
    verification: Verification;
  };
  wingspanModel: {
    kind: string;
    minOffsetInches: number;
    maxOffsetInches: number;
    absoluteMinInches: number;
    absoluteMaxInches: number;
    verification: Verification;
  };
  interactions: {
    verification: Verification;
    rules: BodyInteractionRule[];
  };
  overrides: Record<string, BodyOverrideEntry>;
}

export interface BodyInteractionRule {
  id: string;
  /** When this predicate matches, the listed clamps apply. */
  when: BodyRequirement;
  clamp: {
    maxWingspanInches?: number;
    minWingspanInches?: number;
    maxWeightPounds?: number;
    minWeightPounds?: number;
  };
  note?: string;
  verification?: Verification;
}

export interface BodyOverrideEntry {
  weightMin?: number;
  weightMax?: number;
  wingspanMin?: number;
  wingspanMax?: number;
}

export interface BuildBody {
  position: PositionId;
  heightInches: number;
  weightPounds: number;
  wingspanInches: number;
}

export interface AttributeCapRule {
  attribute: AttributeId;
  baseCap: number;
  perInchHeight: number;
  perPoundWeight: number;
  perInchWingspan: number;
  positionAdjust?: Record<PositionId, number>;
  hardMin: number;
  hardMax: number;
  verification: Verification;
}

export interface CapModel {
  kind: string;
  referenceBody: BuildBody;
  verification: Verification;
  /**
   * How badly the linear model misses, scored against the exact tables in
   * `overrides`. Absent until at least one real cap table has been transcribed.
   */
  measuredAccuracy?: {
    measuredAt: string;
    againstBody: string;
    meanAbsoluteError: number;
    worstAttribute: { attribute: AttributeId; error: number };
    biasedHighOn: number;
    attributesCompared: number;
  };
}

/** An exact cap table read off the real builder, for one specific body. */
export interface CapOverrideEntry {
  label: string;
  verification: Verification;
  caps: Partial<Record<AttributeId, number>>;
}

export interface CapsData {
  capModel: CapModel;
  attributeCaps: AttributeCapRule[];
  /** Keyed `POSITION|height|weight|wingspan`, `*` matching anything. */
  overrides: Record<string, CapOverrideEntry>;
}

export interface BudgetData {
  enabled: boolean;
  verification: Verification;
  referenceBody: { heightInches: number; weightPounds: number; wingspanInches: number };
  base: number;
  perInchHeight: number;
  perPoundWeight: number;
  perInchWingspan: number;
  positionAdjust: Record<PositionId, number>;
  minimum: number;
}

export interface BadgeLevelDef {
  id: BadgeLevelId;
  name: string;
  order: number;
  scoreWeight: number;
  /**
   * 2K27's Legend tier exists but cannot be reached at build creation — it is
   * only obtainable by Synergy-boosting a Hall of Fame badge. Levels with this
   * false have no attribute requirement row on any badge.
   */
  obtainableAtBuildCreation: boolean;
  note?: string;
}

export interface BadgeTier {
  level: BadgeLevelId;
  requires: RequirementClause[];
  /** Badge tokens to equip this tier. null when the cost is not known. */
  tokenCost: number | null;
}

export interface BadgeDef {
  id: BadgeId;
  name: string;
  category: string;
  impact: number;
  description: string;
  restrictions?: BodyRequirement & { positions?: PositionId[]; note?: string };
  tiers: BadgeTier[];
  /** True when the source data only covers some of this badge's tiers. */
  incompleteTiers?: boolean;
  verification: Verification;
}

export interface AnimationCategory {
  id: string;
  name: string;
  description: string;
}

export interface AnimationDef {
  id: AnimationId;
  name: string;
  category: string;
  impact: number;
  requires: RequirementClause[];
  bodyRequires?: BodyRequirement;
  notes?: string;
  verification: Verification;
}

export interface TakeoverTier {
  id: string;
  name: string;
  requires: RequirementClause[];
}

export interface TakeoverDef {
  id: TakeoverId;
  name: string;
  description: string;
  impact: number;
  tiers: TakeoverTier[];
  verification: Verification;
}

/**
 * One attribute's cap breaker row for one body. `slots[i]` is the point gain
 * from filling the i-th breaker slot, or `null` if the builder locks that slot
 * out — several attributes on a given frame can never be raised at all.
 */
export interface CapBreakerRow {
  slots: (number | null)[];
  /** The cap with every unlocked slot filled, as the builder displays it. */
  newCap: number;
}

export interface CapBreakerTable {
  label: string;
  verification: Verification;
  attributes: Record<AttributeId, CapBreakerRow>;
}

export interface CapBreakerData {
  enabled: boolean;
  slotsPerAttribute: number;
  costsBuildPoints: boolean;
  absoluteCeiling: number;
  rules: {
    visibleOnlyAt99Overall: boolean;
    grantsBadgeTokens: boolean;
    verification?: Verification;
    note?: string;
  };
  /**
   * How many of the tabulated gains a player may actually claim. The gain table
   * is read off the builder; this is not — see the file's own commentary.
   */
  allocation: {
    mode: 'shared-pool' | 'per-attribute';
    poolSize: number;
    verification: Verification;
  };
  eligibility: { mode: 'all' | 'all-except' | 'only'; excludedAttributes: AttributeId[]; note?: string };
  includedAttributes: AttributeId[];
  /** Keyed `POSITION|height|weight|wingspan`, `*` matching anything. */
  gainTables: { entries: Record<string, CapBreakerTable> };
  verification: Verification;
}

/** The Synergy system — 2K27's badge boost mechanic. */
export interface BadgeBoostData {
  enabled: boolean;
  totalSlots: number;
  plusOne: { slots: number; levelsGained: number; note?: string };
  plusTwo: { slots: number; levelsGained: number; note?: string };
  /** How many slots this player has actually unlocked; Synergy is earned. */
  availableSlots?: { plusOne: number; plusTwo: number; verification?: Verification };
  rules: {
    canStackOnSameBadge: boolean;
    canBoostToLegend: boolean;
    /** Legend is reachable only by boosting, never by attribute requirement. */
    legendOnlyViaSynergy: boolean;
    /** A Fused badge refunds the tokens that would have equipped it. */
    fuseRefundsTokens: boolean;
    requiresBadgeAlreadyUnlocked: boolean;
    minimumLevelToBoost: BadgeLevelId;
    eligibleCategories: string[];
    excludedBadges: BadgeId[];
    verification?: Verification;
  };
  reaction?: { modelled: boolean };
  verification: Verification;
}

/**
 * The 2K27 badge token economy. Meeting an attribute threshold makes a badge
 * tier eligible; tokens and slots decide whether you can actually equip it.
 */
export interface BadgeTokenData {
  enabled: boolean;
  disciplines: string[];
  upgradeCostMode: { value: 'absolute' | 'incremental'; options: string[]; verification: Verification };
  slots: { total: number; byDiscipline: Record<string, number>; verification: Verification };
  costByBody: {
    enabled: boolean;
    verification: Verification;
    referenceHeightInches: number | null;
    perInchHeight: number;
    minCost: number;
    overrides: Record<string, number>;
  };
  tokenGrants: {
    mode: 'flat' | 'linear-by-investment' | 'table' | 'manual';
    verification: Verification;
    /** Tokens earned by playing. Set to what your account actually has. */
    flatByDiscipline: Record<string, number>;
    progressionPresets: Record<string, number>;
    freeBelow: number;
    pointsPerToken: number;
    maxPerDiscipline: number;
    /** discipline -> list of ratings that each grant a token. Used when mode is 'table'. */
    table: Record<string, { attribute: AttributeId; rating: number; tokens: number }[]>;
  };
  manualTokens: Record<string, number | null>;
  /** Price used when a badge tier's real token cost is unknown. */
  fallbackTokenCost: {
    enabled: boolean;
    byLevel: Record<BadgeLevelId, number>;
    verification: Verification;
  };
  rules: {
    capBreakersGrantTokens: boolean;
    /** Tokens can be reassigned at any time (official). */
    tokensReassignable?: boolean;
    /** Tokens earned in-game stay locked to their discipline (official). */
    inGameTokensLockedToDiscipline?: boolean;
    /** Bonus tokens from Specialization/Seasons/Crews are discipline-agnostic. */
    bonusTokensAnyDiscipline?: boolean;
    unspentTokensCarryOver?: boolean | null;
    canRefundTokens?: boolean | null;
    verification?: Verification;
  };
  verification: Verification;
}

export interface EquippedBadge {
  badgeId: BadgeId;
  name: string;
  category: string;
  impact: number;
  level: BadgeLevelId;
  levelName: string;
  levelOrder: number;
  tokenCost: number;
  /** True when tokenCost came from the fallback rather than the dataset. */
  tokenCostInferred?: boolean;
  /** Level after +1/+2 boosts are applied, if any. */
  boostedLevel?: BadgeLevelId;
  boostedLevelName?: string;
  verification: Verification;
}

export interface DisciplineTokenReport {
  discipline: string;
  earned: number;
  spent: number;
  remaining: number;
  slots: number;
  slotsUsed: number;
  /** Eligible badge tiers that were left unequipped, and why. */
  unaffordable: { badgeId: BadgeId; name: string; level: BadgeLevelId; levelName: string; tokenCost: number | null; reason: string }[];
}

export interface TokenReport {
  enabled: boolean;
  byDiscipline: DisciplineTokenReport[];
  totalEarned: number;
  totalSpent: number;
  totalSlots: number;
  totalSlotsUsed: number;
  /** Badges whose token cost is unknown in the dataset, so they cannot be planned. */
  unpricedBadges: string[];
  /** Badges priced from the fallback rather than from sourced data. */
  inferredCostBadges: string[];
}

export type DependencyKind = 'hard-min' | 'soft-link' | 'diminishing';

export interface DependencyRule {
  id: string;
  kind: DependencyKind;
  source: AttributeId;
  target: AttributeId;
  enabled: boolean;
  note?: string;
  verification: Verification;
  /** hard-min / soft-link */
  ratio?: number;
  offset?: number;
  min?: number;
  /** diminishing */
  threshold?: number;
  sourceMin?: number;
  factor?: number;
}

export interface ArchetypeDef {
  id: string;
  name: string;
  summary: string;
  position: PositionId;
  suggestedBody: { heightInches: number; weightPounds: number; wingspanInches: number };
  priorities: Record<PriorityGroupId, number>;
  constraints: {
    minimums: Partial<Record<AttributeId, number>>;
    softTargets: Partial<Record<AttributeId, number>>;
  };
  verification: Verification;
}

export interface DatasetMeta {
  datasetId: string;
  gameTitle: string;
  datasetVersion: string;
  schemaVersion: number;
  lastUpdated: string;
  provenance: {
    status: string;
    headline: string;
    explanation: string[];
    howToReplace: string;
    verificationLevels: Record<string, string>;
  };
  defaultVerification: Verification;
  uiWarnings: { globalBanner: string; showPerRecordBadges: boolean };
  files: { file: string; describes: string }[];
}

export interface Dataset {
  meta: DatasetMeta;
  ratingFloor: number;
  ratingCeiling: number;
  categories: AttributeCategory[];
  attributes: AttributeDef[];
  priorityGroups: PriorityGroup[];
  costCurves: CostCurve[];
  positions: PositionDef[];
  body: BodyModel;
  caps: CapsData;
  budget: BudgetData;
  badgeLevels: BadgeLevelDef[];
  badgeGlobalRules: {
    maxLegendBadges: number | null;
    maxBadgesPerCategory: number | null;
    legendRequiresSynergy: boolean;
    verification: Verification;
  };
  badges: BadgeDef[];
  animationCategories: AnimationCategory[];
  animations: AnimationDef[];
  takeoverSlots: { total: number; verification: Verification };
  /** 24 abilities exist in game; only those with known requirements are here. */
  takeoverAbilities?: { totalInGame: number; unlockable: number; documentedHere: number; verification: Verification };
  takeovers: TakeoverDef[];
  capBreakers: CapBreakerData;
  badgeTokens: BadgeTokenData;
  badgeBoosts: BadgeBoostData;
  dependencies: DependencyRule[];
  archetypes: ArchetypeDef[];
  /**
   * Build names the real builder assigns, keyed `POSITION|height|weight|wingspan`.
   * 2K27 names a build for you, so these are the only confirmed 2K27 names —
   * `archetypes` above use community naming.
   */
  officialBuildNames?: { verification: Verification; entries: Record<string, string> };
}

// ---------------------------------------------------------------------------
// Runtime / request types
// ---------------------------------------------------------------------------

export type AttributeVector = Record<AttributeId, number>;

export interface PriorityWeight {
  group: PriorityGroupId;
  /** 0-100. 0 means "do not spend here unless it is free". */
  weight: number;
}

export interface OptimizeRequest {
  body: BuildBody;
  /** Priority weights keyed by priority group id (see attributes.json). */
  priorities: Record<PriorityGroupId, number>;
  /** Hard attribute floors. An infeasible floor set is reported, not silently dropped. */
  minimums?: Partial<Record<AttributeId, number>>;
  /** Soft attribute targets: worth score, not required. */
  softTargets?: Partial<Record<AttributeId, number>>;
  /** Attributes the optimizer must not raise above this. */
  maximums?: Partial<Record<AttributeId, number>>;
  /** Score component weights; omitted components fall back to defaults. */
  scoreWeights?: Partial<ScoreWeights>;
  /** How many distinct builds to return. */
  resultCount?: number;
  /** Archetype this request came from, for labeling. */
  archetypeId?: string;
  /** Include cap breakers in the plan. */
  useCapBreakers?: boolean;
  /** Include +1/+2 badge boosts in the plan. */
  useBadgeBoosts?: boolean;
  /**
   * Override the badge token pool per discipline, for players who can read the
   * real numbers off the in-game builder. null/absent = compute from the dataset.
   */
  tokenOverrides?: Record<string, number | null>;
}

export interface ScoreWeights {
  badgeValue: number;
  animationUnlocks: number;
  attributeEfficiency: number;
  defensiveVersatility: number;
  shooting: number;
  finishing: number;
  playmaking: number;
  physicals: number;
  wastedPoints: number;
}

export interface UnlockedBadge {
  badgeId: BadgeId;
  name: string;
  category: string;
  impact: number;
  level: BadgeLevelId;
  levelName: string;
  levelOrder: number;
  /** Level after +1/+2 boosts are applied, if any. */
  boostedLevel?: BadgeLevelId;
  boostedLevelName?: string;
  verification: Verification;
}

export interface NextBadgeThreshold {
  badgeId: BadgeId;
  name: string;
  category: string;
  impact: number;
  currentLevel: BadgeLevelId | null;
  nextLevel: BadgeLevelId;
  nextLevelName: string;
  /** What is still missing, per attribute. */
  gaps: { attribute: AttributeId; attributeName: string; current: number; required: number; deficit: number }[];
  /** Build points needed to close every gap. */
  pointCost: number;
  verification: Verification;
}

export interface UnlockedAnimation {
  animationId: AnimationId;
  name: string;
  category: string;
  impact: number;
  verification: Verification;
}

export interface NextAnimationThreshold {
  animationId: AnimationId;
  name: string;
  category: string;
  impact: number;
  gaps: { attribute: AttributeId; attributeName: string; current: number; required: number; deficit: number }[];
  bodyBlocked: boolean;
  bodyBlockReason?: string;
  pointCost: number;
  verification: Verification;
}

export interface TakeoverStatus {
  takeoverId: TakeoverId;
  name: string;
  impact: number;
  unlockedTierIds: string[];
  highestTierName: string | null;
  nextTier?: {
    id: string;
    name: string;
    gaps: { attribute: AttributeId; attributeName: string; current: number; required: number; deficit: number }[];
    pointCost: number;
  };
  verification: Verification;
}

export interface CapBreakerRecommendation {
  attribute: AttributeId;
  attributeName: string;
  from: number;
  to: number;
  breakersUsed: number;
  reason: string;
  unlocks: string[];
  scoreGain: number;
}

/**
 * Why the cap breaker plan looks the way it does. `no-data` is the common case
 * and is a statement about the dataset, not about the build: gains are a
 * per-body lookup, so a body nobody has transcribed gets no plan at all.
 */
export interface CapBreakerPlanStatus {
  kind: 'planned' | 'no-data' | 'disabled' | 'no-breakers';
  /** Which transcribed body the plan came from, when there is one. */
  tableLabel?: string;
  note: string;
}

export interface BadgeBoostRecommendation {
  slot: 'plusOne' | 'plusTwo';
  badgeId: BadgeId;
  badgeName: string;
  fromLevel: BadgeLevelId | null;
  fromLevelName: string;
  toLevel: BadgeLevelId;
  toLevelName: string;
  scoreGain: number;
  reason: string;
}

export interface WasteFinding {
  attribute: AttributeId;
  attributeName: string;
  value: number;
  /** Highest threshold this attribute actually satisfies that anyone cares about. */
  lastUsefulValue: number;
  wastedPoints: number;
  refundableBuildPoints: number;
  severity: 'info' | 'warning' | 'critical';
  message: string;
}

export interface ScoreBreakdown {
  total: number;
  components: {
    badgeValue: number;
    animationUnlocks: number;
    attributeEfficiency: number;
    defensiveVersatility: number;
    shooting: number;
    finishing: number;
    playmaking: number;
    physicals: number;
    wastedPoints: number;
  };
  weighted: {
    badgeValue: number;
    animationUnlocks: number;
    attributeEfficiency: number;
    defensiveVersatility: number;
    shooting: number;
    finishing: number;
    playmaking: number;
    physicals: number;
    wastedPoints: number;
  };
}

export interface BuildEvaluation {
  body: BuildBody;
  attributes: AttributeVector;
  /** Attributes after cap breakers are applied. */
  effectiveAttributes: AttributeVector;
  caps: AttributeVector;
  budget: number;
  spent: number;
  remaining: number;
  /** Every badge tier the attributes make ELIGIBLE, before tokens are spent. */
  badges: UnlockedBadge[];
  /** The badges actually equipped within the token and slot budgets. */
  equippedBadges: EquippedBadge[];
  tokens: TokenReport;
  nextBadges: NextBadgeThreshold[];
  animations: UnlockedAnimation[];
  nextAnimations: NextAnimationThreshold[];
  takeovers: TakeoverStatus[];
  capBreakerPlan: CapBreakerRecommendation[];
  capBreakersRemaining: number;
  capBreakerStatus: CapBreakerPlanStatus;
  /** True when this body's caps came from a transcribed table, not the model. */
  capsAreExact: boolean;
  badgeBoostPlan: BadgeBoostRecommendation[];
  waste: WasteFinding[];
  dependencyWarnings: { ruleId: string; message: string; severity: 'info' | 'warning' | 'critical' }[];
  score: ScoreBreakdown;
}

export interface OptimizedBuild extends BuildEvaluation {
  id: string;
  label: string;
  /** Short human-readable description of what this build trades away. */
  tradeoffs: string[];
  /** Why the optimizer stopped each attribute where it did. */
  rationale: { attribute: AttributeId; attributeName: string; value: number; reason: string }[];
}

export interface OptimizeResult {
  request: OptimizeRequest;
  feasible: boolean;
  infeasibilityReasons: string[];
  builds: OptimizedBuild[];
  /** Comparison notes between the returned builds. */
  comparison: string[];
  datasetWarning: string;
  computeMs: number;
}
