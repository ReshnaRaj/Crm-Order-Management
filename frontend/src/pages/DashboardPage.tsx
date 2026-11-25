import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Clock, DollarSign, ShoppingBag } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ordersApi, shopifyApi } from '@/api/crm.api';
import { OrdersTable } from '@/components/orders/OrdersTable';
import { StatusBadge } from '@/components/ui/Badge';
import { Card, CardHeader, PageHeader } from '@/components/ui/Card';
import { EmptyState, ErrorState, Spinner } from '@/components/ui/states';
import { useAuth } from '@/hooks/useAuth';
import { formatMoney } from '@/lib/format';

function Metric({ label, value, icon, hint }: { label: string; value: ReactNode; icon: ReactNode; hint?: ReactNode }) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-slate-500">{label}</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-900 tabular-nums">{value}</p>
          {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
        </div>
        <div className="rounded-lg bg-brand-50 p-2 text-brand-600">{icon}</div>
      </div>
    </Card>
  );
}

export function DashboardPage() {
  const { user } = useAuth();
  const summary = useQuery({ queryKey: ['orders', 'summary'], queryFn: ordersApi.summary });
  const status = useQuery({ queryKey: ['shopify', 'status'], queryFn: shopifyApi.status });

  const s = summary.data;
  const primarySales = s?.totalSales[0];

  return (
    <>
      <PageHeader
        title={`Welcome back${user ? `, ${user.name.split(' ')[0]}` : ''}`}
        description="Overview of orders stored in the CRM."
        actions={
          status.data && (
            <Link to="/integrations/shopify" className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900">
              Shopify: <StatusBadge status={status.data.store?.connectionStatus ?? 'DISCONNECTED'} />
            </Link>
          )
        }
      />

      {summary.isLoading ? (
        <Spinner label="Loading metrics" />
      ) : summary.isError ? (
        <Card><ErrorState error={summary.error} onRetry={() => void summary.refetch()} /></Card>
      ) : s && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="Total orders" value={s.totalOrders.toLocaleString()} icon={<ShoppingBag className="size-5" />} hint={s.cancelledOrders ? `${s.cancelledOrders} cancelled` : undefined} />
            <Metric label="Pending orders" value={s.pendingOrders.toLocaleString()} icon={<Clock className="size-5" />} hint="Open and not fully fulfilled" />
            <Metric label="Fulfilled orders" value={s.fulfilledOrders.toLocaleString()} icon={<CheckCircle2 className="size-5" />} />
            <Metric
              label="Total sales"
              value={primarySales ? formatMoney(primarySales.amount, primarySales.currency) : formatMoney(0, 'USD')}
              icon={<DollarSign className="size-5" />}
              hint={
                s.totalSales.length > 1
                  ? s.totalSales.slice(1).map((t) => formatMoney(t.amount, t.currency)).join(' · ')
                  : 'Excludes cancelled orders'
              }
            />
          </div>

          <Card className="mt-6">
            <CardHeader
              title="Recent orders"
              actions={<Link to="/orders" className="text-sm font-medium text-brand-600 hover:underline">View all</Link>}
            />
            {s.recentOrders.length ? (
              <OrdersTable orders={s.recentOrders} returnTo="/dashboard" />
            ) : (
              <EmptyState
                title="No orders yet"
                description="Import orders from Shopify to see them here."
                action={<Link to="/integrations/shopify" className="text-sm font-medium text-brand-600 hover:underline">Connect Shopify</Link>}
              />
            )}
          </Card>
        </>
      )}
    </>
  );
}
