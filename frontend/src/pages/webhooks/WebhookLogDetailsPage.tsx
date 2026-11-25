import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, RotateCcw } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';
import { webhooksApi } from '@/api/crm.api';
import { StatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader, DescriptionList, PageHeader } from '@/components/ui/Card';
import { ErrorState, Spinner } from '@/components/ui/states';
import { errorMessage } from '@/lib/api-client';
import { formatDate, humanize } from '@/lib/format';

export function WebhookLogDetailsPage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const event = useQuery({ queryKey: ['webhook', id], queryFn: () => webhooksApi.get(id) });
  const retry = useMutation({
    mutationFn: () => webhooksApi.retry(id),
    onSuccess: (r) => {
      if (r.status === 'PROCESSED') toast.success('Event processed successfully');
      else toast.warning(`Retry finished with status: ${humanize(r.status)}`);
      void qc.invalidateQueries({ queryKey: ['webhook', id] });
      void qc.invalidateQueries({ queryKey: ['webhooks'] });
      void qc.invalidateQueries({ queryKey: ['orders'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const back = (
    <Link to="/webhooks" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900">
      <ArrowLeft className="size-4" aria-hidden /> Back to webhook logs
    </Link>
  );
  if (event.isLoading) return <>{back}<Spinner label="Loading event" /></>;
  if (event.isError) return <>{back}<Card><ErrorState error={event.error} onRetry={() => void event.refetch()} /></Card></>;
  const e = event.data!;
  const retryable = e.processingStatus === 'FAILED' || e.processingStatus === 'SKIPPED';

  return (
    <>
      {back}
      <PageHeader
        title={e.topic}
        description={<span className="font-mono text-xs">{e.shopifyEventId}</span>}
        actions={
          <>
            <StatusBadge status={e.processingStatus} />
            {retryable && (
              <Button onClick={() => retry.mutate()} loading={retry.isPending} icon={<RotateCcw className="size-4" />}>
                Retry now
              </Button>
            )}
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader title="Processing" />
          <CardBody>
            <DescriptionList
              items={[
                { label: 'Status', value: <StatusBadge status={e.processingStatus} /> },
                { label: 'Shop', value: e.shopDomain },
                { label: 'Shopify order ID', value: e.shopifyOrderId ? <span className="font-mono text-xs">{e.shopifyOrderId}</span> : '—' },
                { label: 'Correlation (event) ID', value: e.shopifyCorrelationId ? <span className="font-mono text-xs">{e.shopifyCorrelationId}</span> : '—' },
                { label: 'API version', value: e.apiVersion },
                { label: 'Triggered', value: formatDate(e.triggeredAt, true) },
                { label: 'Received', value: formatDate(e.receivedAt, true) },
                { label: 'Processed', value: formatDate(e.processedAt, true) },
                { label: 'Retry count', value: e.retryCount },
                { label: 'Next retry', value: formatDate(e.nextRetryAt, true) },
              ]}
            />
            {e.errorMessage && (
              <div role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm break-words text-red-700">{e.errorMessage}</div>
            )}
          </CardBody>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Payload" description="Body received from Shopify (verified by HMAC)" />
          <CardBody>
            <pre className="max-h-[36rem] overflow-auto rounded-lg bg-slate-900 p-4 text-xs leading-5 text-slate-100">
              {JSON.stringify(e.payload, null, 2)}
            </pre>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
