import { z } from 'zod';

/**
 * Validation schemas for the JSON dataset files.
 *
 * Every dataset file is validated on load. A malformed file fails loudly rather
 * than silently producing a wrong build — the whole point of this app is that
 * the numbers are replaceable, so bad replacements must be caught.
 */

const verification = z
  .object({
    status: z
      .enum(['verified', 'community-verified', 'estimated', 'unverified', 'deprecated'])
      .default('unverified'),
    source: z.string().nullish(),
    notes: z.string().nullish(),
    lastReviewed: z.string().nullish(),
  })
  .default({ status: 'unverified' });

const singleRequirement = z.object({
  attribute: z.string(),
  min: z.number().int(),
});

/**
 * A requirement clause: either a single attribute minimum, or an "any of" set
 * where satisfying one branch is enough. 2K27 uses the latter constantly
 * ("65 Mid-Range Shot or 65 Three-Point Shot").
 */
const attributeRequirement = z.union([
  singleRequirement,
  z.object({ anyOf: z.array(singleRequirement).min(1) }),
]);

const bodyRequirement = z.object({
  minHeightInches: z.number().optional(),
  maxHeightInches: z.number().optional(),
  minWeightPounds: z.number().optional(),
  maxWeightPounds: z.number().optional(),
  minWingspanInches: z.number().optional(),
  maxWingspanInches: z.number().optional(),
});

export const metaSchema = z.object({
  datasetId: z.string(),
  gameTitle: z.string(),
  datasetVersion: z.string(),
  schemaVersion: z.number().int(),
  lastUpdated: z.string(),
  provenance: z.object({
    status: z.string(),
    headline: z.string(),
    explanation: z.array(z.string()),
    howToReplace: z.string(),
    verificationLevels: z.record(z.string(), z.string()),
  }),
  defaultVerification: verification,
  uiWarnings: z.object({
    globalBanner: z.string(),
    showPerRecordBadges: z.boolean(),
  }),
  files: z.array(z.object({ file: z.string(), describes: z.string() })),
});

export const attributesSchema = z.object({
  ratingFloor: z.number().int(),
  ratingCeiling: z.number().int(),
  categories: z.array(z.object({ id: z.string(), name: z.string(), color: z.string() })),
  attributes: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      short: z.string(),
      category: z.string(),
      costCurve: z.string(),
      verification,
    })
  ),
  priorityGroups: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      attributes: z.array(z.string()),
      supporting: z.array(z.string()).default([]),
    })
  ),
});

export const costCurvesSchema = z.object({
  curves: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      verification,
      ranges: z.array(
        z.object({
          from: z.number().int(),
          to: z.number().int(),
          costPerPoint: z.number().nonnegative(),
        })
      ),
    })
  ),
});

export const positionsSchema = z.object({
  positions: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      heightInchesMin: z.number().int(),
      heightInchesMax: z.number().int(),
      secondaryPositions: z.array(z.string()).default([]),
      verification,
    })
  ),
});

export const bodySchema = z.object({
  heightInchesMin: z.number().int(),
  heightInchesMax: z.number().int(),
  weightModel: z.object({
    kind: z.string(),
    verification,
    referenceHeightInches: z.number(),
    minWeightAtReference: z.number(),
    maxWeightAtReference: z.number(),
    minWeightPerInch: z.number(),
    maxWeightPerInch: z.number(),
    absoluteMin: z.number(),
    absoluteMax: z.number(),
  }),
  wingspanModel: z.object({
    kind: z.string(),
    verification,
    minOffsetInches: z.number(),
    maxOffsetInches: z.number(),
    absoluteMinInches: z.number(),
    absoluteMaxInches: z.number(),
  }),
  interactions: z.object({
    verification,
    rules: z
      .array(
        z.object({
          id: z.string(),
          when: bodyRequirement,
          clamp: z.object({
            maxWingspanInches: z.number().optional(),
            minWingspanInches: z.number().optional(),
            maxWeightPounds: z.number().optional(),
            minWeightPounds: z.number().optional(),
          }),
          note: z.string().optional(),
          verification: verification.optional(),
        })
      )
      .default([]),
  }),
  overrides: z.object({
    entries: z
      .record(
        z.string(),
        z.object({
          weightMin: z.number().optional(),
          weightMax: z.number().optional(),
          wingspanMin: z.number().optional(),
          wingspanMax: z.number().optional(),
        })
      )
      .default({}),
  }),
});

export const capsSchema = z.object({
  capModel: z.object({
    kind: z.string(),
    verification,
    referenceBody: z.object({
      position: z.string(),
      heightInches: z.number(),
      weightPounds: z.number(),
      wingspanInches: z.number(),
    }),
  }),
  attributeCaps: z.array(
    z.object({
      attribute: z.string(),
      baseCap: z.number(),
      perInchHeight: z.number(),
      perPoundWeight: z.number(),
      perInchWingspan: z.number(),
      positionAdjust: z.record(z.string(), z.number()).optional(),
      hardMin: z.number(),
      hardMax: z.number(),
      verification,
    })
  ),
  overrides: z.object({
    entries: z.record(z.string(), z.record(z.string(), z.number())).default({}),
  }),
});

export const budgetSchema = z.object({
  enabled: z.boolean(),
  verification,
  referenceBody: z.object({
    heightInches: z.number(),
    weightPounds: z.number(),
    wingspanInches: z.number(),
  }),
  base: z.number(),
  perInchHeight: z.number(),
  perPoundWeight: z.number(),
  perInchWingspan: z.number(),
  positionAdjust: z.record(z.string(), z.number()).default({}),
  minimum: z.number(),
});

