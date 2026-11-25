import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, DownloadCloud, Link2, RefreshCw, ShieldCheck, Unplug, Webhook } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { shopifyApi } from '@/api/crm.api';
import { StatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader, DescriptionList, PageHeader } from '@/components/ui/Card';
import { Field, Input } from '@/components/ui/form';
import { ErrorState, Spinner } from '@/components/ui/states';
import { errorMessage } from '@/lib/api-client';
import { formatDate, humanize } from '@/lib/format';
import type { SyncRun } from '@/types/shopify';

const CALLBACK_ERRORS: Record<string, string> = {
  invalid_signature: 'Shopify’s response signature could not be verified.',
  invalid_state: 'The connection request expired or was already used. Please try again.',
  invalid_request: 'Shopify returned an incomplete response.',
  shopify_auth_failed: 'Shopify rejected the authorization. Check the app credentials.',
  shopify_network_error: 'Could not reach Shopify. Please try again.',
};

function RunSummary({ run }: { run: SyncRun }) {
  return (
    <div className="text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={run.status} />
        <span className="font-medium">{run.type === 'IMPORT' ? 'Full import' : 'Incremental sync'}</span>
        <span className="text-slate-500">started {formatDate(run.startedAt, true)}</span>
      </div>
      <p className="mt-1 text-slate-600">
        {run.ordersFetched} fetched · {run.ordersCreated} created · {run.ordersUpdated} updated
        {run.ordersSkipped ? ` · ${run.ordersSkipped} unchanged` : ''}
        {run.finishedAt && ` · finished ${formatDate(run.finishedAt, true)}`}
      </p>
      {run.errorMessage && <p className="mt-1 text-red-600">{run.errorMessage}</p>}
    </div>
  );
}

