#!/usr/bin/env node
/**
 * Imports NBA 2K27 badge requirements from NBA 2K Lab into data/2k27/badges.json.
 *
 *   node scripts/import-2klab.mjs [path-to-saved.html]
 *
 * With no argument it fetches https://www.nba2klab.com/badge-requirements. The
 * page server-renders the requirement tables, so no browser is needed.
 *
 * What 2K Lab supplies: attribute requirements per tier, AND/OR logic, and the
 * HEIGHT RANGE each badge is available at. What it does NOT supply is badge
 * TOKEN COSTS — those come from the 2K27 badge cost charts and are preserved
 * from the existing badges.json, keyed by badge id and tier.
 *
 * Anything the script cannot source is left explicitly null rather than guessed.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BADGES_PATH = join(ROOT, 'data', '2k27', 'badges.json');
const SOURCE_URL = 'https://www.nba2klab.com/badge-requirements';

/** 2K Lab's display names -> our attribute ids. */
const ATTRIBUTES = {
  'Three-Point Shot': 'three_point',
  'Mid-Range Shot': 'mid_range',
  'Free Throw': 'free_throw',
  'Close Shot': 'close_shot',
  'Driving Layup': 'driving_layup',
  'Driving Dunk': 'driving_dunk',
  'Standing Dunk': 'standing_dunk',
  'Post Control': 'post_control',
  'Pass Accuracy': 'pass_accuracy',
  'Ball Handle': 'ball_handle',
  'Speed With Ball': 'speed_with_ball',
  'Speed with Ball': 'speed_with_ball',
  'Interior Defense': 'interior_defense',
  'Perimeter Defense': 'perimeter_defense',
  Steal: 'steal',
  Block: 'block',
  'Offensive Rebound': 'offensive_rebound',
  'Defensive Rebound': 'defensive_rebound',
  Speed: 'speed',
  Agility: 'agility',
  Strength: 'strength',
  Vertical: 'vertical',
};

/** Table order on the page. */
const DISCIPLINES = ['shooting', 'playmaking', 'finishing', 'defense', 'rebounding', 'physicals'];
const LEVELS = ['bronze', 'silver', 'gold', 'hof'];

const decode = (s) =>
  s
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');

const strip = (s) => decode(s.replace(/<[^>]+>/g, '')).trim();

const slug = (name) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');

function heightToInches(text) {
  const m = /^(\d+)'(\d+)/.exec(text.trim());
  return m ? Number(m[1]) * 12 + Number(m[2]) : null;
}

