import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  formatHeight,
  heightRange,
  requestFromArchetype,
  validateBody,
  weightRange,
  wingspanRange,
  type BuildBody,
  type Dataset,
  type OptimizeRequest,
  type OptimizeResult,
  type ParseNote,
} from '@2k27/core';
import { describeBuild, fetchDataset, fetchHealth, reloadDataset, runOptimize, type DatasetPayload } from './lib/api';
import { BodyPanel } from './components/BodyPanel';
import { BuildCard } from './components/BuildCard';
import { DataBanner } from './components/DataBanner';
import { Panel } from './components/Bits';
import { PriorityPanel } from './components/PriorityPanel';
import { ArchetypePanel, DescribePanel } from './components/PresetPanel';
import { CoveragePanel } from './components/CoveragePanel';
import { CrossCheckPanel } from './components/CrossCheckPanel';

const DATASET_ID = '2k27';

type Mode = 'builder' | 'describe';

function defaultBody(dataset: Dataset): BuildBody {
  const position = dataset.positions.find((p) => p.id === 'SF') ?? dataset.positions[0]!;
  const h = heightRange(dataset, position.id);
  const heightInches = Math.round((h.min + h.max) / 2);
  const w = weightRange(dataset, position.id, heightInches);
  const ws = wingspanRange(dataset, position.id, heightInches);
  return {
    position: position.id,
    heightInches,
    weightPounds: Math.round((w.min + w.max) / 2),
    wingspanInches: Math.min(ws.max, heightInches + 4),
  };
}

