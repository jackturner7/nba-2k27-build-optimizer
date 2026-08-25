import { useMemo } from 'react';
import {
  collectBreakpoints,
  type AttributeVector,
  type BuildBody,
  type Dataset,
  type OptimizeRequest,
} from '@2k27/core';
import { Panel } from './Bits';

const CATEGORY_VAR: Record<string, string> = {
  finishing: 'var(--cat-finishing)',
  shooting: 'var(--cat-shooting)',
  playmaking: 'var(--cat-playmaking)',
  defense: 'var(--cat-defense)',
  physicals: 'var(--cat-physicals)',
};

/**
 * Attribute bars with the threshold map drawn straight onto the track. The
 * ticks are the whole point: they show at a glance that a rating is parked on a
 * badge threshold rather than one point past it.
 */
export function AttributeTable({
  dataset,
  body,
  attributes,
  caps,
  request,
  effectiveAttributes,
}: {
  dataset: Dataset;
  body: BuildBody;
  attributes: AttributeVector;
  caps: AttributeVector;
  request?: Pick<OptimizeRequest, 'minimums' | 'softTargets' | 'maximums'>;
  effectiveAttributes?: AttributeVector;
}) {
  const breakpoints = useMemo(
    () => collectBreakpoints(dataset, body, caps, request ?? {}),
    [dataset, body, caps, request]
  );

  const floor = dataset.ratingFloor;
  const ceiling = dataset.ratingCeiling;
  const pct = (v: number) => ((v - floor) / (ceiling - floor)) * 100;

  return (
    <Panel title="Attributes" count={`${dataset.attributes.length} attributes`}>
      {dataset.categories.map((cat) => {
        const attrs = dataset.attributes.filter((a) => a.category === cat.id);
        if (attrs.length === 0) return null;
        return (
          <div key={cat.id}>
            <div className="attr-group-label">{cat.name}</div>
            {attrs.map((a) => {
              const value = attributes[a.id] ?? floor;
              const cap = caps[a.id] ?? ceiling;
              const boosted = effectiveAttributes?.[a.id];
              const bps = breakpoints[a.id] ?? [];
              const color = CATEGORY_VAR[cat.id] ?? 'var(--accent)';
              const atCap = value >= cap;
              const atFloor = value <= floor;

              return (
                <div className="attr-row" key={a.id}>
                  <div className="attr-name" title={a.name}>
                    {a.name}
                  </div>
                  <div className="attr-track">
                    <div className="rail">
                      <div className="cap-rail" style={{ width: `${pct(cap)}%` }} />
                      <div
                        className="fill"
                        style={{ width: `${pct(value)}%`, background: color, opacity: atFloor ? 0.25 : 1 }}
                      />
                      {boosted !== undefined && boosted > value && (
                        <div
                          className="fill"
                          style={{
                            left: `${pct(value)}%`,
                            width: `${pct(boosted) - pct(value)}%`,
                            background: 'var(--good)',
                          }}
                        />
                      )}
                    </div>
                    {bps.map((bp) => {
                      const primary = bp.sources.find((s) => s.kind !== 'floor') ?? bp.sources[0];
                      if (!primary || primary.kind === 'floor') return null;
                      const labels = bp.sources
                        .filter((s) => s.kind !== 'floor')
                        .map((s) => s.label)
                        .join(' · ');
                      return (
                        <div
                          key={bp.value}
                          className={`tick ${primary.kind} ${value >= bp.value ? 'passed' : 'pending'}`}
                          style={{ left: `${pct(bp.value)}%` }}
                          title={`${bp.value} — ${labels}`}
                        />
                      );
                    })}
                  </div>
                  <div className={`attr-value${atCap ? ' at-cap' : ''}${atFloor ? ' at-floor' : ''}`} title={`Cap ${cap}`}>
                    {value}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}

      <div className="legend">
        <span>
          <i style={{ background: 'var(--gold)' }} /> badge threshold
        </span>
        <span>
          <i style={{ background: '#d59ce8' }} /> animation
        </span>
        <span>
          <i style={{ background: '#ff9b6b' }} /> takeover
        </span>
        <span>
          <i style={{ background: 'var(--danger)' }} /> your hard minimum
        </span>
        <span>
          <i style={{ background: '#212a3c' }} /> cap for this body
        </span>
        <span>
          <i style={{ background: 'var(--good)' }} /> cap breaker
        </span>
      </div>
    </Panel>
  );
}