function parse(html) {
  const badges = new Map();
  const tables = html.match(/<table[\s\S]*?<\/table>/g) ?? [];
  if (tables.length !== DISCIPLINES.length) {
    console.warn(
      `Expected ${DISCIPLINES.length} tables, found ${tables.length}. Discipline assignment may be wrong — verify the output.`
    );
  }

  tables.forEach((table, tableIndex) => {
    const discipline = DISCIPLINES[tableIndex] ?? `table_${tableIndex}`;
    for (const row of table.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) ?? []) {
      const cells = row.match(/<td[^>]*>[\s\S]*?<\/td>/g) ?? [];
      if (cells.length < 7) continue;

      const name = strip(cells[0]);
      const attributeName = /class="rq-desk">([^<]+)</.exec(cells[1]);
      if (!name || !attributeName) continue;

      const attribute = ATTRIBUTES[decode(attributeName[1]).trim()];
      if (!attribute) {
        console.warn(`Unknown attribute "${attributeName[1]}" on badge "${name}" — skipped.`);
        continue;
      }

      const logic = /class="bt-logic">(\w+)</.exec(cells[1])?.[1] ?? 'AND';
      const mins = cells.slice(2, 6).map((cell) => {
        const v = /># *(\d+) *</.exec(cell) ?? />(\d+)</.exec(cell);
        return v ? Number(v[1]) : null;
      });
      const heights = (cells[6].match(/\d+&#x27;\d+|\d+'\d+/g) ?? []).map((h) => heightToInches(decode(h)));

      const entry = badges.get(name) ?? { name, discipline, rows: [], heights };
      entry.rows.push({ attribute, logic, mins });
      badges.set(name, entry);
    }
  });
  return badges;
}

/**
 * Rebuilds a badge's tier list. Rows sharing OR logic become one `anyOf` clause;
 * AND rows each become their own clause. A branch with no value at a tier is
 * dropped from that tier only — 2K27 really does withdraw options at the top
 * (Unpluckable loses its Post Control branch at Hall of Fame).
 */
function buildTiers(entry, tokenCostsById) {
  const tiers = [];
  for (let i = 0; i < LEVELS.length; i++) {
    const level = LEVELS[i];
    const orBranches = [];
    const andClauses = [];

    for (const row of entry.rows) {
      const min = row.mins[i];
      if (min === null || min === undefined) continue;
      if (row.logic === 'OR') orBranches.push({ attribute: row.attribute, min });
      else andClauses.push({ attribute: row.attribute, min });
    }

    const requires = [];
    if (orBranches.length === 1) requires.push(orBranches[0]);
    else if (orBranches.length > 1) requires.push({ anyOf: orBranches });
    requires.push(...andClauses);

    if (requires.length === 0) continue;
    tiers.push({ level, tokenCost: tokenCostsById?.[level] ?? null, requires });
  }
  return tiers;
}

function restrictionsFor(entry, fullRange) {
  const [min, max] = entry.heights;
  const out = {};
  if (min != null && min > fullRange.min) out.minHeightInches = min;
  if (max != null && max < fullRange.max) out.maxHeightInches = max;
  if (Object.keys(out).length === 0) return undefined;
  out.note = `NBA 2K Lab lists this badge as available from ${fmt(entry.heights[0])} to ${fmt(entry.heights[1])}.`;
  return out;
}

const fmt = (inches) => (inches == null ? '?' : `${Math.floor(inches / 12)}'${inches % 12}"`);

async function main() {
  const file = process.argv[2];
  const html = file
    ? readFileSync(file, 'utf8')
    : await fetch(SOURCE_URL).then((r) => {
        if (!r.ok) throw new Error(`${SOURCE_URL} returned ${r.status}`);
        return r.text();
      });

  const scraped = parse(html);
  if (scraped.size === 0) throw new Error('No badge rows found. The page structure has probably changed.');

  if (!existsSync(BADGES_PATH)) throw new Error(`Missing ${BADGES_PATH}`);
  const existing = JSON.parse(readFileSync(BADGES_PATH, 'utf8'));
  const previous = new Map(existing.badges.map((b) => [b.id, b]));

  // The widest height band any badge lists is the builder's own range; a badge
  // spanning all of it is unrestricted, not restricted to it.
  const allHeights = [...scraped.values()].flatMap((e) => e.heights).filter((h) => h != null);
  const fullRange = { min: Math.min(...allHeights), max: Math.max(...allHeights) };

  const badges = [];
  for (const entry of scraped.values()) {
    const id = slug(entry.name);
    const prior = previous.get(id);
    const tokenCosts = prior
      ? Object.fromEntries(prior.tiers.map((t) => [t.level, t.tokenCost]))
      : undefined;

    const tiers = buildTiers(entry, tokenCosts);
    const restrictions = restrictionsFor(entry, fullRange);
    const missingCosts = tiers.some((t) => t.tokenCost === null);

    badges.push({
      id,
      name: entry.name,
      category: entry.discipline,
      impact: prior?.impact ?? 3,
      description: prior?.description ?? '',
      ...(restrictions ? { restrictions } : {}),
      ...(missingCosts ? { incompleteTiers: true } : {}),
      verification: {
        status: 'community-verified',
        source: `NBA 2K Lab badge requirements (${SOURCE_URL}), collected at NBA 2K27 Community Day.`,
        notes: missingCosts
          ? 'Requirements and height range from 2K Lab. Badge TOKEN COSTS are not published there and are unknown for this badge.'
          : 'Requirements and height range from 2K Lab; token costs from the 2K27 badge cost charts.',
        lastReviewed: new Date().toISOString().slice(0, 10),
      },
      tiers,
    });
  }

  badges.sort((a, b) =>
    a.category === b.category ? a.name.localeCompare(b.name) : DISCIPLINES.indexOf(a.category) - DISCIPLINES.indexOf(b.category)
  );

  const dropped = [...previous.keys()].filter((id) => !badges.some((b) => b.id === id));
  if (dropped.length) console.warn(`Dropped badges not present on 2K Lab: ${dropped.join(', ')}`);

  existing.badges = badges;
  writeFileSync(BADGES_PATH, `${JSON.stringify(existing, null, 2)}\n`);

  const withCosts = badges.filter((b) => b.tiers.every((t) => t.tokenCost !== null)).length;
  console.log(`Imported ${badges.length} badges into ${BADGES_PATH}`);
  console.log(`  Builder height range detected: ${fmt(fullRange.min)} - ${fmt(fullRange.max)}`);
  console.log(`  ${withCosts} badges have full token costs; ${badges.length - withCosts} do not.`);
  console.log(`  ${badges.filter((b) => b.restrictions).length} badges are height-restricted.`);
  console.log('\nRun `npm run data:validate` next.');
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