export default function App() {
  const [payload, setPayload] = useState<DatasetPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloading, setReloading] = useState(false);
  // Reload rewrites server state, so it is disabled in production unless a
  // RELOAD_TOKEN is set. Hide the button rather than offer a guaranteed 404.
  const [reloadEnabled, setReloadEnabled] = useState(true);

  const [mode, setMode] = useState<Mode>('builder');
  const [body, setBody] = useState<BuildBody | null>(null);
  const [priorities, setPriorities] = useState<Record<string, number>>({});
  const [showAllPriorities, setShowAllPriorities] = useState(false);
  const [archetypeId, setArchetypeId] = useState<string | null>(null);
  const [resultCount, setResultCount] = useState(3);
  const [tokenOverrides, setTokenOverrides] = useState<Record<string, number | null>>({});

  const [text, setText] = useState('');
  const [parseNotes, setParseNotes] = useState<ParseNote[]>([]);
  const [unparsed, setUnparsed] = useState<string[]>([]);

  const [result, setResult] = useState<OptimizeResult | null>(null);
  const [lastRequest, setLastRequest] = useState<OptimizeRequest | null>(null);
  const [activeBuild, setActiveBuild] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // --- Load the dataset -----------------------------------------------------
  useEffect(() => {
    fetchDataset(DATASET_ID)
      .then((p) => {
        setPayload(p);
        setBody(defaultBody(p.dataset));
        const initial: Record<string, number> = {};
        for (const g of p.dataset.priorityGroups) initial[g.id] = 0;
        setPriorities(initial);
      })
      .catch((e: Error) => setLoadError(e.message));
  }, []);

  const dataset = payload?.dataset ?? null;

  useEffect(() => {
    fetchHealth()
      .then((h) => setReloadEnabled(h.reloadEnabled))
      .catch(() => setReloadEnabled(false));
  }, []);

  const handleReload = useCallback(async () => {
    setReloading(true);
    try {
      await reloadDataset(DATASET_ID);
      const fresh = await fetchDataset(DATASET_ID);
      setPayload(fresh);
      setResult(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setReloading(false);
    }
  }, []);

  // --- Archetype selection --------------------------------------------------
  const pickArchetype = useCallback(
    (id: string) => {
      if (!dataset) return;
      setArchetypeId(id);
      const request = requestFromArchetype(dataset, id, { resultCount });
      setBody(request.body);
      const merged: Record<string, number> = {};
      for (const g of dataset.priorityGroups) merged[g.id] = request.priorities[g.id] ?? 0;
      setPriorities(merged);
    },
    [dataset, resultCount]
  );

  // --- Run the optimizer ----------------------------------------------------
  const runBuilder = useCallback(async () => {
    if (!dataset || !body) return;
    setBusy(true);
    setError(null);
    try {
      const archetype = archetypeId ? dataset.archetypes.find((a) => a.id === archetypeId) : null;
      const request: OptimizeRequest = {
        body: validateBody(dataset, body).corrected,
        priorities,
        minimums: archetype?.constraints.minimums ?? {},
        softTargets: archetype?.constraints.softTargets ?? {},
        resultCount,
        archetypeId: archetypeId ?? undefined,
        useCapBreakers: true,
        useBadgeBoosts: true,
        tokenOverrides,
      };
      const res = await runOptimize(DATASET_ID, request);
      setResult(res);
      setLastRequest(request);
      setActiveBuild(0);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [dataset, body, priorities, archetypeId, resultCount, tokenOverrides]);

  const runDescribe = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await describeBuild(DATASET_ID, text, resultCount, tokenOverrides);
      setParseNotes(res.parsed.notes);
      setUnparsed(res.parsed.unparsed);
      setResult(res.result);
      setLastRequest(res.request);
      setBody(res.request.body);
      setPriorities(res.request.priorities);
      setArchetypeId(null);
      setActiveBuild(0);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [text, resultCount, tokenOverrides]);

  const builds = result?.builds ?? [];
  const current = builds[Math.min(activeBuild, builds.length - 1)];

  const anyPriority = useMemo(() => Object.values(priorities).some((v) => v > 0), [priorities]);

  if (loadError) {
    return (
      <div className="center-msg">
        <h2>Could not load the dataset</h2>
        <p>{loadError}</p>
        <p className="field-hint">
          Is the API running? Start it with <code>npm run dev:api</code> (default port 4000).
        </p>
      </div>
    );
  }

  if (!payload || !dataset || !body) {
    return (
      <div className="center-msg">
        <span className="spinner" />
        <p>Loading NBA 2K27 dataset…</p>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>NBA 2K27 MyPLAYER Build Optimizer</h1>
        <span className="sub">threshold-aware allocation</span>
        <div className="header-spacer" />
        <div className="seg" style={{ width: 260 }}>
          <button className={mode === 'builder' ? 'active' : ''} onClick={() => setMode('builder')}>
            Builder
          </button>
          <button className={mode === 'describe' ? 'active' : ''} onClick={() => setMode('describe')}>
            Describe a build
          </button>
        </div>
      </header>

      <DataBanner
        dataset={dataset}
        verification={payload.verification}
        issues={payload.issues}
        onReload={handleReload}
        reloading={reloading}
        reloadEnabled={reloadEnabled}
      />

      <div className="layout">
        <div className="column sidebar">
          {mode === 'describe' ? (
            <DescribePanel
              value={text}
              onChange={setText}
              onSubmit={runDescribe}
              loading={busy}
              notes={parseNotes}
              unparsed={unparsed}
            />
          ) : (
            <ArchetypePanel dataset={dataset} activeId={archetypeId} onPick={pickArchetype} />
          )}

          <BodyPanel
            dataset={dataset}
            body={body}
            onChange={(b) => {
              setBody(b);
              setArchetypeId(null);
            }}
          />

          {mode === 'builder' && (
            <>
              <PriorityPanel
                dataset={dataset}
                priorities={priorities}
                onChange={setPriorities}
                showAll={showAllPriorities}
                onToggleShowAll={() => setShowAllPriorities((v) => !v)}
              />

              <Panel title="Run">
                <div className="field">
                  <div className="field-label">
                    <span>Builds to return</span>
                    <span className="field-value">{resultCount}</span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={6}
                    value={resultCount}
                    onChange={(e) => setResultCount(Number(e.target.value))}
                  />
                </div>
                <button
                  className="btn primary"
                  style={{ width: '100%' }}
                  onClick={runBuilder}
                  disabled={busy || !anyPriority}
                >
                  {busy ? <span className="spinner" /> : 'Optimize build'}
                </button>
                {!anyPriority && (
                  <div className="field-hint" style={{ marginTop: 6 }}>
                    Set at least one priority above zero, or pick an archetype preset.
                  </div>
                )}
              </Panel>
            </>
          )}

          {mode === 'describe' && (
            <Panel title="Run">
              <div className="field">
                <div className="field-label">
                  <span>Builds to return</span>
                  <span className="field-value">{resultCount}</span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={6}
                  value={resultCount}
                  onChange={(e) => setResultCount(Number(e.target.value))}
                />
              </div>
            </Panel>
          )}
        </div>

        <div className="column">
          {error && (
            <div className="banner error">
              <span className="icon">⛔</span>
              <div>
                <strong>Request failed</strong>
                <p>{error}</p>
              </div>
            </div>
          )}

          {!result && (
            <Panel title="No builds yet">
              <p style={{ color: 'var(--text-dim)', margin: 0 }}>
                {mode === 'builder'
                  ? 'Pick an archetype or set some priorities, then hit Optimize build. The optimizer will only spend points that cross a badge, animation or takeover threshold — anything left over is reported rather than dumped into a rating for show.'
                  : 'Describe the player you want in plain English. Every clause the parser understands is echoed back so you can see exactly which constraint came from which phrase.'}
              </p>
            </Panel>
          )}

          {result && !result.feasible && (
            <div className="banner error">
              <span className="icon">⛔</span>
              <div>
                <strong>These requirements cannot all be met</strong>
                <p>
                  {result.infeasibilityReasons.map((r) => (
                    <span key={r} style={{ display: 'block', marginBottom: 3 }}>
                      {r}
                    </span>
                  ))}
                </p>
              </div>
            </div>
          )}

          {result && builds.length > 0 && (
            <>
              {builds.length > 1 && (
                <div className="build-tabs">
                  {builds.map((b, i) => (
                    <button
                      key={b.id + i}
                      className={`build-tab${i === activeBuild ? ' active' : ''}`}
                      onClick={() => setActiveBuild(i)}
                    >
                      <div className="tab-label">{b.label}</div>
                      <div className="tab-score">
                        score {b.score.total.toFixed(1)} · {b.badges.length} badges · {b.spent} pts
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {result.comparison.length > 0 && (
                <Panel title="How these builds differ" collapsible>
                  <ul className="note-list">
                    {result.comparison.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                </Panel>
              )}

              {current && (
                <BuildCard
                  dataset={dataset}
                  build={current}
                  request={lastRequest ?? undefined}
                  tokenOverrides={tokenOverrides}
                  onTokenOverrideChange={setTokenOverrides}
                />
              )}

              <div className="field-hint" style={{ textAlign: 'right' }}>
                Searched in {result.computeMs} ms · {formatHeight(body.heightInches)} {body.position}
              </div>
            </>
          )}

          {payload.coverage.uncovered.length > 0 && (
            <CoveragePanel dataset={dataset} coverage={payload.coverage} />
          )}

          <CrossCheckPanel reports={payload.crossChecks} />
        </div>
      </div>
    </div>
  );
}
