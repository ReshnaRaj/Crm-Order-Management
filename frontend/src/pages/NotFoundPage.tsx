import { Link } from 'react-router';
import { EmptyState } from '@/components/ui/states';

export function NotFoundPage() {
  return (
    <EmptyState
      title="Page not found"
      description="The page you are looking for does not exist."
      action={
        <Link to="/dashboard" className="text-sm font-medium text-brand-600 hover:underline">
          Back to dashboard
        </Link>
      }
    />
  );
}
