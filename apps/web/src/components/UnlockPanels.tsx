import { capBreakerTableFor, formatHeight, meetsBody, type BuildEvaluation, type Dataset } from '@2k27/core';
import { BadgeLevelChip, Empty, GapPills, Panel, VerificationChip } from './Bits';

/** "6'5\" and up" / "up to 6'9\"" — the height band a badge is available in. */
function heightGate(r?: { minHeightInches?: number; maxHeightInches?: number }): string | null {
  if (!r) return null;
  if (r.minHeightInches !== undefined && r.maxHeightInches !== undefined)
    return `${formatHeight(r.minHeightInches)}–${formatHeight(r.maxHeightInches)}`;
  if (r.minHeightInches !== undefined) return `${formatHeight(r.minHeightInches)} and up`;
  if (r.maxHeightInches !== undefined) return `up to ${formatHeight(r.maxHeightInches)}`;
  return null;
}

/**
 * Badges this body can never hold at any rating. 25 of the 53 2K27 badges are
 * height-gated, so this is a real consequence of the height slider rather than
 * a rounding detail — and it is invisible unless the app says so.
 */
export function HeightLockedPanel({ dataset, build }: { dataset: Dataset; build: BuildEvaluation }) {
  const locked = dataset.badges.filter((b) => b.restrictions && !meetsBody(build.body, b.restrictions));
  if (locked.length === 0) return null;

  return (
    <Panel
      title="Locked by height"
      count={`${locked.length} of ${dataset.badges.length} badges`}
      collapsible
      defaultOpen={false}
    >
      <div className="row-note" style={{ marginBottom: 10 }}>
        At {formatHeight(build.body.heightInches)} these badges are unavailable at any rating. Changing
        height is the only way to get them.
      </div>
      <div className="tag-row">
        {locked.map((b) => (
          <span className="chip locked" key={b.id} title={`${b.category} · ${heightGate(b.restrictions)}`}>
            {b.name} · {heightGate(b.restrictions)}
          </span>
        ))}
      </div>
    </Panel>
  );
}

