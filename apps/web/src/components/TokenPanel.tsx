import type { BuildEvaluation, Dataset } from '@2k27/core';
import { BadgeLevelChip, Empty, Panel, VerificationChip } from './Bits';

/**
 * The 2K27 badge token economy.
 *
 * Meeting an attribute threshold only makes a badge ELIGIBLE. Equipping it costs
 * badge tokens, earned per discipline by investing in that discipline, and it
 * has to fit in that discipline's badge slots. A build can be eligible for far
 * more badges than it can afford, so this panel is where the real cost of a
 * threshold shows up.
 */
export function BadgeLoadoutPanel({ dataset, build }: { dataset: Dataset; build: BuildEvaluation }) {
  const eligibleCount = build.badges.length;
  const equippedCount = build.equippedBadges.length;

  return (
    <Panel
      title="Badge loadout"
      count={`${equippedCount} equipped of ${eligibleCount} eligible`}
      right={<VerificationChip verification={dataset.badgeTokens.verification} />}
    >
      {equippedCount === 0 ? (
        <Empty>
          No badges could be equipped. Either the attributes do not reach any threshold, or there are no
          tokens to spend.
        </Empty>
      ) : (
        <div className="row-list">
          {build.equippedBadges.map((b) => (
            <div className="row-item" key={b.badgeId}>
              <div className="row-main">
                <div className="row-title">
                  {b.name}
                  <BadgeLevelChip level={b.level} name={b.levelName} />
                  <span className="chip token" title={b.tokenCostInferred ? 'Estimated price — this badge has no sourced token cost' : 'Sourced token cost'}>
                    {b.tokenCost} tokens{b.tokenCostInferred ? '*' : ''}
                  </span>
                  {b.boostedLevel && b.boostedLevel !== b.level && (
                    <span className="chip boosted" title="Reached with a badge boost slot">
                      boost → {b.boostedLevelName}
                    </span>
                  )}
                </div>
                <div className="row-note">
                  {b.category} · impact {b.impact}/5
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {build.tokens.inferredCostBadges.length > 0 && (
        <div className="row-note severity-warning" style={{ marginTop: 12 }}>
          <b>*</b> Estimated price. NBA 2K Lab publishes requirements but not token costs, and the
          Rebounding and Physicals cost charts have not been added, so{' '}
          <b>{build.tokens.inferredCostBadges.join(', ')}</b> are priced from the pattern the 42
          badges with known costs follow. Their requirements are real; their prices are not.
        </div>
      )}

      <div className="field-hint" style={{ marginTop: 12 }}>
        In 2K27 badges are bought, not granted. Hitting a threshold makes a badge eligible; tokens and
        slots decide whether you actually get it.
      </div>
    </Panel>
  );
}

export function TokenPanel({
  dataset,
  build,
  overrides,
  onOverrideChange,
}: {
  dataset: Dataset;
  build: BuildEvaluation;
  overrides: Record<string, number | null>;
  onOverrideChange?: (next: Record<string, number | null>) => void;
}) {
  const { tokens } = build;

  return (
    <Panel
      title="Badge tokens & slots"
      count={`${tokens.totalSlotsUsed}/${tokens.totalSlots} slots`}
      right={<VerificationChip verification={dataset.badgeTokens.tokenGrants.verification} />}
    >
      <div className="row-note severity-warning" style={{ marginBottom: 12 }}>
        The token-earning formula is a placeholder. Only the direction — more investment in a
        discipline earns more of its tokens — is sourced. If you can read your real token counts off
        the in-game builder, type them in below and the optimizer will plan against those instead.
      </div>

      {tokens.byDiscipline.map((d) => {
        const override = overrides[d.discipline];
        return (
          <div key={d.discipline}>
            <div className="token-row">
              <div className="token-label">{d.discipline}</div>
              <div className="token-slots" title={`${d.slotsUsed} of ${d.slots} badge slots used`}>
                {Array.from({ length: d.slots }, (_, i) => (
                  <i key={i} className={i < d.slotsUsed ? 'filled' : ''} />
                ))}
                {d.slots === 0 && <span className="field-hint">no slots</span>}
              </div>
              <div className="token-nums">
                <b>{d.spent}</b>/{Number.isFinite(d.earned) ? d.earned : '∞'} tokens
              </div>
            </div>
            {onOverrideChange && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '0 0 8px 110px' }}>
                <input
                  className="token-input"
                  style={{ width: 90 }}
                  type="number"
                  min={0}
                  placeholder="auto"
                  value={override ?? ''}
                  onChange={(e) => {
                    const raw = e.target.value.trim();
                    onOverrideChange({
                      ...overrides,
                      [d.discipline]: raw === '' ? null : Math.max(0, Number(raw)),
                    });
                  }}
                  title={`Real ${d.discipline} token count from the game; leave blank to estimate`}
                />
                {d.remaining > 0 && Number.isFinite(d.remaining) && (
                  <span className="field-hint">{d.remaining} unspent</span>
                )}
              </div>
            )}
          </div>
        );
      })}

      {tokens.unpricedBadges.length > 0 && (
        <div className="row-note severity-critical" style={{ marginTop: 12 }}>
          No token cost is known for <b>{tokens.unpricedBadges.join(', ')}</b>, so they cannot be
          planned or equipped. Add the missing badge cost charts, or turn on
          <code> fallbackTokenCost </code> in <code>badge-tokens.json</code> to price them by pattern.
        </div>
      )}

      <MissedBadges build={build} />
    </Panel>
  );
}

function MissedBadges({ build }: { build: BuildEvaluation }) {
  const missed = build.tokens.byDiscipline.flatMap((d) =>
    d.unaffordable.map((u) => ({ ...u, discipline: d.discipline }))
  );
  if (missed.length === 0) return null;

  return (
    <>
      <div className="attr-group-label" style={{ marginTop: 16 }}>
        Eligible but not equipped ({missed.length})
      </div>
      <div className="row-list">
        {missed.slice(0, 12).map((m) => (
          <div className="row-item" key={`${m.badgeId}:${m.level}`}>
            <div className="row-main">
              <div className="row-title" style={{ fontWeight: 500 }}>
                {m.name}
                <span className="chip locked">{m.levelName}</span>
                {m.tokenCost !== null && <span className="chip token">{m.tokenCost}t</span>}
              </div>
              <div className="row-note">{m.reason}</div>
            </div>
          </div>
        ))}
      </div>
      {missed.length > 12 && (
        <div className="field-hint" style={{ marginTop: 6 }}>
          …and {missed.length - 12} more.
        </div>
      )}
    </>
  );
}