export function ShopifyIntegrationPage() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [shop, setShop] = useState('');

  const status = useQuery({
    queryKey: ['shopify', 'status'],
    queryFn: shopifyApi.status,
    // poll while an import/sync is running
    refetchInterval: (q) => (q.state.data?.activeRun ? 2000 : false),
  });

  // Report the OAuth callback outcome once, then clean the URL. Toast ids make this
  // idempotent (effects can run twice, e.g. under React StrictMode).
  useEffect(() => {
    const result = params.get('status');
    if (!result) return;
    if (result === 'connected') {
      toast.success('Shopify store connected', { id: 'shopify-callback' });
      if (params.get('warning') === 'webhooks_failed')
        toast.warning('Connected, but webhook registration failed. Use “Register webhooks” to retry.', {
          id: 'shopify-callback-warning',
        });
    } else {
      toast.error(CALLBACK_ERRORS[params.get('reason') ?? ''] ?? 'Connecting to Shopify failed.', {
        id: 'shopify-callback',
      });
    }
    setParams({}, { replace: true });
    void qc.invalidateQueries({ queryKey: ['shopify'] });
  }, [params, setParams, qc]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['shopify'] });
    void qc.invalidateQueries({ queryKey: ['orders'] });
  };
  const onError = (e: unknown) => toast.error(errorMessage(e));

  const connect = useMutation({
    mutationFn: shopifyApi.connect,
    onSuccess: ({ authorizationUrl }) => window.location.assign(authorizationUrl),
    onError,
  });
  const runImport = useMutation({ mutationFn: shopifyApi.importOrders, onSuccess: () => { toast.success('Import started'); refresh(); }, onError });
  const runSync = useMutation({ mutationFn: shopifyApi.syncOrders, onSuccess: () => { toast.success('Sync started'); refresh(); }, onError });
  const verify = useMutation({ mutationFn: shopifyApi.verify, onSuccess: () => { toast.success('Connection is valid'); refresh(); }, onError: (e) => { onError(e); refresh(); } });
  const webhooks = useMutation({
    mutationFn: shopifyApi.registerWebhooks,
    onSuccess: (r) => {
      toast.success(r.created.length ? `Registered: ${r.created.join(', ')}` : 'Webhooks already registered');
      refresh();
    },
    onError,
  });
  const disconnect = useMutation({ mutationFn: shopifyApi.disconnect, onSuccess: () => { toast.success('Store disconnected'); refresh(); }, onError });

  // Refresh order data when a running import finishes.
  const activeRunId = status.data?.activeRun?.id;
  const [watchedRun, setWatchedRun] = useState<string | undefined>();
  if (activeRunId && activeRunId !== watchedRun) setWatchedRun(activeRunId);
  useEffect(() => {
    if (watchedRun && !activeRunId) {
      void qc.invalidateQueries({ queryKey: ['orders'] });
      const last = status.data?.lastRun;
      if (last?.id === watchedRun) {
        if (last.status === 'SUCCEEDED')
          toast.success(`Finished: ${last.ordersCreated} new, ${last.ordersUpdated} updated orders`, { id: `run-${last.id}` });
        else if (last.status === 'FAILED') toast.error(last.errorMessage ?? 'Import failed', { id: `run-${last.id}` });
      }
    }
  }, [activeRunId, watchedRun, status.data?.lastRun, qc]);

  const onConnect = (e: FormEvent) => {
    e.preventDefault();
    if (!shop.trim()) return toast.error('Enter your store domain');
    connect.mutate(shop.trim());
  };

  if (status.isLoading) return <Spinner label="Loading Shopify status" />;
  if (status.isError) return <Card><ErrorState error={status.error} onRetry={() => void status.refetch()} /></Card>;
  const s = status.data!;
  const store = s.store;
  const busy = Boolean(s.activeRun);

  const connectForm = (
    <form onSubmit={onConnect} className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <Field label="Store domain" className="flex-1" hint="e.g. my-dev-store.myshopify.com">
        {(id, d) => <Input id={id} aria-describedby={d} placeholder="my-dev-store.myshopify.com" value={shop} onChange={(e) => setShop(e.target.value)} />}
      </Field>
      <Button type="submit" loading={connect.isPending} icon={<Link2 className="size-4" />} className="sm:mb-5">
        {store ? 'Reconnect' : 'Connect store'}
      </Button>
    </form>
  );

  return (
    <>
      <PageHeader title="Shopify Integration" description="Connect your store, import orders and manage webhook synchronisation." />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Connection" actions={<StatusBadge status={store?.connectionStatus ?? 'DISCONNECTED'} />} />
            <CardBody className="space-y-5">
              {store ? (
                <DescriptionList
                  items={[
                    { label: 'Store domain', value: store.shopDomain },
                    { label: 'Store name', value: store.name },
                    { label: 'Currency', value: store.currency },
                    { label: 'Connected', value: formatDate(store.connectedAt, true) },
                    { label: 'Last synchronisation', value: formatDate(store.lastSyncAt, true) },
                    { label: 'Webhooks registered', value: formatDate(store.webhooksRegisteredAt, true) },
                  ]}
                />
              ) : (
                <p className="text-sm text-slate-600">No store connected yet. Enter your Shopify store domain to start the secure OAuth installation.</p>
              )}

              {store?.lastError && (
                <div role="alert" className="flex gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                  <span>{store.lastError}</span>
                </div>
              )}
              {s.missingScopes.length > 0 && store && (
                <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
                  Missing scopes: {s.missingScopes.join(', ')}. Reconnect to grant them.
                </div>
              )}

              {(!s.connected || store?.connectionStatus !== 'CONNECTED') && connectForm}

              {s.connected && (
                <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
                  <Button variant="secondary" onClick={() => verify.mutate()} loading={verify.isPending} icon={<ShieldCheck className="size-4" />}>
                    Test connection
                  </Button>
                  <Button variant="secondary" onClick={() => webhooks.mutate()} loading={webhooks.isPending} icon={<Webhook className="size-4" />}>
                    Register webhooks
                  </Button>
                  <Button
                    variant="ghost"
                    className="text-red-600 hover:bg-red-50"
                    loading={disconnect.isPending}
                    icon={<Unplug className="size-4" />}
                    onClick={() => {
                      if (window.confirm('Disconnect this store? Imported orders are kept; the access token is deleted.')) disconnect.mutate();
                    }}
                  >
                    Disconnect
                  </Button>
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Order synchronisation"
              description="Import pulls every order (cursor-paginated). Sync pulls only orders updated since the last run."
              actions={
                <>
                  <Button variant="secondary" disabled={!s.connected || busy} loading={runSync.isPending} onClick={() => runSync.mutate()} icon={<RefreshCw className="size-4" />}>
                    Sync
                  </Button>
                  <Button disabled={!s.connected || busy} loading={runImport.isPending} onClick={() => runImport.mutate()} icon={<DownloadCloud className="size-4" />}>
                    Import all
                  </Button>
                </>
              }
            />
            <CardBody className="space-y-4">
              {s.activeRun && (
                <div className="rounded-lg border border-brand-100 bg-brand-50 p-3" aria-live="polite">
                  <RunSummary run={s.activeRun} />
                </div>
              )}
              {s.recentRuns.length === 0 ? (
                <p className="text-sm text-slate-500">No imports yet.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {s.recentRuns.filter((r) => r.id !== s.activeRun?.id).map((r) => (
                    <li key={r.id} className="py-3 first:pt-0"><RunSummary run={r} /></li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>

        <Card>
          <CardHeader title="Permissions" description="Scopes requested from Shopify" />
          <CardBody>
            <ul className="space-y-2 text-sm">
              {s.requiredScopes.map((scope) => {
                const missing = s.missingScopes.includes(scope);
                return (
                  <li key={scope} className="flex items-center justify-between">
                    <code className="text-xs">{scope}</code>
                    <span className={missing ? 'text-red-600' : 'text-emerald-600'}>{store ? (missing ? 'Missing' : 'Granted') : humanize('not_connected')}</span>
                  </li>
                );
              })}
            </ul>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
