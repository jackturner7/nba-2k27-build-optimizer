import { useMemo } from 'react';
import {
  computeBudget,
  formatHeight,
  heightRange,
  weightRange,
  wingspanRange,
  type BuildBody,
  type Dataset,
} from '@2k27/core';
import { Panel, Slider, VerificationChip } from './Bits';

/**
 * The 2K-style body editor. Every slider range comes from the dataset, and
 * changing height re-derives the legal weight and wingspan ranges immediately —
 * the same coupling the in-game builder has.
 */
export function BodyPanel({
  dataset,
  body,
  onChange,
}: {
  dataset: Dataset;
  body: BuildBody;
  onChange: (body: BuildBody) => void;
}) {
  const hRange = useMemo(() => heightRange(dataset, body.position), [dataset, body.position]);
  const wRange = useMemo(
    () => weightRange(dataset, body.position, body.heightInches),
    [dataset, body.position, body.heightInches]
  );
  const wsRange = useMemo(
    () => wingspanRange(dataset, body.position, body.heightInches, body.weightPounds),
    [dataset, body.position, body.heightInches, body.weightPounds]
  );
  const budget = useMemo(() => computeBudget(dataset, body), [dataset, body]);

  const clampAll = (next: BuildBody): BuildBody => {
    const h = heightRange(dataset, next.position);
    const heightInches = Math.min(h.max, Math.max(h.min, next.heightInches));
    const w = weightRange(dataset, next.position, heightInches);
    const weightPounds = Math.min(w.max, Math.max(w.min, next.weightPounds));
    const ws = wingspanRange(dataset, next.position, heightInches, weightPounds);
    const wingspanInches = Math.min(ws.max, Math.max(ws.min, next.wingspanInches));
    return { position: next.position, heightInches, weightPounds, wingspanInches };
  };

  const wingspanDelta = body.wingspanInches - body.heightInches;

  return (
    <Panel
      title="Body"
      right={<VerificationChip verification={dataset.body.weightModel.verification} />}
    >
      <div className="field">
        <div className="field-label">
          <span>Position</span>
        </div>
        <div className="seg">
          {dataset.positions.map((p) => (
            <button
              key={p.id}
              className={body.position === p.id ? 'active' : ''}
              onClick={() => onChange(clampAll({ ...body, position: p.id }))}
              title={`${p.name} — ${formatHeight(p.heightInchesMin)} to ${formatHeight(p.heightInchesMax)}`}
            >
              {p.id}
            </button>
          ))}
        </div>
      </div>

      <Slider
        label="Height"
        min={hRange.min}
        max={hRange.max}
        value={body.heightInches}
        display={formatHeight(body.heightInches)}
        hint={`${formatHeight(hRange.min)} – ${formatHeight(hRange.max)} for a ${body.position}`}
        onChange={(v) => onChange(clampAll({ ...body, heightInches: v }))}
      />

      <Slider
        label="Weight"
        min={wRange.min}
        max={wRange.max}
        value={body.weightPounds}
        display={`${body.weightPounds} lb`}
        hint={`${wRange.min} – ${wRange.max} lb at ${formatHeight(body.heightInches)}`}
        onChange={(v) => onChange(clampAll({ ...body, weightPounds: v }))}
      />

      <Slider
        label="Wingspan"
        min={wsRange.min}
        max={wsRange.max}
        value={body.wingspanInches}
        display={formatHeight(body.wingspanInches)}
        hint={`${formatHeight(wsRange.min)} – ${formatHeight(wsRange.max)} · ${
          wingspanDelta >= 0 ? '+' : ''
        }${wingspanDelta}" vs height`}
        onChange={(v) => onChange(clampAll({ ...body, wingspanInches: v }))}
      />

      <div className="summary-grid" style={{ marginTop: 4 }}>
        <div className="summary-cell">
          <div className="k">Build points</div>
          <div className="v">{Number.isFinite(budget) ? budget : '∞'}</div>
        </div>
        <div className="summary-cell">
          <div className="k">Frame</div>
          <div className="v" style={{ fontSize: 14 }}>
            {formatHeight(body.heightInches)} / {body.weightPounds}
          </div>
        </div>
      </div>
    </Panel>
  );
}
