export function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  fmt,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  fmt?: (v: number) => string;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-[11px] text-[var(--text-muted)]">
      <span className="flex items-center justify-between gap-2">
        <span>{label}</span>
        <span className="tabular-nums">
          {fmt ? fmt(value) : `${Math.round(value * 100)}%`}
        </span>
      </span>
      <input
        aria-label={label}
        className="h-3 w-full min-w-0 accent-[var(--accent)]"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}
