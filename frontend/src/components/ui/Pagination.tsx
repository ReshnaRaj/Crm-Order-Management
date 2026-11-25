import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { PaginationMeta } from '@/types/common';
import { Button } from './Button';
import { Select } from './form';

interface Props {
  meta: PaginationMeta;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  pageSizeOptions?: number[];
}

export function Pagination({
  meta,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 20, 50, 100],
}: Props) {
  const from = meta.totalItems === 0 ? 0 : (meta.page - 1) * meta.pageSize + 1;
  const to = Math.min(meta.page * meta.pageSize, meta.totalItems);
  return (
    <nav
      aria-label="Pagination"
      className="flex flex-col gap-3 border-t border-slate-100 px-5 py-3 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between"
    >
      <p>
        Showing <span className="font-medium text-slate-900">{from}</span>–
        <span className="font-medium text-slate-900">{to}</span> of{' '}
        <span className="font-medium text-slate-900">{meta.totalItems}</span>
      </p>
      <div className="flex items-center gap-3">
        {onPageSizeChange && (
          <label className="flex items-center gap-2">
            <span className="whitespace-nowrap">Rows per page</span>
            <Select
              className="h-8 w-20"
              value={meta.pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
            >
              {pageSizeOptions.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </label>
        )}
        <span className="whitespace-nowrap">
          Page {meta.page} of {meta.totalPages}
        </span>
        <div className="flex gap-1">
          <Button
            variant="secondary"
            size="sm"
            aria-label="Previous page"
            disabled={!meta.hasPreviousPage}
            onClick={() => onPageChange(meta.page - 1)}
            icon={<ChevronLeft className="size-4" />}
          />
          <Button
            variant="secondary"
            size="sm"
            aria-label="Next page"
            disabled={!meta.hasNextPage}
            onClick={() => onPageChange(meta.page + 1)}
            icon={<ChevronRight className="size-4" />}
          />
        </div>
      </div>
    </nav>
  );
}