export function BadgePanel({ build }: { build: BuildEvaluation }) {
  const equipped = new Set(build.equippedBadges.map((b) => b.badgeId));
  return (
    <Panel
      title="Badges eligible"
      count={`${build.badges.length} eligible · ${build.equippedBadges.length} equipped`}
      collapsible
    >
      {build.badges.length === 0 ? (
        <Empty>No badge thresholds met yet.</Empty>
      ) : (
        <div className="row-list">
          {build.badges.map((b) => (
            <div className="row-item" key={b.badgeId}>
              <div className="row-main">
                <div className="row-title">
                  {b.name}
                  <BadgeLevelChip level={b.level} name={b.levelName} />
                  {equipped.has(b.badgeId) ? (
                    <span className="chip verified">equipped</span>
                  ) : (
                    <span className="chip locked" title="Eligible, but no tokens or slots left for it">
                      not equipped
                    </span>
                  )}
                  {b.boostedLevel && b.boostedLevel !== b.level && (
                    <span className="chip boosted" title="Reached with a badge boost slot">
                      boost → {b.boostedLevelName}
                    </span>
                  )}
                  <VerificationChip verification={b.verification} />
                </div>
                <div className="row-note">{b.category} · impact {b.impact}/5</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

export function NextBadgePanel({ build }: { build: BuildEvaluation }) {
  return (
    <Panel title="Next badge thresholds" count={`${build.nextBadges.length} reachable`} collapsible defaultOpen>
      {build.nextBadges.length === 0 ? (
        <Empty>Nothing else is reachable on this body.</Empty>
      ) : (
        <div className="row-list">
          {build.nextBadges.map((n) => (
            <div className="row-item" key={`${n.badgeId}:${n.nextLevel}`}>
              <div className="row-main">
                <div className="row-title">
                  {n.name}
                  <BadgeLevelChip level={n.nextLevel} name={n.nextLevelName} />
                  {n.currentLevel && <span className="row-note">from {n.currentLevel}</span>}
                  <VerificationChip verification={n.verification} />
                </div>
                <div className="row-note">
                  <GapPills gaps={n.gaps} />
                </div>
              </div>
              <div className="row-cost">
                {n.pointCost}
                <br />
                pts
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

export function AnimationPanel({ dataset, build }: { dataset: Dataset; build: BuildEvaluation }) {
  const byCategory = dataset.animationCategories.map((cat) => ({
    cat,
    unlocked: build.animations.filter((a) => a.category === cat.id),
    next: build.nextAnimations.filter((a) => a.category === cat.id),
  }));

  return (
    <Panel title="Animations" count={`${build.animations.length} available`}>
      {byCategory.map(({ cat, unlocked, next }) => (
        <div key={cat.id} style={{ marginBottom: 12 }}>
          <div className="attr-group-label">{cat.name}</div>
          {unlocked.length === 0 && next.length === 0 && <Empty>Nothing defined for this category.</Empty>}
          {unlocked.length > 0 && (
            <div className="tag-row" style={{ marginBottom: 6 }}>
              {unlocked.map((a) => (
                <span className="chip verified" key={a.animationId} title={`Impact ${a.impact}/5`}>
                  {a.name}
                </span>
              ))}
            </div>
          )}
          {next.slice(0, 3).map((n) => (
            <div className="row-note" key={n.animationId} style={{ marginTop: 3 }}>
              <span style={{ color: 'var(--text-faint)' }}>locked:</span> {n.name}{' '}
              {n.bodyBlocked ? (
                <span style={{ color: 'var(--warn)' }}>— {n.bodyBlockReason ?? 'wrong body'}</span>
              ) : (
                <>
                  <GapPills gaps={n.gaps} />
                  <span className="row-cost" style={{ display: 'inline' }}>
                    {Number.isFinite(n.pointCost) ? `${n.pointCost} pts` : 'unreachable'}
                  </span>
                </>
              )}
            </div>
          ))}
        </div>
      ))}
    </Panel>
  );
}

export function TakeoverPanel({ build }: { build: BuildEvaluation }) {
  const unlocked = build.takeovers.filter((t) => t.unlockedTierIds.length > 0);
  const locked = build.takeovers.filter((t) => t.unlockedTierIds.length === 0);

  return (
    <Panel title="Takeovers" count={`${unlocked.length}/${build.takeovers.length}`} collapsible>
      {unlocked.length === 0 && <Empty>No takeover requirements met.</Empty>}
      <div className="row-list">
        {unlocked.map((t) => (
          <div className="row-item" key={t.takeoverId}>
            <div className="row-main">
              <div className="row-title">
                {t.name}
                <span className="chip verified">{t.highestTierName}</span>
                <VerificationChip verification={t.verification} />
              </div>
              {t.nextTier && (
                <div className="row-note">
                  next: {t.nextTier.name} — <GapPills gaps={t.nextTier.gaps} />
                </div>
              )}
            </div>
            {t.nextTier && <div className="row-cost">{t.nextTier.pointCost} pts</div>}
          </div>
        ))}
        {locked.map((t) => (
          <div className="row-item" key={t.takeoverId} style={{ opacity: 0.6 }}>
            <div className="row-main">
              <div className="row-title" style={{ fontWeight: 500 }}>
                {t.name}
              </div>
              {t.nextTier && (
                <div className="row-note">
                  <GapPills gaps={t.nextTier.gaps} />
                </div>
              )}
            </div>
            {t.nextTier && <div className="row-cost">{t.nextTier.pointCost} pts</div>}
          </div>
        ))}
      </div>
    </Panel>
  );
}

export function CapBreakerPanel({ dataset, build }: { dataset: Dataset; build: BuildEvaluation }) {
  const cb = dataset.capBreakers;
  const used = build.capBreakerPlan.reduce((a, r) => a + r.breakersUsed, 0);
  const table = capBreakerTableFor(dataset, build.body);

  if (!cb.enabled) {
    return (
      <Panel title="Cap breakers">
        <Empty>Cap breakers are disabled in this dataset.</Empty>
      </Panel>
    );
  }

  // A body nobody has transcribed gets no plan at all: gains run from +1 to +7
  // between attributes on the one frame we have, so there is nothing safe to
  // extrapolate. Say that plainly instead of showing an empty list.
  if (!table) {
    return (
      <Panel title="Cap breakers" right={<VerificationChip verification={cb.verification} />}>
        <Empty>
          No cap breaker table for this body yet. Each slot is worth a different amount on every
          attribute — +7 Steal but +1 Close Shot on the one build that has been read off the NBA 2K HQ
          app — so nothing is extrapolated to bodies that have not been transcribed.
        </Empty>
        <div className="row-note" style={{ marginTop: 10 }}>
          {Object.keys(cb.gainTables.entries).length} body
          {Object.keys(cb.gainTables.entries).length === 1 ? '' : ' types'} transcribed so far.
        </div>
      </Panel>
    );
  }

  const locked = Object.entries(table.attributes)
    .filter(([, row]) => row.slots[0] === null || row.slots[0] === undefined)
    .map(([id]) => dataset.attributes.find((a) => a.id === id)?.name ?? id);

  const poolNote =
    cb.allocation.mode === 'shared-pool'
      ? `${cb.allocation.poolSize} to place across all attributes`
      : 'every attribute fills its own slots';

  return (
    <Panel
      title="Cap breakers"
      count={`${used}/${cb.allocation.poolSize} placed`}
      right={<VerificationChip verification={cb.verification} />}
    >
      <div className="row-note" style={{ marginBottom: 10 }}>
        {cb.slotsPerAttribute} slots per attribute · {poolNote} · ceiling {cb.absoluteCeiling}.
        {table.label ? ` Table: ${table.label}.` : ''}
      </div>

      {build.capBreakerPlan.length === 0 ? (
        <Empty>
          Nothing to place: no attribute is sitting at its cap with an unlocked slot and a threshold
          within reach.
        </Empty>
      ) : (
        <div className="row-list">
          {build.capBreakerPlan.map((r) => {
            const row = table.attributes[r.attribute];
            return (
              <div className="row-item" key={r.attribute}>
                <div className="row-main">
                  <div className="row-title">
                    {r.attributeName} {r.from} → <span style={{ color: 'var(--good)' }}>{r.to}</span>
                    <span className="chip verified">
                      {r.breakersUsed} slot{r.breakersUsed === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div className="row-note">{r.reason}</div>
                  {row && (
                    <div className="row-note">
                      Slots: {row.slots.map((s) => (s === null ? '🔒' : `+${s}`)).join(' · ')} · max{' '}
                      {row.newCap}
                    </div>
                  )}
                </div>
                <div className="row-cost">+{r.scoreGain.toFixed(1)}</div>
              </div>
            );
          })}
        </div>
      )}

      {build.capBreakersRemaining > 0 && (
        <div className="row-note severity-info" style={{ marginTop: 10 }}>
          {build.capBreakersRemaining} breaker{build.capBreakersRemaining === 1 ? '' : 's'} left with no
          threshold worth crossing. The optimizer will not invent a placement for them.
        </div>
      )}

      {locked.length > 0 && (
        <div className="row-note" style={{ marginTop: 10 }}>
          No cap breaker can raise {locked.join(', ')} on this frame — every slot is locked.
        </div>
      )}

      <div className="row-note severity-info" style={{ marginTop: 10 }}>
        The gain table above is read straight off the builder and is exact. How many of those gains a
        player may actually claim is <strong>not published</strong> — the app assumes the conservative
        reading, {cb.allocation.poolSize} to share across every attribute. If the generous reading is
        right and each attribute fills its own slots, this frame gains far more than shown.
      </div>
    </Panel>
  );
}

export function BadgeBoostPanel({ dataset, build }: { dataset: Dataset; build: BuildEvaluation }) {
  const cfg = dataset.badgeBoosts;
  if (!cfg.enabled) {
    return (
      <Panel title="Badge boosts">
        <Empty>Badge boosts are disabled in this dataset.</Empty>
      </Panel>
    );
  }

  return (
    <Panel
      title="Badge boosts (+1 / +2)"
      count={`${build.badgeBoostPlan.length} placed`}
      right={<VerificationChip verification={cfg.verification} />}
    >
      <div className="row-note" style={{ marginBottom: 10 }}>
        {cfg.plusTwo.slots} × +2 slot{cfg.plusTwo.slots === 1 ? '' : 's'} · {cfg.plusOne.slots} × +1 slot
        {cfg.plusOne.slots === 1 ? '' : 's'} · {cfg.rules.canBoostToLegend ? 'can reach Legend' : 'cannot reach Legend'}.
      </div>
      {build.badgeBoostPlan.length === 0 ? (
        <Empty>No badge is worth a boost slot on this build.</Empty>
      ) : (
        <div className="row-list">
          {build.badgeBoostPlan.map((b) => (
            <div className="row-item" key={`${b.slot}:${b.badgeId}`}>
              <div className="row-main">
                <div className="row-title">
                  <span className="chip verified">{b.slot === 'plusTwo' ? '+2' : '+1'}</span>
                  {b.badgeName}
                  <BadgeLevelChip level={b.toLevel} name={`${b.fromLevelName} → ${b.toLevelName}`} />
                </div>
                <div className="row-note">{b.reason}</div>
              </div>
              <div className="row-cost">+{b.scoreGain.toFixed(1)}</div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

export function WastePanel({ build }: { build: BuildEvaluation }) {
  const total = build.waste.reduce((a, w) => a + w.refundableBuildPoints, 0);
  const hasWarnings = build.dependencyWarnings.length > 0;

  return (
    <Panel
      title="Inefficient or wasted points"
      count={total > 0 ? `${total} pts recoverable` : 'clean'}
    >
      {build.waste.length === 0 && !hasWarnings && (
        <Empty>
          No rating sits above the last threshold it unlocked, and no attribute is running ahead of what
          supports it.
        </Empty>
      )}

      {build.waste.map((w) => (
        <div className={`row-note severity-${w.severity}`} key={w.attribute} style={{ marginBottom: 9 }}>
          {w.message}
        </div>
      ))}

      {hasWarnings && (
        <>
          <div className="attr-group-label" style={{ marginTop: 14 }}>
            Attribute dependencies
          </div>
          {build.dependencyWarnings.map((d) => (
            <div className={`row-note severity-${d.severity}`} key={d.ruleId} style={{ marginBottom: 8 }}>
              {d.message}
            </div>
          ))}
        </>
      )}

      {Number.isFinite(build.remaining) && build.remaining > 0 && (
        <div className="row-note severity-warning" style={{ marginTop: 10 }}>
          {build.remaining} build points are unspent. The optimizer left them because nothing reachable
          was worth buying — check the next-threshold panels for what they could go toward.
        </div>
      )}
    </Panel>
  );
}
