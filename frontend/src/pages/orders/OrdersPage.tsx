import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { FilterX, PlusCircle, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';
import { ordersApi } from '@/api/crm.api';
import { OrdersTable } from '@/components/orders/OrdersTable';
import { Button } from '@/components/ui/Button';
import { Card, PageHeader } from '@/components/ui/Card';
import { Input, Select } from '@/components/ui/form';
import { Pagination } from '@/components/ui/Pagination';
import { EmptyState, ErrorState, Spinner } from '@/components/ui/states';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { humanize } from '@/lib/format';
import type { OrdersQuery } from '@/types/orders';

const PAGE_SIZES = [10, 20, 50, 100];
const FILTER_KEYS = ['search', 'orderStatus', 'fulfillmentStatus', 'financialStatus', 'dateFrom', 'dateTo'] as const;

/** Local calendar day -> ISO instant at the start / end of that day. */
const startOfDay = (d: string) => new Date(`${d}T00:00:00`).toISOString();
const endOfDay = (d: string) => new Date(`${d}T23:59:59.999`).toISOString();

export function OrdersPage() {
  const [params, setParams] = useSearchParams();
  const location = useLocation();

  const query: OrdersQuery = useMemo(() => {
    const num = (k: string, d: number) => {
      const n = Number(params.get(k));
      return Number.isInteger(n) && n > 0 ? n : d;
    };
    const pageSize = num('pageSize', 20);
    return {
      page: num('page', 1),
      pageSize: PAGE_SIZES.includes(pageSize) ? pageSize : 20,
      search: params.get('search') ?? undefined,
      orderStatus: params.get('orderStatus') ?? undefined,
      fulfillmentStatus: params.get('fulfillmentStatus') ?? undefined,
      financialStatus: params.get('financialStatus') ?? undefined,
      dateFrom: params.get('dateFrom') ?? undefined,
      dateTo: params.get('dateTo') ?? undefined,
      sortBy: params.get('sortBy') === 'totalAmount' ? 'totalAmount' : 'orderDate',
      sortOrder: params.get('sortOrder') === 'asc' ? 'asc' : 'desc',
    };
  }, [params]);

  /** Updates URL params; any filter change resets to page 1. */
  const update = (patch: Record<string, string | number | undefined>, resetPage = true) => {
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
  };

  // Search box is debounced before touching the URL / server.
  const [searchInput, setSearchInput] = useState(query.search ?? '');
  const debouncedSearch = useDebouncedValue(searchInput.trim(), 350);
  useEffect(() => {
    if ((query.search ?? '') !== debouncedSearch) update({ search: debouncedSearch || undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  const apiQuery: OrdersQuery = {
    ...query,
    dateFrom: query.dateFrom ? startOfDay(query.dateFrom) : undefined,
    dateTo: query.dateTo ? endOfDay(query.dateTo) : undefined,
  };
  const invalidRange = Boolean(query.dateFrom && query.dateTo && query.dateFrom > query.dateTo);

  const orders = useQuery({
    queryKey: ['orders', apiQuery],
    queryFn: ({ signal }) => ordersApi.list(apiQuery, signal),
    placeholderData: keepPreviousData,
    enabled: !invalidRange,
  });
  const filterOptions = useQuery({ queryKey: ['orders', 'filters'], queryFn: ordersApi.filters, staleTime: 60_000 });

  const hasFilters = FILTER_KEYS.some((k) => params.get(k));
  const clearFilters = () => {
    setSearchInput('');
    update(Object.fromEntries(FILTER_KEYS.map((k) => [k, undefined])));
  };

  const onSort = (by: 'orderDate' | 'totalAmount') =>
    update({ sortBy: by, sortOrder: query.sortBy === by && query.sortOrder === 'desc' ? 'asc' : 'desc' });

  const data = orders.data;
  const returnTo = location.pathname + location.search;

  return (
    <>
      <PageHeader
        title="Orders"
        description="Search, filter and review orders synchronised from Shopify."
        actions={
          <Link to="/orders/new">
            <Button icon={<PlusCircle className="size-4" />}>Create order</Button>
          </Link>
        }
      />

      <Card>
        <div className="grid gap-3 border-b border-slate-100 p-4 md:grid-cols-2 xl:grid-cols-6">
          <div className="relative md:col-span-2">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <Input
              aria-label="Search orders"
              placeholder="Search order # or customer…"
              className="pl-9"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </div>
          <Select aria-label="Order status" value={query.orderStatus ?? ''} onChange={(e) => update({ orderStatus: e.target.value })}>
            <option value="">All statuses</option>
            {['OPEN', 'CLOSED', 'CANCELLED'].map((s) => (
              <option key={s} value={s}>{humanize(s)}</option>
            ))}
          </Select>
          <Select
            aria-label="Fulfillment status"
            value={query.fulfillmentStatus ?? ''}
            onChange={(e) => update({ fulfillmentStatus: e.target.value })}
          >
            <option value="">All fulfillment</option>
            {(filterOptions.data?.fulfillment ?? ['UNFULFILLED', 'PARTIALLY_FULFILLED', 'FULFILLED']).map((s) => (
              <option key={s} value={s}>{humanize(s)}</option>
            ))}
          </Select>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <span className="whitespace-nowrap">From</span>
            <Input type="date" aria-label="Start date" value={query.dateFrom ?? ''} max={query.dateTo} onChange={(e) => update({ dateFrom: e.target.value })} />
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <span className="whitespace-nowrap">To</span>
            <Input type="date" aria-label="End date" value={query.dateTo ?? ''} min={query.dateFrom} onChange={(e) => update({ dateTo: e.target.value })} />
          </label>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-xs text-slate-500">
          <span>
            {data ? `${data.meta.totalItems} order${data.meta.totalItems === 1 ? '' : 's'}` : ' '}
            {orders.isFetching && !orders.isLoading && ' · updating…'}
          </span>
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters} icon={<FilterX className="size-3.5" />}>
              Clear filters
            </Button>
          )}
        </div>

        {invalidRange ? (
          <EmptyState title="Invalid date range" description="The start date must be on or before the end date." />
        ) : orders.isLoading ? (
          <Spinner label="Loading orders" />
        ) : orders.isError ? (
          <ErrorState error={orders.error} onRetry={() => void orders.refetch()} />
        ) : !data || data.items.length === 0 ? (
          hasFilters ? (
            <EmptyState title="No matching orders" description="Try a different search term or adjust the filters." action={<Button variant="secondary" size="sm" onClick={clearFilters}>Clear filters</Button>} />
          ) : (
            <EmptyState
              title="No orders yet"
              description="Connect your Shopify store and import orders, or create one from the CRM."
              action={<Link to="/integrations/shopify" className="text-sm font-medium text-brand-600 hover:underline">Go to Shopify Integration</Link>}
            />
          )
        ) : (
          <>
            <OrdersTable orders={data.items} sort={{ by: query.sortBy, order: query.sortOrder, onChange: onSort }} returnTo={returnTo} />
            <Pagination
              meta={data.meta}
              pageSizeOptions={PAGE_SIZES}
              onPageChange={(page) => update({ page }, false)}
              onPageSizeChange={(pageSize) => update({ pageSize })}
            />
          </>
        )}
      </Card>
    </>
  );
}
