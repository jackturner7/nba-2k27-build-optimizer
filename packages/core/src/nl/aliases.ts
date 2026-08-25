import type { Dataset } from '../types.js';

/**
 * Phrase -> attribute id. The dataset supplies the canonical names and short
 * codes; this table adds the slang people actually type.
 *
 * Longer phrases are matched first, so "speed with ball" never gets eaten by
 * "speed".
 */
const MANUAL_ALIASES: Record<string, string[]> = {
  three_point: ['3pt', '3 pt', '3-point', '3 point', 'three point', 'three-point', 'threes', 'three ball', 'deep range', 'from deep', 'outside shot', 'outside shooting', 'shooting from three', '3 ball'],
  mid_range: ['midrange', 'mid range', 'mid-range', 'pull up', 'pull-up', 'pullup'],
  free_throw: ['free throw', 'free throws', 'ft', 'from the line', 'foul shooting'],
  close_shot: ['close shot', 'close shots', 'finishing at the rim', 'around the rim', 'hooks'],
  driving_layup: ['driving layup', 'layup', 'layups', 'finishing layups'],
  driving_dunk: ['driving dunk', 'driving dunks', 'dunking', 'dunk', 'dunks', 'contact dunks', 'posters', 'slashing', 'above the rim'],
  standing_dunk: ['standing dunk', 'standing dunks', 'lob threat', 'alley oops', 'alley-oops'],
  post_control: ['post control', 'post game', 'post moves', 'post scoring', 'back to the basket'],
  pass_accuracy: ['pass accuracy', 'passing', 'passer', 'dimes', 'playmaking passing'],
  ball_handle: ['ball handle', 'ball handling', 'handle', 'handles', 'dribbling', 'dribble', 'dribble moves'],
  speed_with_ball: ['speed with ball', 'speed with the ball', 'swb', 'ball speed', 'speed with ball handling'],
  interior_defense: ['interior defense', 'interior d', 'paint defense', 'paint d', 'inside defense', 'post defense'],
  perimeter_defense: ['perimeter defense', 'perimeter d', 'on ball defense', 'on-ball defense', 'point of attack defense', 'poa defense', 'guarding the perimeter', 'lockdown defense'],
  steal: ['steal', 'steals', 'stealing', 'picking pockets', 'strips'],
  block: ['block', 'blocks', 'blocking', 'shot blocking', 'rim protection', 'rim protecting', 'swats'],
  offensive_rebound: ['offensive rebound', 'offensive rebounding', 'offensive boards', 'putbacks'],
  defensive_rebound: ['defensive rebound', 'defensive rebounding', 'defensive boards', 'rebounding', 'rebounds', 'boards', 'glass'],
  speed: ['speed', 'quickness', 'fast'],
  acceleration: ['acceleration', 'accel', 'first step', 'burst'],
  strength: ['strength', 'strong', 'physicality'],
  vertical: ['vertical', 'vert', 'bounce', 'hops', 'jumping'],
  stamina: ['stamina', 'endurance', 'gas tank'],
};

const GROUP_ALIASES: Record<string, string[]> = {
  athleticism: ['athleticism', 'athletic', 'athlete', 'explosiveness', 'explosive'],
  rebounding: ['rebounding', 'rebounds', 'boards', 'glass cleaning'],
  playmaking: ['playmaking', 'playmaker', 'creation', 'facilitating', 'running the offense'],
  three_point_shooting: ['shooting', 'shooter', 'sniper', 'knockdown shooter'],
  perimeter_defense: ['perimeter defense', 'lockdown', 'defender', 'defense'],
  finishing: ['finishing', 'finisher', 'inside scoring', 'scoring inside'],
  post_scoring: ['post scoring', 'post play'],
};

export interface AliasIndex {
  /** Sorted longest-first so greedy matching prefers the specific phrase. */
  attributePhrases: { phrase: string; attribute: string }[];
  groupPhrases: { phrase: string; group: string }[];
}

const cache = new WeakMap<Dataset, AliasIndex>();

export function aliasIndex(ds: Dataset): AliasIndex {
  let idx = cache.get(ds);
  if (idx) return idx;

  const attributePhrases: { phrase: string; attribute: string }[] = [];
  const seen = new Set<string>();
  const add = (phrase: string, attribute: string) => {
    const p = phrase.toLowerCase().trim();
    if (!p || seen.has(`${p}|${attribute}`)) return;
    seen.add(`${p}|${attribute}`);
    attributePhrases.push({ phrase: p, attribute });
  };

  for (const a of ds.attributes) {
    add(a.name, a.id);
    add(a.id.replace(/_/g, ' '), a.id);
    add(a.short, a.id);
    for (const alias of MANUAL_ALIASES[a.id] ?? []) add(alias, a.id);
  }

  const groupPhrases: { phrase: string; group: string }[] = [];
  const groupSeen = new Set<string>();
  const addGroup = (phrase: string, group: string) => {
    const p = phrase.toLowerCase().trim();
    if (!p || groupSeen.has(`${p}|${group}`)) return;
    groupSeen.add(`${p}|${group}`);
    groupPhrases.push({ phrase: p, group });
  };
  for (const g of ds.priorityGroups) {
    addGroup(g.name, g.id);
    addGroup(g.id.replace(/_/g, ' '), g.id);
    for (const alias of GROUP_ALIASES[g.id] ?? []) addGroup(alias, g.id);
  }

  attributePhrases.sort((a, b) => b.phrase.length - a.phrase.length);
  groupPhrases.sort((a, b) => b.phrase.length - a.phrase.length);

  idx = { attributePhrases, groupPhrases };
  cache.set(ds, idx);
  return idx;
}

export const POSITION_ALIASES: Record<string, string[]> = {
  PG: ['point guard', 'pg', 'lead guard', 'floor general', '1 guard'],
  SG: ['shooting guard', 'sg', 'two guard', '2 guard', 'off guard', 'guard'],
  SF: ['small forward', 'sf', 'wing', 'three', 'point forward'],
  PF: ['power forward', 'pf', 'four', 'stretch four', 'stretch big', 'forward'],
  C: ['center', 'c', 'five', 'big man', 'big', 'rim runner'],
};

/** Word -> intended intensity, 0-100. Feeds both priorities and soft targets. */
export const INTENSITY_WORDS: { words: string[]; weight: number }[] = [
  { words: ['maximum', 'max', 'highest possible', 'highest', 'as high as possible', 'best possible', 'elite', 'lockdown', 'godly', 'insane'], weight: 100 },
  { words: ['great', 'excellent', 'very good', 'high', 'strong', 'top tier', 'top-tier'], weight: 85 },
  { words: ['good', 'solid', 'reliable', 'quality'], weight: 68 },
  { words: ['decent', 'respectable', 'usable', 'serviceable', 'okay', 'ok'], weight: 52 },
  { words: ['enough', 'sufficient', 'adequate', 'some'], weight: 42 },
  { words: ['a little', 'low', 'minimal', 'bit of'], weight: 22 },
  { words: ['no ', 'none', 'zero', "don't care about", 'do not care about', 'ignore'], weight: 0 },
];
