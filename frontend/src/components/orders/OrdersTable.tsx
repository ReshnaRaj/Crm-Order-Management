import { ArrowDown, ArrowUp, ArrowUpDown, Eye } from 'lucide-react';
import { Link } from 'react-router';
import { StatusBadge } from '@/components/ui/Badge';
import { formatDate, formatMoney } from '@/lib/format';
import type { OrderListItem } from '@/types/orders';

type SortField = 'orderDate' | 'totalAmount';

interface Props {
  orders: OrderListItem[];
  sort?: { by: SortField; order: 'asc' | 'desc'; onChange: (by: SortField) => void };
  /** query string appended to detail links so "back" restores the list state */
  returnTo?: string;
}

function SortHeader({ field, label, sort, align = 'left' }: { field: SortField; label: string; sort: Props['sort']; align?: 'left' | 'right' }) {
  if (!sort) return <>{label}</>;
  const active = sort.by === field;
  const Icon = !active ? ArrowUpDown : sort.order === 'asc' ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      onClick={() => sort.onChange(field)}
      className={`inline-flex items-center gap-1 font-medium hover:text-slate-900 ${align === 'right' ? 'flex-row-reverse' : ''}`}
      aria-label={`Sort by ${label}${active ? (sort.order === 'asc' ? ', ascending' : ', descending') : ''}`}
    >
      {label}
      <Icon className={`size-3.5 ${active ? 'text-brand-600' : 'text-slate-400'}`} aria-hidden />
    </button>
  );
}

export function OrdersTable({ orders, sort, returnTo }: Props) {
  const ariaSort = (f: SortField) =>
    sort?.by === f ? (sort.order === 'asc' ? 'ascending' : 'descending') : undefined;
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th scope="col" className="px-5 py-3 font-medium">Order</th>
            <th scope="col" className="px-5 py-3" aria-sort={ariaSort('orderDate')}>
              <SortHeader field="orderDate" label="Date" sort={sort} />
            </th>
            <th scope="col" className="px-5 py-3 font-medium">Customer</th>
            <th scope="col" className="px-5 py-3 font-medium">Status</th>
            <th scope="col" className="px-5 py-3 font-medium">Fulfillment</th>
            <th scope="col" className="px-5 py-3 text-right" aria-sort={ariaSort('totalAmount')}>
              <SortHeader field="totalAmount" label="Total" sort={sort} align="right" />
            </th>
            <th scope="col" className="px-5 py-3 font-medium">Currency</th>
            <th scope="col" className="px-5 py-3 text-right font-medium">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {orders.map((o) => (
            <tr key={o.id} className="hover:bg-slate-50">
              <td className="px-5 py-3 font-medium whitespace-nowrap text-slate-900">
                <Link to={`/orders/${o.id}`} state={{ returnTo }} className="hover:text-brand-600">
                  {o.orderNumber}
                </Link>
                {o.source === 'CRM' && (
                  <span className="ml-2 rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-semibold text-brand-700">CRM</span>
                )}
              </td>
              <td className="px-5 py-3 whitespace-nowrap text-slate-600">{formatDate(o.orderDate, true)}</td>
              <td className="px-5 py-3">
                <div className="text-slate-900">{o.customerName ?? <span className="text-slate-400">Guest</span>}</div>
                {o.email && <div className="text-xs text-slate-500">{o.email}</div>}
              </td>
              <td className="px-5 py-3"><StatusBadge status={o.orderStatus} /></td>
              <td className="px-5 py-3"><StatusBadge status={o.fulfillmentStatus} /></td>
              <td className="px-5 py-3 text-right font-medium whitespace-nowrap tabular-nums">
                {formatMoney(o.totalAmount, o.currency)}
              </td>
              <td className="px-5 py-3 text-slate-600">{o.currency}</td>
              <td className="px-5 py-3 text-right">
                <Link
                  to={`/orders/${o.id}`}
                  state={{ returnTo }}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-brand-600 hover:bg-brand-50"
                  aria-label={`View order ${o.orderNumber}`}
                >
                  <Eye className="size-3.5" aria-hidden /> View
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
