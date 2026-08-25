import { loadDatasetFromDisk } from '../data/node-loader.js';
import { verificationReport } from '../data/loader.js';
import { datasetCoverage } from '../data/coverage.js';

/**
 * `npm run data:report` — how much of the dataset is still placeholder.
 * Use it to track progress as verified NBA 2K27 data replaces the scaffolding.
 */
const datasetId = process.argv[2] ?? '2k27';
const { dataset } = loadDatasetFromDisk(datasetId);
const report = verificationReport(dataset);

console.log(`\n${dataset.meta.gameTitle} — data verification report`);
console.log('='.repeat(60));
console.log(dataset.meta.provenance.headline);
console.log('');

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
console.log(`Records tracked: ${report.totalRecords}`);
for (const [status, count] of Object.entries(report.byStatus).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${status.padEnd(20)} ${String(count).padStart(4)}  ${pct(count / report.totalRecords)}`);
}
console.log('');
console.log(`Unverified or estimated: ${pct(report.unverifiedShare)}`);
console.log('');
console.log('By file:');
for (const f of report.byFile.sort((a, b) => b.unverified - a.unverified)) {
  const bar = '#'.repeat(Math.round((f.total === 0 ? 0 : f.unverified / f.total) * 20)).padEnd(20, '.');
  console.log(`  ${f.file.padEnd(22)} ${bar} ${f.unverified}/${f.total} unverified`);
}

// Coverage matters as much as verification: an attribute nothing gates on is
// invisible to the optimizer, so builds will look wrong until it is filled in.
const coverage = datasetCoverage(dataset);
console.log('\nThreshold coverage (badge tiers + animations + takeover tiers per attribute):');
for (const a of coverage.attributes) {
  const flag = a.total === 0 ? '  <-- NOTHING REQUIRES THIS; the optimizer will never buy it' : a.total <= 2 ? '  <-- thin' : '';
  const range = a.lowestThreshold === null ? '' : ` [${a.lowestThreshold}-${a.highestThreshold}]`;
  console.log(`  ${a.attributeName.padEnd(20)} ${String(a.total).padStart(3)}${range.padEnd(10)}${flag}`);
}
console.log('');
