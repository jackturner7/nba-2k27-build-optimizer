import { useMemo } from 'react';
import {
  capOverrideFor,
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
        <div
          className="summary-cell"
          title={
            dataset.budget.actualMechanic
              ? `The real builder has no point pool — it asks you to ${dataset.budget.actualMechanic.uiText.toLowerCase()}. This number stands in for that, and its scale is invented.`
              : undefined
          }
        >
          <div className="k">Build points{dataset.budget.actualMechanic ? ' (stand-in)' : ''}</div>
          <div className="v">{Number.isFinite(budget) ? budget : '∞'}</div>
        </div>
        <div className="summary-cell">
          <div className="k">Frame</div>
          <div className="v" style={{ fontSize: 14 }}>
            {formatHeight(body.heightInches)} / {body.weightPounds}
          </div>
        </div>
      </div>

      <CapsProvenance dataset={dataset} body={body} />
    </Panel>
  );
}

/**
 * Caps decide everything downstream, and right now only a handful of bodies
 * have real ones. Which kind you are looking at is the single most useful thing
 * to know about a build, so it sits directly under the sliders that choose it.
 */
function CapsProvenance({ dataset, body }: { dataset: Dataset; body: BuildBody }) {
  const exact = capOverrideFor(dataset, body);
  const accuracy = dataset.caps.capModel.measuredAccuracy;
  const key = `${body.position}|${body.heightInches}|${body.weightPounds}|${body.wingspanInches}`;
  const inGameName = dataset.officialBuildNames?.entries[key];

  if (exact) {
    const proven = Object.keys(exact.caps).length;
    const floors = Object.keys(exact.capFloors).length;
    const direct = Object.values(exact.capEvidence).filter((e) => (e ?? '').includes('builder-max')).length;
    return (
      <>
        {inGameName && (
          <div className="summary-cell" style={{ marginTop: 10 }}>
            <div className="k">In-game build name</div>
            <div className="v" style={{ fontSize: 15 }}>{inGameName}</div>
          </div>
        )}
        <div className="row-note severity-info" style={{ marginTop: 10 }}>
          ✅ <strong>{proven} caps proven</strong> from the real builder
          {direct > 0
            ? ` — ${direct} read straight off the slider screen's maximum, the rest from a cap breaker ladder running into a locked slot.`
            : " — a cap breaker ladder that runs into a locked slot has hit this frame's ceiling."}
          {floors > 0 && (
            <>
              {' '}
              Another {floors} are known only as <em>lower bounds</em> (the ladder ran out of slots
              before locking), so those still come from the model, raised to at least what the builder
              was seen to reach.
            </>
          )}
        </div>
      </>
    );
  }

  return (
    <div className="row-note" style={{ marginTop: 10 }}>
      ⚠️ <strong>Modelled caps.</strong> No build has been transcribed on this frame, so the caps come
      from the dataset&rsquo;s linear model.
      {accuracy
        ? ` Scored against the ${accuracy.attributesCompared} caps proven on other frames, that model is off by ${accuracy.meanAbsoluteError} points on average and reads high on ${accuracy.biasedHighOn} of them — so this build will look more affordable than it is.`
        : ' The magnitudes are invented.'}
    </div>
  );
}
