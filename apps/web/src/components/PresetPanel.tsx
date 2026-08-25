import { useState } from 'react';
import type { Dataset, ParseNote } from '@2k27/core';
import { Panel, VerificationChip } from './Bits';

export function ArchetypePanel({
  dataset,
  activeId,
  onPick,
}: {
  dataset: Dataset;
  activeId: string | null;
  onPick: (id: string) => void;
}) {
  return (
    <Panel title="Archetype presets" count={`${dataset.archetypes.length}`}>
      <div className="preset-grid">
        {dataset.archetypes.map((a) => (
          <button
            key={a.id}
            className={`preset-btn${activeId === a.id ? ' active' : ''}`}
            onClick={() => onPick(a.id)}
            title={a.summary}
          >
            <div className="name">{a.name}</div>
            <div className="desc">{a.summary}</div>
          </button>
        ))}
      </div>
      <div className="field-hint" style={{ marginTop: 10, display: 'flex', gap: 6, alignItems: 'center' }}>
        <VerificationChip verification={dataset.archetypes[0]?.verification} />
        Community archetype names. NBA 2K27's official build names are not known.
      </div>
    </Panel>
  );
}

const EXAMPLES = [
  "I want a 6'8 wing with the highest three-point rating possible, elite perimeter defense, at least 85 steal, good driving dunk and enough ball handle for good dribble animations.",
  "6'3 point guard, elite ball handle and speed with ball, at least 88 three point, decent playmaking, no interior defense.",
  'Seven foot center with elite rim protection, great rebounding, good standing dunk and at least 80 strength.',
  "6'10 stretch four, max three point shooting, good rebounding, enough block for rim protection badges.",
];

export function DescribePanel({
  value,
  onChange,
  onSubmit,
  loading,
  notes,
  unparsed,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  loading: boolean;
  notes: ParseNote[];
  unparsed: string[];
}) {
  const [showExamples, setShowExamples] = useState(false);

  return (
    <Panel
      title="Build Optimizer — describe it"
      right={
        <button className="btn small" onClick={() => setShowExamples((v) => !v)}>
          examples
        </button>
      }
    >
      <textarea
        value={value}
        placeholder="Describe the player you want to make…"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onSubmit();
        }}
      />
      {showExamples && (
        <div style={{ marginTop: 8 }}>
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              className="preset-btn"
              style={{ width: '100%', marginBottom: 5 }}
              onClick={() => {
                onChange(ex);
                setShowExamples(false);
              }}
            >
              <div className="desc" style={{ marginTop: 0 }}>
                {ex}
              </div>
            </button>
          ))}
        </div>
      )}
      <button
        className="btn primary"
        style={{ width: '100%', marginTop: 10 }}
        onClick={onSubmit}
        disabled={loading || value.trim().length === 0}
      >
        {loading ? <span className="spinner" /> : 'Generate builds'}
      </button>
      <div className="field-hint" style={{ marginTop: 6 }}>
        Ctrl/Cmd + Enter to submit. Parsing is rule-based, so every clause it used is listed below.
      </div>

      {notes.length > 0 && (
        <>
          <div className="attr-group-label" style={{ marginTop: 14 }}>
            How your description was read
          </div>
          <ul className="note-list">
            {notes.map((n, i) => (
              <li key={i} style={{ color: n.kind === 'warning' ? 'var(--warn)' : undefined }}>
                {n.message}
              </li>
            ))}
          </ul>
        </>
      )}

      {unparsed.length > 0 && (
        <>
          <div className="attr-group-label" style={{ marginTop: 12 }}>
            Not understood
          </div>
          <ul className="note-list">
            {unparsed.map((u) => (
              <li key={u} style={{ color: 'var(--warn)' }}>
                “{u}” — rephrase this and try again.
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}
