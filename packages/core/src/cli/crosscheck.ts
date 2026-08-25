import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { findDataRoot, loadDatasetFromDisk } from '../data/node-loader.js';
import { crossCheckBadges, type SecondSource } from '../data/crosscheck.js';

/**
 * `npm run data:crosscheck` — diff the dataset against every independent source
 * in data/<id>/sources/. Exits non-zero if any disagreement is not recorded in
 * that source's `knownConflicts`.
 */
const datasetId = process.argv[2] ?? '2k27';
const { dataset } = loadDatasetFromDisk(datasetId);
const dir = join(findDataRoot(), datasetId, 'sources');

if (!existsSync(dir)) {
  console.log(`No second sources in ${dir}. Nothing to cross-check.`);
  process.exit(0);
}

const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
if (files.length === 0) {
  console.log(`No second sources in ${dir}. Nothing to cross-check.`);
  process.exit(0);
}

let failed = false;

for (const file of files) {
  const source = JSON.parse(readFileSync(join(dir, file), 'utf8')) as SecondSource;
  const report = crossCheckBadges(dataset, source);

  console.log(`\n${source.sourceName}`);
  console.log('='.repeat(Math.max(20, source.sourceName.length)));
  console.log(`Retrieved ${report.retrieved} · covers ${source.covers.join(', ')}`);
  if (source.doesNotCover?.length) console.log(`Does not cover: ${source.doesNotCover.join(', ')}`);
  console.log(
    `\n${report.badgesInBoth} badges in both · ${report.tiersCompared} tiers compared · ${(report.agreementRate * 100).toFixed(1)}% agreement`
  );

  if (report.onlyInDataset.length) console.log(`  Only in dataset: ${report.onlyInDataset.join(', ')}`);
  if (report.onlyInSource.length) console.log(`  Only in source:  ${report.onlyInSource.join(', ')}`);

  if (report.conflicts.length === 0) {
    console.log('\n  No disagreements. Both sources describe the same badges identically.');
    continue;
  }

  console.log(`\n  ${report.conflicts.length} disagreement(s):`);
  for (const c of report.conflicts) {
    const mark = c.documented ? 'known' : 'NEW  ';
    console.log(`   [${mark}] ${c.badge} · ${c.field}`);
    console.log(`            dataset: ${c.dataset}`);
    console.log(`            source:  ${c.source}`);
    if (c.note) console.log(`            note:    ${c.note}`);
  }

  if (report.undocumentedConflicts.length > 0) {
    failed = true;
    console.error(
      `\n  ${report.undocumentedConflicts.length} disagreement(s) are NOT recorded in this source's knownConflicts.`
    );
    console.error('  Either fix the dataset, or add the conflict with a note explaining which side you trust.');
  }
}

if (failed) process.exit(1);
console.log('\nEvery disagreement is accounted for.');
