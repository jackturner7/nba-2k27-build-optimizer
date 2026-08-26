import { loadDatasetFromDisk } from '../data/node-loader.js';

/**
 * `npm run data:validate` — run this after editing anything in /data.
 * Exits non-zero on a structural error so it can gate a commit.
 */
const datasetId = process.argv[2] ?? '2k27';

try {
  const { dataset, issues } = loadDatasetFromDisk(datasetId);
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');

  console.log(`Dataset: ${dataset.meta.gameTitle} (${dataset.meta.datasetId} v${dataset.meta.datasetVersion})`);
  console.log(`Attributes: ${dataset.attributes.length}  Badges: ${dataset.badges.length}  Animations: ${dataset.animations.length}  Takeovers: ${dataset.takeovers.length}  Archetypes: ${dataset.archetypes.length}`);

  for (const w of warnings) console.warn(`  warning  ${w.file}: ${w.message}`);
  for (const e of errors) console.error(`  ERROR    ${e.file}: ${e.message}`);

  if (errors.length > 0) {
    console.error(`\n${errors.length} error(s). Fix these before the optimizer will produce trustworthy builds.`);
    process.exit(1);
  }
  console.log(`\nNo structural errors${warnings.length ? ` (${warnings.length} warning(s))` : ''}.`);
} catch (e) {
  console.error(`Failed to load dataset "${datasetId}":`);
  console.error((e as Error).message);
  process.exit(1);
}
