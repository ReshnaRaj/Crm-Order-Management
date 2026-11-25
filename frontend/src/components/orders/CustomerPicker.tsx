import { useQuery } from '@tanstack/react-query';
import { UserSearch } from 'lucide-react';
import { useState } from 'react';
import { customersApi } from '@/api/crm.api';
import { Input } from '@/components/ui/form';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import type { Customer } from '@/types/orders';

/** Typeahead over customers already known to the CRM (synced from Shopify). */
export function CustomerPicker({ onSelect }: { onSelect: (c: Customer) => void }) {
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const debounced = useDebouncedValue(term.trim(), 300);
  const results = useQuery({
    queryKey: ['customers', debounced],
    queryFn: ({ signal }) => customersApi.search(debounced, signal),
    enabled: debounced.length >= 2,
  });

  return (
    <div className="relative">
      <UserSearch className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
      <Input
        role="combobox"
        aria-expanded={open && debounced.length >= 2}
        aria-controls="customer-results"
        aria-label="Search existing customers"
        placeholder="Search existing customers by name, email or phone…"
        className="pl-9"
        value={term}
        onChange={(e) => {
          setTerm(e.target.value);
          setOpen(true);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onFocus={() => setOpen(true)}
      />
      {open && debounced.length >= 2 && (
        <ul id="customer-results" role="listbox" className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          {results.isLoading ? (
            <li className="px-3 py-2 text-sm text-slate-500">Searching…</li>
          ) : !results.data?.length ? (
            <li className="px-3 py-2 text-sm text-slate-500">No customers found – fill in the details below to create one.</li>
          ) : (
            results.data.map((c) => (
              <li key={c.id} role="option" aria-selected={false}>
                <button
                  type="button"
                  className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onSelect(c);
                    setTerm('');
                    setOpen(false);
                  }}
                >
                  <div className="font-medium text-slate-900">{c.name ?? 'Unnamed customer'}</div>
                  <div className="text-xs text-slate-500">{[c.email, c.phone].filter(Boolean).join(' · ') || 'No contact details'}</div>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
