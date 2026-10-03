import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';

export function Card({
  children,
  className = '',
  title,
  accent,
}: {
  children: ReactNode;
  className?: string;
  title?: string;
  accent?: 'yellow' | 'purple' | 'green' | 'red' | 'blue';
}) {
  const accentBg =
    accent === 'yellow'
      ? 'bg-neo-yellow'
      : accent === 'purple'
        ? 'bg-neo-purple'
        : accent === 'green'
          ? 'bg-neo-green'
          : accent === 'red'
            ? 'bg-neo-red'
            : accent === 'blue'
              ? 'bg-neo-blue'
              : 'bg-white';
  return (
    <section className={`nb-card ${className}`}>
      {title ? (
        <header className={`border-b-[3px] border-ink px-4 py-2.5 ${accentBg}`}>
          <h2 className="nb-title text-sm">{title}</h2>
        </header>
      ) : null}
      <div className="p-4">{children}</div>
    </section>
  );
}

type BtnVariant = 'primary' | 'danger' | 'ghost' | 'green' | 'purple' | 'blue';

const BTN_VARIANT: Record<BtnVariant, string> = {
  primary: 'bg-neo-yellow',
  danger: 'bg-neo-red',
  green: 'bg-neo-green',
  purple: 'bg-neo-purple',
  blue: 'bg-neo-blue',
  ghost: 'bg-white',
};

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant }) {
  return <button className={`nb-btn ${BTN_VARIANT[variant]} ${className}`} {...props} />;
}

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`nb-input ${className}`} {...props} />;
}

export function Select({ className = '', ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`nb-input ${className}`} {...props} />;
}

const BADGE_TONE: Record<string, string> = {
  ok: 'bg-neo-green',
  active: 'bg-neo-green',
  online: 'bg-neo-green',
  healthy: 'bg-neo-green',
  synced: 'bg-neo-green',
  purple: 'bg-neo-purple',
  warn: 'bg-neo-yellow',
  low: 'bg-neo-yellow',
  delayed: 'bg-neo-yellow',
  degraded: 'bg-neo-yellow',
  error: 'bg-neo-red',
  critical: 'bg-neo-red',
  disabled: 'bg-neo-red',
  exhausted: 'bg-neo-red',
  info: 'bg-neo-blue',
  idle: 'bg-white',
};

export function Badge({ tone = 'info', children }: { tone?: string; children: ReactNode }) {
  const icon = tone === 'error' || tone === 'critical' ? '✕' : tone === 'warn' || tone === 'low' ? '⚠' : '●';
  return <span className={`nb-badge ${BADGE_TONE[tone] ?? 'bg-white'}`}>{icon} {children}</span>;
}

export function StatBlock({
  label,
  value,
  sub,
  accent = 'white',
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  accent?: 'yellow' | 'purple' | 'green' | 'red' | 'blue' | 'white';
}) {
  const bg =
    accent === 'yellow'
      ? 'bg-neo-yellow'
      : accent === 'purple'
        ? 'bg-neo-purple'
        : accent === 'green'
          ? 'bg-neo-green'
          : accent === 'red'
            ? 'bg-neo-red'
            : accent === 'blue'
              ? 'bg-neo-blue'
              : 'bg-white';
  return (
    <div className={`nb-card-flat shadow-neo-sm p-4 ${bg}`}>
      <div className="nb-title text-[11px] opacity-70">{label}</div>
      <div className="nb-title text-2xl mt-1 break-all">{value}</div>
      {sub ? <div className="mt-1 text-xs font-semibold opacity-80">{sub}</div> : null}
    </div>
  );
}

export function QuotaBar({ percent, remainingText }: { percent: number; remainingText?: string }) {
  const clamped = Math.max(0, Math.min(100, percent));
  const tone = clamped >= 95 ? 'bg-neo-red' : clamped >= 75 ? 'bg-neo-yellow' : 'bg-neo-green';
  return (
    <div>
      <div className="h-7 border-[3px] border-ink rounded-md overflow-hidden bg-white">
        <div className={`h-full ${tone} transition-all duration-300`} style={{ width: `${clamped}%` }} />
      </div>
      <div className="mt-1.5 flex justify-between nb-mono font-bold">
        <span>USAGE {clamped.toFixed(1)}%</span>
        {remainingText ? <span>{remainingText}</span> : null}
      </div>
    </div>
  );
}

export function Modal({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-ink/50" onClick={onClose} />
      <div className="nb-card relative w-full max-w-lg bg-white max-h-[90vh] overflow-y-auto">
        <header className="flex items-center justify-between border-b-[3px] border-ink bg-neo-purple px-4 py-2.5">
          <h2 className="nb-title text-sm">{title}</h2>
          <button
            className="border-2 border-ink rounded bg-white px-2 py-0.5 font-black active:translate-y-[2px]"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </header>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 p-6">
      <span className="inline-block h-5 w-5 border-[3px] border-ink rounded-full border-t-transparent animate-spin" />
      <span className="nb-title text-xs">{label}…</span>
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="border-[3px] border-dashed border-ink/40 rounded-md p-8 text-center">
      <div className="nb-title text-sm">{title}</div>
      {hint ? <div className="mt-1 text-xs font-semibold opacity-70">{hint}</div> : null}
    </div>
  );
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <div className="nb-card-flat bg-neo-red px-4 py-3 text-sm font-bold">✕ {message}</div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="nb-title text-[11px] opacity-70">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
