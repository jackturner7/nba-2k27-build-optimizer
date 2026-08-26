import type { Dataset } from '@2k27/core';
import type { DataIssue, VerificationReport } from '../lib/api';

/**
 * The most important component in the app. The dataset is placeholder data and
 * the user must not be able to forget that while reading a build.
 */
export function DataBanner({
  dataset,
  verification,
  issues,
  onReload,
  reloading,
}: {
  dataset: Dataset;
  verification: VerificationReport;
  issues: DataIssue[];
  onReload: () => void;
  reloading: boolean;
}) {
  const errors = issues.filter((i) => i.severity === 'error');
  const unverifiedPct = Math.round(verification.unverifiedShare * 100);

  return (
    <>
      <div className="banner">
        <span className="icon">⚠️</span>
        <div style={{ flex: 1 }}>
          <strong>{dataset.meta.provenance.headline}</strong>
          <p>{dataset.meta.uiWarnings.globalBanner}</p>
        </div>
        <div className="banner-stats">
          <div>
            {unverifiedPct}% unverified · {verification.totalRecords} records
          </div>
          <div>
            {dataset.meta.datasetId} v{dataset.meta.datasetVersion}
          </div>
          <button className="btn small" style={{ marginTop: 6 }} onClick={onReload} disabled={reloading}>
            {reloading ? <span className="spinner" /> : 'Reload data'}
          </button>
        </div>
      </div>

      {dataset.budget.actualMechanic && (
        <div className="banner">
          <span className="icon">📏</span>
          <div style={{ flex: 1 }}>
            <strong>Point costs are a ranking, not a quantity.</strong>
            <p>
              The real 2K27 builder has no point pool — it asks you to{' '}
              <em>{dataset.budget.actualMechanic.uiText}</em>, so an attribute point really costs its
              weight in the per-position Overall formula. Those weights are unpublished, so this app
              substitutes an invented pool of the same shape. Trust which upgrades it calls cheap;
              do not trust the numbers next to them.
            </p>
          </div>
        </div>
      )}

      {errors.length > 0 && (
        <div className="banner error">
          <span className="icon">⛔</span>
          <div>
            <strong>
              {errors.length} structural error{errors.length === 1 ? '' : 's'} in the dataset
            </strong>
            <p>
              {errors.slice(0, 3).map((e) => (
                <span key={e.message} style={{ display: 'block' }}>
                  <code>{e.file}</code> — {e.message}
                </span>
              ))}
              {errors.length > 3 && <span>…and {errors.length - 3} more. Run <code>npm run data:validate</code>.</span>}
            </p>
          </div>
        </div>
      )}
    </>
  );
}
