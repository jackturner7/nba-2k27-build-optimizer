import { formatHeight, type Dataset, type OptimizedBuild, type OptimizeRequest } from '@2k27/core';
import { AttributeTable } from './AttributeTable';
import { Panel } from './Bits';
import { BadgeLoadoutPanel, TokenPanel } from './TokenPanel';
import {
  AnimationPanel,
  BadgeBoostPanel,
  BadgePanel,
  CapBreakerPanel,
  HeightLockedPanel,
  NextBadgePanel,
  TakeoverPanel,
  WastePanel,
} from './UnlockPanels';

const SCORE_LABELS: { key: keyof OptimizedBuild['score']['components']; label: string }[] = [
  { key: 'badgeValue', label: '1. Badge value' },
  { key: 'animationUnlocks', label: '2. Animation unlocks' },
  { key: 'attributeEfficiency', label: '3. Attribute efficiency' },
  { key: 'defensiveVersatility', label: '4. Defensive versatility' },
  { key: 'shooting', label: '5. Shooting' },
  { key: 'finishing', label: '6. Finishing' },
  { key: 'playmaking', label: '7. Playmaking' },
  { key: 'physicals', label: '8. Physicals' },
  { key: 'wastedPoints', label: '9. Wasted points' },
];

export function BuildCard({
  dataset,
  build,
  request,
  tokenOverrides,
  onTokenOverrideChange,
}: {
  dataset: Dataset;
  build: OptimizedBuild;
  request?: OptimizeRequest;
  tokenOverrides?: Record<string, number | null>;
  onTokenOverrideChange?: (next: Record<string, number | null>) => void;
}) {
  const wasted = build.waste.reduce((a, w) => a + w.refundableBuildPoints, 0);
  const spendPct = Number.isFinite(build.budget) ? Math.round((build.spent / build.budget) * 100) : 100;

  return (
    <div className="column">
      <Panel title={build.label} right={`score ${build.score.total.toFixed(1)}`}>
        <div className="summary-grid">
          <div className="summary-cell">
            <div className="k">Build</div>
            <div className="v" style={{ fontSize: 14 }}>
              {build.body.position} · {formatHeight(build.body.heightInches)}
            </div>
          </div>
          <div className="summary-cell">
            <div className="k">Points spent</div>
            <div className="v">
              {build.spent}
              <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>
                {' '}
                / {Number.isFinite(build.budget) ? build.budget : '∞'} ({spendPct}%)
              </span>
            </div>
          </div>
          <div className="summary-cell">
            <div className="k">Badges equipped</div>
            <div className="v good">
              {build.equippedBadges.length}
              <span style={{ fontSize: 12, color: 'var(--text-faint)' }}> / {build.badges.length} eligible</span>
            </div>
          </div>
          <div className="summary-cell">
            <div className="k">Badge slots</div>
            <div className="v">
              {build.tokens.totalSlotsUsed}
              <span style={{ fontSize: 12, color: 'var(--text-faint)' }}> / {build.tokens.totalSlots}</span>
            </div>
          </div>
          <div className="summary-cell">
            <div className="k">Animations</div>
            <div className="v">{build.animations.length}</div>
          </div>
          <div className="summary-cell">
            <div className="k">Takeovers</div>
            <div className="v">{build.takeovers.filter((t) => t.unlockedTierIds.length > 0).length}</div>
          </div>
          <div className="summary-cell">
            <div className="k">Wasted points</div>
            <div className={`v ${wasted > 0 ? 'warn' : 'good'}`}>{wasted}</div>
          </div>
        </div>

        {build.tradeoffs.length > 0 && (
          <>
            <div className="attr-group-label" style={{ marginTop: 16 }}>
              Tradeoffs
            </div>
            <ul className="note-list">
              {build.tradeoffs.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </>
        )}
      </Panel>

      <Panel title="Optimization score" right={`total ${build.score.total.toFixed(1)}`} collapsible>
        {SCORE_LABELS.map(({ key, label }) => {
          const raw = build.score.components[key];
          const weighted = build.score.weighted[key];
          const negative = raw < 0;
          const width = Math.min(100, Math.abs(raw));
          return (
            <div className="score-row" key={key}>
              <div className="score-label">{label}</div>
              <div className="score-bar">
                <div className={negative ? 'neg' : 'pos'} style={{ width: `${width}%` }} />
              </div>
              <div className="score-nums">
                <b>{raw.toFixed(1)}</b> → {weighted.toFixed(1)}
              </div>
            </div>
          );
        })}
        <div className="field-hint" style={{ marginTop: 10 }}>
          Left number is the raw component (0–100, negative for waste); right is after your weightings
          and how much you prioritised that area. The total is the sum of the weighted column.
        </div>
      </Panel>

      <AttributeTable
        dataset={dataset}
        body={build.body}
        attributes={build.attributes}
        caps={build.caps}
        request={request}
        effectiveAttributes={build.effectiveAttributes}
      />

      <BadgeLoadoutPanel dataset={dataset} build={build} />
      <TokenPanel dataset={dataset} build={build} overrides={tokenOverrides ?? {}} onOverrideChange={onTokenOverrideChange} />
      <BadgePanel build={build} />
      <HeightLockedPanel dataset={dataset} build={build} />
      <NextBadgePanel build={build} />
      <AnimationPanel dataset={dataset} build={build} />
      <TakeoverPanel build={build} />
      <CapBreakerPanel dataset={dataset} build={build} />
      <BadgeBoostPanel dataset={dataset} build={build} />
      <WastePanel build={build} />

      <Panel title="Why each rating stopped where it did" collapsible defaultOpen={false}>
        <div className="row-list">
          {build.rationale.map((r) => (
            <div className="row-item" key={r.attribute}>
              <div className="row-main">
                <div className="row-title">
                  {r.attributeName} <span style={{ color: 'var(--accent)' }}>{r.value}</span>
                </div>
                <div className="row-note">{r.reason}</div>
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
