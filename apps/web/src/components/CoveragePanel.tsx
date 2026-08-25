import type { CoverageReport, Dataset } from '@2k27/core';
import { Empty, Panel } from './Bits';

/**
 * Explains why some attributes never get bought.
 *
 * The engine only spends points that cross a threshold, so an attribute no
 * badge, animation or takeover asks for will sit at the floor in every build.
 * That is the data being incomplete, not the optimizer misbehaving, and the
 * honest fix is to add the real requirements — not to invent one here.
 */
export function CoveragePanel({ dataset, coverage }: { dataset: Dataset; coverage: CoverageReport }) {
  const { uncovered, thin } = coverage;
  const total = uncovered.length + thin.length;

  return (
    <Panel
      title="Dataset coverage gaps"
      count={total === 0 ? 'complete' : `${total} attribute${total === 1 ? '' : 's'}`}
      collapsible
      defaultOpen={uncovered.length > 0}
    >
      {total === 0 ? (
        <Empty>Every attribute is gated by at least three badges, animations or takeovers.</Empty>
      ) : (
        <>
          {uncovered.length > 0 && (
            <>
              <div className="row-note severity-critical" style={{ marginBottom: 10 }}>
                Nothing in the dataset requires{' '}
                <b>{uncovered.map((u) => u.attributeName).join(', ')}</b>. The optimizer has no reason to
                buy {uncovered.length === 1 ? 'it' : 'them'} and will leave{' '}
                {uncovered.length === 1 ? 'it' : 'them'} at {dataset.ratingFloor} in every build. Add the
                real NBA 2K27 badges, animations or takeovers that depend on{' '}
                {uncovered.length === 1 ? 'this attribute' : 'these attributes'} and the builds will
                change on their own.
              </div>
            </>
          )}

          {thin.length > 0 && (
            <div className="row-note severity-warning" style={{ marginBottom: 10 }}>
              Thinly covered (one or two requirements each):{' '}
              <b>{thin.map((t) => t.attributeName).join(', ')}</b>. Builds will treat these as almost
              worthless until more of the real requirement data is filled in.
            </div>
          )}

          <div className="attr-group-label">Requirements referencing each attribute</div>
          <div className="row-list">
            {coverage.attributes.slice(0, 10).map((a) => (
              <div className="row-item" key={a.attribute}>
                <div className="row-main">
                  <div className="row-title" style={{ fontWeight: 500 }}>
                    {a.attributeName}
                  </div>
                  <div className="row-note">
                    {a.badgeTiers} badge tiers · {a.animations} animations · {a.takeoverTiers} takeover tiers
                    {a.lowestThreshold !== null && (
                      <> · range {a.lowestThreshold}–{a.highestThreshold}</>
                    )}
                  </div>
                </div>
                <div className="row-cost">{a.total}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </Panel>
  );
}
