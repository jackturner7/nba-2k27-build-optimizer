import type { Dataset } from '@2k27/core';
import { Panel } from './Bits';

/** The priority groups the brief calls out, in the order it lists them. */
const FEATURED_ORDER = [
  'three_point_shooting',
  'perimeter_defense',
  'steal',
  'driving_dunk',
  'ball_handle',
  'speed_with_ball',
  'interior_defense',
  'block',
  'rebounding',
  'athleticism',
];

function intensityLabel(v: number): string {
  if (v >= 95) return 'max';
  if (v >= 80) return 'elite';
  if (v >= 62) return 'good';
  if (v >= 40) return 'some';
  if (v > 0) return 'minimal';
  return 'ignore';
}

export function PriorityPanel({
  dataset,
  priorities,
  onChange,
  showAll,
  onToggleShowAll,
}: {
  dataset: Dataset;
  priorities: Record<string, number>;
  onChange: (next: Record<string, number>) => void;
  showAll: boolean;
  onToggleShowAll: () => void;
}) {
  const featured = FEATURED_ORDER.map((id) => dataset.priorityGroups.find((g) => g.id === id)).filter(
    (g): g is Dataset['priorityGroups'][number] => Boolean(g)
  );
  const rest = dataset.priorityGroups.filter((g) => !FEATURED_ORDER.includes(g.id));
  const groups = showAll ? [...featured, ...rest] : featured;

  return (
    <Panel
      title="Priorities"
      right={
        rest.length > 0 ? (
          <button className="btn small" onClick={onToggleShowAll}>
            {showAll ? 'Fewer' : `+${rest.length} more`}
          </button>
        ) : undefined
      }
    >
      {groups.map((g) => {
        const value = priorities[g.id] ?? 0;
        return (
          <div className="field" key={g.id} style={{ marginBottom: 9 }}>
            <div className="field-label">
              <span>{g.name}</span>
              <span className="field-value" style={{ fontSize: 12, color: value === 0 ? 'var(--text-faint)' : undefined }}>
                {value} · {intensityLabel(value)}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={value}
              onChange={(e) => onChange({ ...priorities, [g.id]: Number(e.target.value) })}
            />
          </div>
        );
      })}
      <div className="field-hint" style={{ marginTop: 8 }}>
        Priorities steer the optimizer; they are not attribute targets. A priority of 100 means
        "spend here first", not "put this at 99".
      </div>
    </Panel>
  );
}