export const badgesSchema = z.object({
  levels: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      order: z.number().int(),
      scoreWeight: z.number(),
    })
  ),
  globalRules: z.object({
    maxLegendBadges: z.number().int().nullable(),
    maxBadgesPerCategory: z.number().int().nullable(),
    verification,
  }),
  badges: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      category: z.string(),
      impact: z.number().min(0).max(5),
      description: z.string().default(''),
      restrictions: bodyRequirement
        .extend({ positions: z.array(z.string()).optional(), note: z.string().optional() })
        .optional(),
      verification,
      incompleteTiers: z.boolean().optional(),
      tiers: z.array(
        z.object({
          level: z.string(),
          tokenCost: z.number().int().nonnegative().nullable().default(null),
          requires: z.array(attributeRequirement),
        })
      ),
    })
  ),
});

export const badgeTokensSchema = z.object({
  enabled: z.boolean(),
  verification,
  disciplines: z.array(z.string()),
  upgradeCostMode: z.object({
    value: z.enum(['absolute', 'incremental']),
    options: z.array(z.string()).default([]),
    verification,
  }),
  slots: z.object({
    total: z.number().int().nonnegative(),
    byDiscipline: z.record(z.string(), z.number().int().nonnegative()),
    verification,
  }),
  tokenGrants: z.object({
    mode: z.enum(['linear-by-investment', 'table', 'manual']),
    verification,
    freeBelow: z.number().default(0),
    pointsPerToken: z.number().positive().default(1),
    maxPerDiscipline: z.number().int().nonnegative().default(99),
    table: z
      .record(
        z.string(),
        z.array(z.object({ attribute: z.string(), rating: z.number().int(), tokens: z.number().int() }))
      )
      .default({}),
  }),
  manualTokens: z.record(z.string(), z.number().nullable()).default({}),
  fallbackTokenCost: z
    .object({
      enabled: z.boolean().default(false),
      verification,
      byLevel: z.record(z.string(), z.number().int().nonnegative()).default({}),
    })
    .default({ enabled: false, byLevel: {}, verification: { status: 'unverified' } }),
  rules: z.object({
    capBreakersGrantTokens: z.boolean().default(false),
    unspentTokensCarryOver: z.boolean().nullable().default(null),
    canRefundTokens: z.boolean().nullable().default(null),
  }),
});

export const animationsSchema = z.object({
  categories: z.array(z.object({ id: z.string(), name: z.string(), description: z.string().default('') })),
  animations: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      category: z.string(),
      impact: z.number().min(0).max(5),
      requires: z.array(attributeRequirement),
      bodyRequires: bodyRequirement.optional(),
      notes: z.string().optional(),
      verification,
    })
  ),
});

export const takeoversSchema = z.object({
  slots: z.object({ primary: z.number().int(), secondary: z.number().int(), verification }),
  takeovers: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string().default(''),
      impact: z.number().min(0).max(5),
      verification,
      tiers: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          requires: z.array(attributeRequirement),
        })
      ),
    })
  ),
});

export const capBreakersSchema = z.object({
  verification,
  enabled: z.boolean(),
  totalAvailable: z.number().int().nonnegative(),
  maxPerAttribute: z.number().int().nonnegative(),
  raisePerBreaker: z.number().int().positive(),
  costsBuildPoints: z.boolean(),
  absoluteCeiling: z.number().int(),
  eligibility: z.object({
    mode: z.enum(['all', 'all-except', 'only']),
    excludedAttributes: z.array(z.string()).default([]),
    note: z.string().optional(),
  }),
  includedAttributes: z.array(z.string()).default([]),
  tiers: z
    .array(z.object({ id: z.string(), name: z.string(), unlockNote: z.string().default(''), verification }))
    .default([]),
});

export const badgeBoostsSchema = z.object({
  verification,
  enabled: z.boolean(),
  plusOne: z.object({ slots: z.number().int().nonnegative(), levelsGained: z.number().int(), note: z.string().optional() }),
  plusTwo: z.object({ slots: z.number().int().nonnegative(), levelsGained: z.number().int(), note: z.string().optional() }),
  rules: z.object({
    canStackOnSameBadge: z.boolean(),
    canBoostToLegend: z.boolean(),
    requiresBadgeAlreadyUnlocked: z.boolean(),
    minimumLevelToBoost: z.string(),
    eligibleCategories: z.array(z.string()).default([]),
    excludedBadges: z.array(z.string()).default([]),
  }),
});

export const dependenciesSchema = z.object({
  dependencies: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(['hard-min', 'soft-link', 'diminishing']),
      source: z.string(),
      target: z.string(),
      enabled: z.boolean().default(true),
      note: z.string().optional(),
      verification,
      ratio: z.number().optional(),
      offset: z.number().optional(),
      min: z.number().optional(),
      threshold: z.number().optional(),
      sourceMin: z.number().optional(),
      factor: z.number().optional(),
    })
  ),
});

export const archetypesSchema = z.object({
  archetypes: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      summary: z.string().default(''),
      position: z.string(),
      suggestedBody: z.object({
        heightInches: z.number(),
        weightPounds: z.number(),
        wingspanInches: z.number(),
      }),
      priorities: z.record(z.string(), z.number()),
      constraints: z.object({
        minimums: z.record(z.string(), z.number()).default({}),
        softTargets: z.record(z.string(), z.number()).default({}),
      }),
      verification,
    })
  ),
});

export interface RawDatasetFiles {
  meta: unknown;
  badgeTokens: unknown;
  attributes: unknown;
  costCurves: unknown;
  positions: unknown;
  body: unknown;
  caps: unknown;
  budget: unknown;
  badges: unknown;
  animations: unknown;
  takeovers: unknown;
  capBreakers: unknown;
  badgeBoosts: unknown;
  dependencies: unknown;
  archetypes: unknown;
}
