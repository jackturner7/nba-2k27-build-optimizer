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

/** A conjunctive attribute requirement: every entry must be met. */
export interface AttributeRequirement {
  attribute: AttributeId;
  min: number;
}

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
}

export interface CapsData {
  capModel: CapModel;
  attributeCaps: AttributeCapRule[];
  overrides: Record<string, Partial<Record<AttributeId, number>>>;
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
}

export interface BadgeTier {
  level: BadgeLevelId;
  requires: AttributeRequirement[];
}

export interface BadgeDef {
  id: BadgeId;
  name: string;
  category: string;
  impact: number;
  description: string;
  restrictions?: BodyRequirement & { positions?: PositionId[]; note?: string };
  tiers: BadgeTier[];
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
  requires: AttributeRequirement[];
  bodyRequires?: BodyRequirement;
  notes?: string;
  verification: Verification;
}

export interface TakeoverTier {
  id: string;
  name: string;
  requires: AttributeRequirement[];
}

export interface TakeoverDef {
  id: TakeoverId;
  name: string;
  description: string;
  impact: number;
  tiers: TakeoverTier[];
  verification: Verification;
}

export interface CapBreakerData {
  enabled: boolean;
  totalAvailable: number;
  maxPerAttribute: number;
  raisePerBreaker: number;
  costsBuildPoints: boolean;
  absoluteCeiling: number;
  eligibility: { mode: 'all' | 'all-except' | 'only'; excludedAttributes: AttributeId[]; note?: string };
  includedAttributes: AttributeId[];
  tiers: { id: string; name: string; unlockNote: string; verification: Verification }[];
  verification: Verification;
}

export interface BadgeBoostData {
  enabled: boolean;
  plusOne: { slots: number; levelsGained: number; note?: string };
  plusTwo: { slots: number; levelsGained: number; note?: string };
  rules: {
    canStackOnSameBadge: boolean;
    canBoostToLegend: boolean;
    requiresBadgeAlreadyUnlocked: boolean;
    minimumLevelToBoost: BadgeLevelId;
    eligibleCategories: string[];
    excludedBadges: BadgeId[];
  };
  verification: Verification;
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
  badgeGlobalRules: { maxLegendBadges: number | null; maxBadgesPerCategory: number | null; verification: Verification };
  badges: BadgeDef[];
  animationCategories: AnimationCategory[];
  animations: AnimationDef[];
  takeoverSlots: { primary: number; secondary: number; verification: Verification };
  takeovers: TakeoverDef[];
  capBreakers: CapBreakerData;
  badgeBoosts: BadgeBoostData;
  dependencies: DependencyRule[];
  archetypes: ArchetypeDef[];
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
  badges: UnlockedBadge[];
  nextBadges: NextBadgeThreshold[];
  animations: UnlockedAnimation[];
  nextAnimations: NextAnimationThreshold[];
  takeovers: TakeoverStatus[];
  capBreakerPlan: CapBreakerRecommendation[];
  capBreakersRemaining: number;
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
