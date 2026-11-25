import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { Link, useLocation, useParams } from 'react-router';
import { ordersApi } from '@/api/crm.api';
import { StatusBadge } from '@/components/ui/Badge';
import { Card, CardBody, CardHeader, DescriptionList, PageHeader } from '@/components/ui/Card';
import { EmptyState, ErrorState, Spinner } from '@/components/ui/states';
import { ApiError } from '@/lib/api-client';
import { formatDate, formatMoney, humanize } from '@/lib/format';
import type { Address } from '@/types/orders';

function AddressBlock({ address }: { address: Address | null }) {
  if (!address) return <p className="text-sm text-slate-400">Not provided</p>;
  const lines = [
    address.name ?? [address.firstName, address.lastName].filter(Boolean).join(' '),
    address.company,
    address.address1,
    address.address2,
    [address.city, address.provinceCode ?? address.province, address.zip].filter(Boolean).join(', '),
    address.country ?? address.countryCode,
    address.phone,
  ].filter(Boolean);
  return (
    <address className="text-sm leading-6 not-italic text-slate-700">
      {lines.map((l, i) => (
        <div key={i}>{l}</div>
      ))}
    </address>
  );
}

export function OrderDetailsPage() {
  const { id = '' } = useParams();
  const location = useLocation();
  const returnTo = (location.state as { returnTo?: string } | null)?.returnTo ?? '/orders';
  const order = useQuery({ queryKey: ['order', id], queryFn: () => ordersApi.get(id) });

  const back = (
    <Link to={returnTo} className="mb-4 inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900">
      <ArrowLeft className="size-4" aria-hidden /> Back to orders
    </Link>
  );

  if (order.isLoading) return <>{back}<Spinner label="Loading order" /></>;
  if (order.isError) {
    const notFound = order.error instanceof ApiError && (order.error.status === 404 || order.error.status === 400);
    return (
      <>
        {back}
        <Card>
          {notFound ? <EmptyState title="Order not found" description="It may have been removed or the link is incorrect." /> : <ErrorState error={order.error} onRetry={() => void order.refetch()} />}
        </Card>
      </>
    );
  }
  const o = order.data!;
  const cur = o.payment.currency;
  const adminUrl = o.shopifyLegacyId && o.store.connectionStatus === 'CONNECTED' ? `https://${o.store.shopDomain}/admin/orders/${o.shopifyLegacyId}` : null;

  return (
    <>
      {back}
      <PageHeader
        title={`Order ${o.orderNumber}`}
        description={<>Placed {formatDate(o.orderDate, true)} · Source: {humanize(o.source)}</>}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={o.orderStatus} />
            <StatusBadge status={o.fulfillmentStatus} />
            <StatusBadge status={o.financialStatus} />
            {adminUrl && (
              <a href={adminUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:underline">
                Open in Shopify <ExternalLink className="size-3.5" aria-hidden />
              </a>
            )}
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Line items" description={`${o.items.length} item${o.items.length === 1 ? '' : 's'}`} />
            {o.items.length === 0 ? (
              <EmptyState title="No line items" />
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th scope="col" className="px-5 py-3 font-medium">Product</th>
                      <th scope="col" className="px-5 py-3 font-medium">SKU</th>
                      <th scope="col" className="px-5 py-3 text-right font-medium">Qty</th>
                      <th scope="col" className="px-5 py-3 text-right font-medium">Unit price</th>
                      <th scope="col" className="px-5 py-3 text-right font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {o.items.map((i) => (
                      <tr key={i.id}>
                        <td className="px-5 py-3">
                          <div className="font-medium text-slate-900">{i.productName}</div>
                          {i.variantName && <div className="text-xs text-slate-500">{i.variantName}</div>}
                          <div className="mt-1 font-mono text-[11px] break-all text-slate-400">
                            {i.shopifyProductId ?? 'product: —'} · {i.shopifyVariantId ?? 'variant: —'}
                          </div>
                        </td>
                        <td className="px-5 py-3 text-slate-600">{i.sku ?? '—'}</td>
                        <td className="px-5 py-3 text-right tabular-nums">{i.quantity}</td>
                        <td className="px-5 py-3 text-right tabular-nums">{formatMoney(i.unitPrice, cur)}</td>
                        <td className="px-5 py-3 text-right tabular-nums">
                          {formatMoney(i.totalPrice, cur)}
                          {Number(i.totalDiscount) > 0 && <div className="text-xs text-emerald-600">−{formatMoney(i.totalDiscount, cur)}</div>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card>
            <CardHeader title="Order information" />
            <CardBody>
              <DescriptionList
                items={[
                  { label: 'Order number', value: o.orderNumber },
                  { label: 'Shopify order ID', value: <span className="font-mono text-xs">{o.shopifyOrderId}</span> },
                  { label: 'Order date', value: formatDate(o.orderDate, true) },
                  { label: 'Order status', value: <StatusBadge status={o.orderStatus} /> },
                  { label: 'Fulfillment status', value: <StatusBadge status={o.fulfillmentStatus} /> },
                  { label: 'Store', value: o.store.shopDomain },
                  ...(o.cancelledAt ? [{ label: 'Cancelled at', value: formatDate(o.cancelledAt, true) }] : []),
                  { label: 'Last synchronised', value: formatDate(o.lastSyncedAt, true) },
                  ...(o.tags.length ? [{ label: 'Tags', value: o.tags.join(', ') }] : []),
                  ...(o.note ? [{ label: 'Note', value: o.note }] : []),
                ]}
              />
            </CardBody>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Payment" description={<StatusBadge status={o.payment.financialStatus} />} />
            <CardBody>
              <dl className="space-y-2 text-sm">
                {[
                  ['Subtotal', o.payment.subtotal],
                  ['Discounts', o.payment.totalDiscount, true],
                  ['Shipping', o.payment.shippingAmount],
                  ['Taxes', o.payment.totalTax],
                ].map(([label, value, negative]) => (
                  <div key={label as string} className="flex justify-between">
                    <dt className="text-slate-600">{label}</dt>
                    <dd className="tabular-nums">{negative && Number(value) > 0 ? '−' : ''}{formatMoney(value as string, cur)}</dd>
                  </div>
                ))}
                <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-semibold">
                  <dt>Total</dt>
                  <dd className="tabular-nums">{formatMoney(o.payment.totalAmount, cur)}</dd>
                </div>
                <div className="flex justify-between text-xs text-slate-500">
                  <dt>Currency</dt>
                  <dd>{cur}</dd>
                </div>
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Customer" />
            <CardBody className="space-y-4">
              <DescriptionList
                items={[
                  { label: 'Name', value: o.customer.name ?? 'Guest' },
                  { label: 'Email', value: o.customer.email ? <a className="text-brand-600 hover:underline" href={`mailto:${o.customer.email}`}>{o.customer.email}</a> : '—' },
                  { label: 'Phone', value: o.customer.phone ?? '—' },
                ]}
              />
              <div>
                <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Billing address</h3>
                <AddressBlock address={o.billingAddress} />
              </div>
              <div>
                <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Shipping address</h3>
                <AddressBlock address={o.shippingAddress} />
              </div>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
