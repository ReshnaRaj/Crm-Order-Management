import { cn, humanize } from '@/lib/format';

type Tone = 'gray' | 'green' | 'yellow' | 'red' | 'blue' | 'purple';

const tones: Record<Tone, string> = {
  gray: 'bg-slate-100 text-slate-700 ring-slate-200',
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  yellow: 'bg-amber-50 text-amber-800 ring-amber-200',
  red: 'bg-red-50 text-red-700 ring-red-200',
  blue: 'bg-sky-50 text-sky-700 ring-sky-200',
  purple: 'bg-violet-50 text-violet-700 ring-violet-200',
};

const STATUS_TONES: Record<string, Tone> = {
  OPEN: 'blue',
  CLOSED: 'gray',
  CANCELLED: 'red',
  FULFILLED: 'green',
  UNFULFILLED: 'yellow',
  PARTIALLY_FULFILLED: 'purple',
  PAID: 'green',
  PENDING: 'yellow',
  AUTHORIZED: 'blue',
  PARTIALLY_PAID: 'purple',
  REFUNDED: 'gray',
  PARTIALLY_REFUNDED: 'purple',
  VOIDED: 'red',
  EXPIRED: 'red',
  CONNECTED: 'green',
  DISCONNECTED: 'gray',
  INVALID_TOKEN: 'red',
  ERROR: 'red',
  PROCESSED: 'green',
  RECEIVED: 'blue',
  PROCESSING: 'purple',
  FAILED: 'red',
  SKIPPED: 'gray',
  RUNNING: 'purple',
  SUCCEEDED: 'green',
};

export function Badge({ tone = 'gray', children }: { tone?: Tone; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset',
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: string | null | undefined }) {
  if (!status) return <span className="text-slate-400">—</span>;
  return <Badge tone={STATUS_TONES[status] ?? 'gray'}>{humanize(status)}</Badge>;
}
