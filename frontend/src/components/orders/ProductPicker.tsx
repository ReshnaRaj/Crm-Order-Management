import { useQuery } from '@tanstack/react-query';
import { Package, Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { shopifyApi } from '@/api/crm.api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/form';
import { ErrorState, Spinner } from '@/components/ui/states';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { formatMoney } from '@/lib/format';
import type { ShopifyProduct, ShopifyVariant } from '@/types/shopify';

interface Props {
  onAdd: (product: ShopifyProduct, variant: ShopifyVariant) => void;
  selectedVariantIds: string[];
}

/** Live product search against the connected Shopify store. */
export function ProductPicker({ onAdd, selectedVariantIds }: Props) {
  const [search, setSearch] = useState('');
  const debounced = useDebouncedValue(search.trim(), 350);
  const products = useQuery({
    queryKey: ['shopify', 'products', debounced],
    queryFn: ({ signal }) => shopifyApi.products(debounced, signal),
    staleTime: 60_000,
  });

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
        <Input aria-label="Search products" placeholder="Search products by title or SKU…" className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <div className="max-h-80 overflow-y-auto rounded-lg border border-slate-200">
        {products.isLoading ? (
          <Spinner label="Searching products" />
        ) : products.isError ? (
          <ErrorState error={products.error} onRetry={() => void products.refetch()} />
        ) : !products.data?.products.length ? (
          <p className="p-6 text-center text-sm text-slate-500">No active products found.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {products.data.products.map((p) => (
              <li key={p.id} className="p-3">
                <div className="mb-2 flex items-center gap-3">
                  {p.imageUrl ? (
                    <img src={p.imageUrl} alt="" className="size-9 rounded object-cover" />
                  ) : (
                    <div className="grid size-9 place-items-center rounded bg-slate-100 text-slate-400"><Package className="size-4" /></div>
                  )}
                  <span className="text-sm font-medium text-slate-900">{p.title}</span>
                </div>
                <ul className="space-y-1">
                  {p.variants.map((v) => {
                    const added = selectedVariantIds.includes(v.id);
                    return (
                      <li key={v.id} className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-slate-50">
                        <div className="min-w-0">
                          <span className="text-slate-700">{v.title === 'Default Title' ? 'Default' : v.title}</span>
                          <span className="ml-2 text-xs text-slate-500">
                            {v.sku ? `SKU ${v.sku}` : 'No SKU'}
                            {v.inventoryQuantity !== null && ` · ${v.inventoryQuantity} in stock`}
                          </span>
                        </div>
                        <div className="flex shrink-0 items-center gap-3">
                          <span className="tabular-nums">{formatMoney(v.price, products.data.currency)}</span>
                          <Button
                            size="sm"
                            variant={added ? 'secondary' : 'primary'}
                            disabled={!v.availableForSale}
                            onClick={() => onAdd(p, v)}
                            icon={<Plus className="size-3.5" />}
                            aria-label={`Add ${p.title} ${v.title}`}
                          >
                            {!v.availableForSale ? 'Unavailable' : added ? 'Add another' : 'Add'}
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
