import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { RefreshCw, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { webhooksApi } from '@/api/crm.api';
import { StatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, PageHeader } from '@/components/ui/Card';
import { Input, Select } from '@/components/ui/form';
import { Pagination } from '@/components/ui/Pagination';
import { EmptyState, ErrorState, Spinner } from '@/components/ui/states';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { formatDate, humanize } from '@/lib/format';
import type { WebhookLogsQuery, WebhookStatus } from '@/types/webhooks';

const STATUSES: WebhookStatus[] = ['RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED', 'SKIPPED'];
const TOPICS = ['orders/create', 'orders/updated', 'app/uninstalled'];

export function WebhookLogsPage() {
  const [params, setParams] = useSearchParams();
  const query: WebhookLogsQuery = useMemo(
    () => ({
      page: Math.max(1, Number(params.get('page')) || 1),
      pageSize: [10, 20, 50, 100].includes(Number(params.get('pageSize'))) ? Number(params.get('pageSize')) : 20,
      status: params.get('status') ?? undefined,
      topic: params.get('topic') ?? undefined,
      search: params.get('search') ?? undefined,
    }),
    [params],
  );
  const update = (patch: Record<string, string | number | undefined>, resetPage = true) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(patch)) {
          if (v === undefined || v === '') next.delete(k);
          else next.set(k, String(v));
        }
        if (resetPage && !('page' in patch)) next.delete('page');
        return next;
      },
      { replace: true },
    );

  const [searchInput, setSearchInput] = useState(query.search ?? '');
  const debounced = useDebouncedValue(searchInput.trim(), 350);
  useEffect(() => {
    if ((query.search ?? '') !== debounced) update({ search: debounced || undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const logs = useQuery({
    queryKey: ['webhooks', query],
    queryFn: () => webhooksApi.list(query),
    placeholderData: keepPreviousData,
    refetchInterval: 15_000,
  });
  const data = logs.data;

  return (
    <>
      <PageHeader
        title="Webhook Logs"
        description="Every Shopify webhook delivery, its processing status, retries and errors."
        actions={
          <Button variant="secondary" onClick={() => void logs.refetch()} loading={logs.isFetching && !logs.isLoading} icon={<RefreshCw className="size-4" />}>
            Refresh
          </Button>
        }
      />

      {data && (
        <div className="mb-4 flex flex-wrap gap-2">
          {STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => update({ status: query.status === s ? undefined : s })}
              aria-pressed={query.status === s}
              className={`rounded-full border px-3 py-1 text-xs font-medium ${query.status === s ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
            >
              {humanize(s)} · {data.counts[s] ?? 0}
            </button>
          ))}
        </div>
      )}

      <Card>
        <div className="grid gap-3 border-b border-slate-100 p-4 md:grid-cols-4">
          <div className="relative md:col-span-2">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <Input aria-label="Search webhook logs" placeholder="Search event ID or Shopify order ID…" className="pl-9" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
          </div>
          <Select aria-label="Status" value={query.status ?? ''} onChange={(e) => update({ status: e.target.value })}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
          </Select>
          <Select aria-label="Event type" value={query.topic ?? ''} onChange={(e) => update({ topic: e.target.value })}>
            <option value="">All event types</option>
            {TOPICS.map((t) => <option key={t} value={t}>{t}</option>)}
          </Select>
        </div>

        {logs.isLoading ? (
          <Spinner label="Loading webhook logs" />
        ) : logs.isError ? (
          <ErrorState error={logs.error} onRetry={() => void logs.refetch()} />
        ) : !data || data.items.length === 0 ? (
          <EmptyState title="No webhook events" description="Events appear here once Shopify delivers orders/create or orders/updated webhooks." />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th scope="col" className="px-5 py-3 font-medium">Event ID</th>
                    <th scope="col" className="px-5 py-3 font-medium">Event type</th>
                    <th scope="col" className="px-5 py-3 font-medium">Shopify order</th>
                    <th scope="col" className="px-5 py-3 font-medium">Status</th>
                    <th scope="col" className="px-5 py-3 font-medium">Received</th>
                    <th scope="col" className="px-5 py-3 font-medium">Retries</th>
                    <th scope="col" className="px-5 py-3 font-medium">Error</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.items.map((e) => (
                    <tr key={e.id} className="hover:bg-slate-50">
                      <td className="max-w-48 px-5 py-3">
                        <Link to={`/webhooks/${e.id}`} className="block truncate font-mono text-xs text-brand-600 hover:underline" title={e.shopifyEventId}>
                          {e.shopifyEventId}
                        </Link>
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap">{e.topic}</td>
                      <td className="px-5 py-3 font-mono text-xs text-slate-600">{e.shopifyOrderId?.split('/').pop() ?? '—'}</td>
                      <td className="px-5 py-3"><StatusBadge status={e.processingStatus} /></td>
                      <td className="px-5 py-3 whitespace-nowrap text-slate-600">{formatDate(e.receivedAt, true)}</td>
                      <td className="px-5 py-3 tabular-nums">{e.retryCount}</td>
                      <td className="max-w-64 truncate px-5 py-3 text-red-600" title={e.errorMessage ?? undefined}>{e.errorMessage ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination meta={data.meta} onPageChange={(page) => update({ page }, false)} onPageSizeChange={(pageSize) => update({ pageSize })} />
          </>
        )}
      </Card>
    </>
  );
}
