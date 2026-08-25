import { useState, type ReactNode } from 'react';
import type { Verification } from '@2k27/core';

/**
 * Every rating, threshold and requirement shown in this app carries one of
 * these. The whole dataset is currently unverified, and the UI is not allowed
 * to hide that.
 */
export function VerificationChip({ verification }: { verification?: Verification }) {
  const status = verification?.status ?? 'unverified';
  const title =
    verification?.notes ??
    (status === 'unverified'
      ? 'Placeholder value. Not sourced from NBA 2K27.'
      : verification?.source ?? status);
  const label = status === 'community-verified' ? 'community' : status;
  return (
    <span className={`chip ${status}`} title={title}>
      {label}
    </span>
  );
}

export function Panel({
  title,
  count,
  children,
  right,
  collapsible = false,
  defaultOpen = true,
  tight = false,
}: {
  title: string;
  count?: ReactNode;
  children: ReactNode;
  right?: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  tight?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const isOpen = !collapsible || open;
  return (
    <section className="panel">
      <div
        className={`panel-head${collapsible ? ' collapsible-head' : ''}`}
        onClick={collapsible ? () => setOpen((v) => !v) : undefined}
      >
        {collapsible && <span className={`chevron${open ? ' open' : ''}`}>▶</span>}
        <h3>{title}</h3>
        {count !== undefined && <span className="count">{count}</span>}
        {right && <span className="count">{right}</span>}
      </div>
      {isOpen && <div className={`panel-body${tight ? ' tight' : ''}`}>{children}</div>}
    </section>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  display,
  hint,
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  display?: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <div className="field">
      <div className="field-label">
        <span>{label}</span>
        <span className="field-value">{display ?? value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {hint && <div className="field-hint">{hint}</div>}
    </div>
  );
}

export function BadgeLevelChip({ level, name }: { level: string; name: string }) {
  return <span className={`chip level-${level}`}>{name}</span>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function GapPills({
  gaps,
}: {
  gaps: { attributeName: string; current: number; required: number; deficit: number }[];
}) {
  return (
    <>
      {gaps.map((g) => (
        <span className="gap-pill" key={g.attributeName}>
          {g.attributeName} {g.current} → <b>{g.required}</b> (+{g.deficit})
        </span>
      ))}
    </>
  );
}
