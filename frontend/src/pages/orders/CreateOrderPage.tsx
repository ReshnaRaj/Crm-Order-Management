import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { useFieldArray, useForm, useWatch, type FieldErrors, type UseFormRegister } from 'react-hook-form';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { ordersApi, shopifyApi } from '@/api/crm.api';
import { CustomerPicker } from '@/components/orders/CustomerPicker';
import { ProductPicker } from '@/components/orders/ProductPicker';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/Card';
import { Field, Input, Textarea } from '@/components/ui/form';
import { EmptyState, Spinner } from '@/components/ui/states';
import { ApiError, errorMessage } from '@/lib/api-client';
import { formatMoney } from '@/lib/format';
import { createOrderSchema, type CreateOrderForm } from '@/schemas/order.schema';
import type { Address, CreateOrderPayload, Customer, OrderCreationResult } from '@/types/orders';

const emptyAddress = { company: '', address1: '', address2: '', city: '', provinceCode: '', countryCode: '', zip: '', phone: '' };
const defaults: CreateOrderForm = {
  customer: { existingCustomerId: undefined, firstName: '', lastName: '', email: '', phone: '' },
  billingAddress: emptyAddress,
  sameAsBilling: true,
  shippingAddress: emptyAddress,
  lineItems: [],
  shippingTitle: '',
  shippingAmount: '',
  discountCode: '',
  discountAmount: '',
  note: '',
};

const blankToUndef = <T extends Record<string, unknown>>(o: T) => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== '' && v !== undefined && v !== null) out[k] = v;
  return out as Partial<T>;
};
const toAddress = (a: CreateOrderForm['billingAddress']): Address | undefined => {
  const clean = blankToUndef(a);
  if (!clean.address1) return undefined;
  return { ...clean, countryCode: clean.countryCode?.toUpperCase() } as Address;
};
const fromCustomerAddress = (a: Address | null) => ({
  ...emptyAddress,
  company: a?.company ?? '',
  address1: a?.address1 ?? '',
  address2: a?.address2 ?? '',
  city: a?.city ?? '',
  provinceCode: a?.provinceCode ?? '',
  countryCode: a?.countryCode ?? '',
  zip: a?.zip ?? '',
  phone: a?.phone ?? '',
});

function AddressFields({
  prefix,
  register,
  errors,
}: {
  prefix: 'billingAddress' | 'shippingAddress';
  register: UseFormRegister<CreateOrderForm>;
  errors?: FieldErrors<CreateOrderForm['billingAddress']>;
}) {
  const f = (name: keyof CreateOrderForm['billingAddress'], label: string, opts: { className?: string; placeholder?: string; autoComplete?: string } = {}) => (
    <Field label={label} error={errors?.[name]?.message} className={opts.className}>
      {(id, d) => <Input id={id} aria-describedby={d} aria-invalid={!!errors?.[name]} placeholder={opts.placeholder} autoComplete={opts.autoComplete} {...register(`${prefix}.${name}`)} />}
    </Field>
  );
  return (
    <div className="grid gap-4 sm:grid-cols-6">
      {f('address1', 'Address', { className: 'sm:col-span-4', autoComplete: 'address-line1' })}
      {f('address2', 'Apt / suite', { className: 'sm:col-span-2', autoComplete: 'address-line2' })}
      {f('city', 'City', { className: 'sm:col-span-2', autoComplete: 'address-level2' })}
      {f('provinceCode', 'State / province code', { className: 'sm:col-span-2', placeholder: 'CA' })}
      {f('zip', 'Postal code', { className: 'sm:col-span-2', autoComplete: 'postal-code' })}
      {f('countryCode', 'Country code', { className: 'sm:col-span-2', placeholder: 'US' })}
      {f('company', 'Company', { className: 'sm:col-span-2' })}
      {f('phone', 'Phone', { className: 'sm:col-span-2', placeholder: '+14155550123' })}
    </div>
  );
}

