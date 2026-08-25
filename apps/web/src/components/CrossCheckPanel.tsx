import type { CrossCheckReport } from '@2k27/core';
import { Empty, Panel } from './Bits';

/**
 * How the shipped badge data holds up against independently-produced sources.
 *
 * Two sources agreeing on a threshold is far stronger evidence than one, and
 * where they disagree the honest thing is to show both rather than quietly
 * pick a winner — so this panel reports the agreement rate and names every
 * conflict, with which side the dataset follows.
 */
export function CrossCheckPanel({ reports }: { reports: CrossCheckReport[] }) {
  if (reports.length === 0) return null;

  const totalConflicts = reports.reduce((a, r) => a + r.conflicts.length, 0);
  const worstAgreement = Math.min(...reports.map((r) => r.agreementRate));

  return (
    <Panel
      title="Source cross-check"
      count={`${(worstAgreement * 100).toFixed(1)}% agreement`}
      collapsible
      defaultOpen={totalConflicts > 0}
    >
      {reports.map((r) => (
        <div key={r.sourceName} style={{ marginBottom: 14 }}>
          <div className="row-title" style={{ marginBottom: 4 }}>
            {r.sourceName}
            <span className="chip verified">{r.badgesInBoth} badges</span>
            <span className="chip token">{r.tiersCompared} tiers compared</span>
          </div>

          {r.conflicts.length === 0 ? (
            <div className="row-note" style={{ color: 'var(--good)' }}>
              Every badge requirement and height gate matches. Two independently-produced sources
              describing the same data identically is the strongest evidence this dataset has.
            </div>
          ) : (
            <>
              <div className="row-note" style={{ marginBottom: 8 }}>
                {r.conflicts.length} disagreement{r.conflicts.length === 1 ? '' : 's'} out of{' '}
                {r.tiersCompared} tiers compared.
              </div>
              {r.conflicts.map((c) => (
                <div
                  className={`row-note severity-${c.documented ? 'warning' : 'critical'}`}
                  key={`${c.badge}:${c.field}`}
                  style={{ marginBottom: 8 }}
                >
                  <b>
                    {c.badge} · {c.field}
                  </b>
                  <br />
                  This dataset uses <code>{c.dataset}</code>; the other source says{' '}
                  <code>{c.source}</code>.
                  {c.note && (
                    <>
                      <br />
                      {c.note}
                    </>
                  )}
                  {!c.documented && (
                    <>
                      <br />
                      <b>Not yet reviewed.</b>
                    </>
                  )}
                </div>
              ))}
            </>
          )}

          {r.onlyInDataset.length > 0 && (
            <div className="row-note" style={{ marginTop: 6 }}>
              Not covered by this source: {r.onlyInDataset.join(', ')}.
            </div>
          )}
          {r.onlyInSource.length > 0 && (
            <div className="row-note severity-warning" style={{ marginTop: 6 }}>
              In the source but missing from the dataset: {r.onlyInSource.join(', ')}.
            </div>
          )}
        </div>
      ))}

      {reports.every((r) => r.conflicts.length === 0) && (
        <Empty>Nothing to reconcile.</Empty>
      )}
    </Panel>
  );
}