export function CreateOrderPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  // One idempotency key per submission attempt: double clicks / retries can't create two orders.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [pending, setPending] = useState<OrderCreationResult | null>(null);

  const status = useQuery({ queryKey: ['shopify', 'status'], queryFn: shopifyApi.status });
  const currency = status.data?.store?.currency ?? 'USD';

  const form = useForm<CreateOrderForm>({ resolver: zodResolver(createOrderSchema), defaultValues: defaults, mode: 'onTouched' });
  const { register, control, handleSubmit, setValue, formState: { errors } } = form;
  const lineItems = useFieldArray({ control, name: 'lineItems' });
  const watched = useWatch({ control });
  const existingCustomerId = watched.customer?.existingCustomerId;

  const subtotal = (watched.lineItems ?? []).reduce((s, li) => s + Number(li?.price ?? 0) * (Number(li?.quantity) || 0), 0);
  const shipping = Number(watched.shippingAmount) || 0;
  const discount = Math.min(Number(watched.discountAmount) || 0, subtotal);
  const total = subtotal - discount + shipping;

  const finish = (r: OrderCreationResult) => {
    void qc.invalidateQueries({ queryKey: ['orders'] });
    toast.success(r.replayed ? 'This order was already created' : `Order ${r.order?.orderNumber ?? ''} created in Shopify`);
    setIdempotencyKey(crypto.randomUUID());
    void navigate(r.order ? `/orders/${r.order.id}` : '/orders');
  };

  const create = useMutation({
    mutationFn: ordersApi.create,
    onSuccess: (r) => {
      if (r.status === 'SUCCEEDED') return finish(r);
      setPending(r); // UNKNOWN: Shopify didn't confirm in time – keep the key, never resubmit blindly
      toast.warning(r.message);
    },
    onError: (e) => {
      toast.error(errorMessage(e, 'Order could not be created'));
      // In-progress duplicates keep their key; definitive failures get a fresh one.
      if (!(e instanceof ApiError && e.code === 'ORDER_CREATION_IN_PROGRESS')) setIdempotencyKey(crypto.randomUUID());
    },
  });
  const reconcile = useMutation({
    mutationFn: () => ordersApi.reconcile(pending!.requestId),
    onSuccess: (r) => {
      if (r.status === 'SUCCEEDED') {
        setPending(null);
        return finish(r);
      }
      if (r.status === 'FAILED') {
        setPending(null);
        setIdempotencyKey(crypto.randomUUID());
        toast.error(r.message);
        return;
      }
      setPending(r);
      toast.info('Still waiting for Shopify to confirm. Try again in a minute.');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const onSubmit = handleSubmit((v) => {
    if (create.isPending || pending) return;
    const payload: CreateOrderPayload = {
      idempotencyKey,
      customer: blankToUndef(v.customer) as CreateOrderPayload['customer'],
      billingAddress: toAddress(v.billingAddress),
      shippingAddress: v.sameAsBilling ? undefined : toAddress(v.shippingAddress),
      lineItems: v.lineItems.map((l) => ({ variantId: l.variantId, quantity: l.quantity })),
      shippingLine: shipping > 0 && v.shippingTitle ? { title: v.shippingTitle, amount: shipping.toFixed(2) } : undefined,
      discount: discount > 0 && v.discountCode ? { code: v.discountCode, amount: discount.toFixed(2) } : undefined,
      note: v.note || undefined,
    };
    create.mutate(payload);
  });

  const selectCustomer = (c: Customer) => {
    setValue('customer', {
      existingCustomerId: c.id,
      firstName: c.firstName ?? c.name?.split(' ')[0] ?? '',
      lastName: c.lastName ?? c.name?.split(' ').slice(1).join(' ') ?? '',
      email: c.email ?? '',
      phone: c.phone ?? '',
    }, { shouldValidate: true });
    if (c.billingAddress) setValue('billingAddress', fromCustomerAddress(c.billingAddress));
    if (c.shippingAddress) {
      setValue('shippingAddress', fromCustomerAddress(c.shippingAddress));
      setValue('sameAsBilling', JSON.stringify(c.shippingAddress) === JSON.stringify(c.billingAddress));
    }
    toast.success(`Selected ${c.name ?? 'customer'}`);
  };

  if (status.isLoading) return <Spinner label="Checking Shopify connection" />;
  if (!status.data?.connected) {
    return (
      <>
        <PageHeader title="Create order" />
        <Card>
          <EmptyState
            title="Shopify is not connected"
            description="Orders are created directly in Shopify, so a connected store is required."
            action={<Link to="/integrations/shopify" className="text-sm font-medium text-brand-600 hover:underline">Connect a store</Link>}
          />
        </Card>
      </>
    );
  }

  const submitting = create.isPending;
  const locked = submitting || Boolean(pending);

  return (
    <>
      <PageHeader title="Create order" description={`The order is created in ${status.data.store?.shopDomain} with payment status “pending”. No payment is captured.`} />

      {pending && (
        <div role="alert" className="mb-6 flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <div>
              <p className="font-medium">Waiting for Shopify confirmation</p>
              <p>{pending.message} The CRM keeps checking automatically.</p>
            </div>
          </div>
          <Button variant="secondary" onClick={() => reconcile.mutate()} loading={reconcile.isPending}>Check status</Button>
        </div>
      )}

      <form onSubmit={onSubmit} noValidate>
        <fieldset disabled={locked} className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <Card>
              <CardHeader title="Customer" description="Select an existing customer or enter new details (a Shopify customer is created/updated by email)." />
              <CardBody className="space-y-4">
                <CustomerPicker onSelect={selectCustomer} />
                {existingCustomerId && (
                  <div className="flex items-center justify-between rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-800">
                    <span className="flex items-center gap-2"><CheckCircle2 className="size-4" aria-hidden /> Linked to existing Shopify customer</span>
                    <button type="button" className="rounded p-1 hover:bg-brand-100" aria-label="Unlink customer" onClick={() => setValue('customer.existingCustomerId', undefined)}>
                      <X className="size-4" />
                    </button>
                  </div>
                )}
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="First name" error={errors.customer?.firstName?.message} required>
                    {(id, d) => <Input id={id} aria-describedby={d} aria-invalid={!!errors.customer?.firstName} autoComplete="given-name" {...register('customer.firstName')} />}
                  </Field>
                  <Field label="Last name" error={errors.customer?.lastName?.message} required>
                    {(id, d) => <Input id={id} aria-describedby={d} aria-invalid={!!errors.customer?.lastName} autoComplete="family-name" {...register('customer.lastName')} />}
                  </Field>
                  <Field label="Email" error={errors.customer?.email?.message}>
                    {(id, d) => <Input id={id} type="email" aria-describedby={d} aria-invalid={!!errors.customer?.email} autoComplete="email" {...register('customer.email')} />}
                  </Field>
                  <Field label="Phone" error={errors.customer?.phone?.message} hint="International format">
                    {(id, d) => <Input id={id} type="tel" aria-describedby={d} aria-invalid={!!errors.customer?.phone} placeholder="+14155550123" {...register('customer.phone')} />}
                  </Field>
                </div>
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Billing address" description="Optional" />
              <CardBody><AddressFields prefix="billingAddress" register={register} errors={errors.billingAddress} /></CardBody>
            </Card>

            <Card>
              <CardHeader
                title="Shipping address"
                actions={
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input type="checkbox" className="size-4 rounded border-slate-300 text-brand-600" {...register('sameAsBilling')} />
                    Same as billing
                  </label>
                }
              />
              {!watched.sameAsBilling && <CardBody><AddressFields prefix="shippingAddress" register={register} errors={errors.shippingAddress} /></CardBody>}
            </Card>

            <Card>
              <CardHeader title="Products" description="Search the Shopify catalogue and add variants." />
              <CardBody className="space-y-5">
                <ProductPicker
                  selectedVariantIds={lineItems.fields.map((f) => f.variantId)}
                  onAdd={(p, v) => {
                    const idx = lineItems.fields.findIndex((f) => f.variantId === v.id);
                    if (idx >= 0) {
                      const current = Number(form.getValues(`lineItems.${idx}.quantity`)) || 0;
                      setValue(`lineItems.${idx}.quantity`, current + 1, { shouldValidate: true });
                    } else {
                      lineItems.append({ variantId: v.id, productTitle: p.title, variantTitle: v.title, sku: v.sku, price: v.price, quantity: 1 });
                    }
                  }}
                />
                {errors.lineItems?.message && <p role="alert" className="text-sm text-red-600">{errors.lineItems.message}</p>}
                {lineItems.fields.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                        <tr>
                          <th scope="col" className="py-2 font-medium">Item</th>
                          <th scope="col" className="py-2 text-right font-medium">Price</th>
                          <th scope="col" className="w-28 py-2 text-right font-medium">Qty</th>
                          <th scope="col" className="py-2 text-right font-medium">Total</th>
                          <th scope="col" className="py-2"><span className="sr-only">Remove</span></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {lineItems.fields.map((f, i) => {
                          const qty = Number(watched.lineItems?.[i]?.quantity) || 0;
                          const qtyError = errors.lineItems?.[i]?.quantity?.message;
                          return (
                            <tr key={f.id}>
                              <td className="py-2 pr-3">
                                <div className="font-medium text-slate-900">{f.productTitle}</div>
                                <div className="text-xs text-slate-500">{f.variantTitle === 'Default Title' ? 'Default' : f.variantTitle}{f.sku ? ` · ${f.sku}` : ''}</div>
                              </td>
                              <td className="py-2 text-right tabular-nums">{formatMoney(f.price, currency)}</td>
                              <td className="py-2 text-right">
                                <Input
                                  type="number"
                                  min={1}
                                  max={1000}
                                  aria-label={`Quantity for ${f.productTitle}`}
                                  aria-invalid={!!qtyError}
                                  className="ml-auto h-8 w-20 text-right"
                                  {...register(`lineItems.${i}.quantity`, { valueAsNumber: true })}
                                />
                                {qtyError && <p className="mt-1 text-xs text-red-600">{qtyError}</p>}
                              </td>
                              <td className="py-2 text-right tabular-nums">{formatMoney(Number(f.price) * qty, currency)}</td>
                              <td className="py-2 pl-2 text-right">
                                <Button variant="ghost" size="sm" aria-label={`Remove ${f.productTitle}`} onClick={() => lineItems.remove(i)} icon={<Trash2 className="size-4 text-red-500" />} />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardBody>
            </Card>
          </div>

          <div className="space-y-6">
            <Card className="lg:sticky lg:top-20">
              <CardHeader title="Order summary" />
              <CardBody className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Shipping method" error={errors.shippingTitle?.message}>
                    {(id, d) => <Input id={id} aria-describedby={d} placeholder="Standard" {...register('shippingTitle')} />}
                  </Field>
                  <Field label="Shipping charge" error={errors.shippingAmount?.message}>
                    {(id, d) => <Input id={id} aria-describedby={d} inputMode="decimal" placeholder="0.00" {...register('shippingAmount')} />}
                  </Field>
                  <Field label="Discount code" error={errors.discountCode?.message}>
                    {(id, d) => <Input id={id} aria-describedby={d} placeholder="CRM10" {...register('discountCode')} />}
                  </Field>
                  <Field label="Discount amount" error={errors.discountAmount?.message}>
                    {(id, d) => <Input id={id} aria-describedby={d} inputMode="decimal" placeholder="0.00" {...register('discountAmount')} />}
                  </Field>
                </div>
                <Field label="Note" error={errors.note?.message}>
                  {(id, d) => <Textarea id={id} aria-describedby={d} rows={3} {...register('note')} />}
                </Field>

                <dl className="space-y-2 border-t border-slate-100 pt-4 text-sm">
                  <div className="flex justify-between"><dt className="text-slate-600">Items ({lineItems.fields.length})</dt><dd className="tabular-nums">{formatMoney(subtotal, currency)}</dd></div>
                  <div className="flex justify-between"><dt className="text-slate-600">Discount</dt><dd className="tabular-nums">{discount ? `−${formatMoney(discount, currency)}` : '—'}</dd></div>
                  <div className="flex justify-between"><dt className="text-slate-600">Shipping</dt><dd className="tabular-nums">{shipping ? formatMoney(shipping, currency) : '—'}</dd></div>
                  <div className="flex justify-between"><dt className="text-slate-600">Taxes</dt><dd className="text-xs text-slate-500">Not applied</dd></div>
                  <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-semibold"><dt>Estimated total</dt><dd className="tabular-nums">{formatMoney(total, currency)}</dd></div>
                  <div className="flex justify-between text-xs text-slate-500"><dt>Currency</dt><dd>{currency}</dd></div>
                </dl>
                <p className="text-xs text-slate-500">Prices come from Shopify; the final totals are those Shopify calculates.</p>
                <Button type="submit" className="w-full" loading={submitting} disabled={locked}>
                  {submitting ? 'Creating in Shopify…' : 'Create order'}
                </Button>
              </CardBody>
            </Card>
          </div>
        </fieldset>
      </form>
    </>
  );
}
