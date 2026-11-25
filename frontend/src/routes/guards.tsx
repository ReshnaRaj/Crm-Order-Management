import { Navigate, Outlet, useLocation } from 'react-router';
import { Spinner } from '@/components/ui/states';
import { useAuth } from '@/hooks/useAuth';

/** Only renders child routes for authenticated users; otherwise redirects to /login. */
export function ProtectedRoute() {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();
  if (isLoading) return <Spinner label="Restoring session" />;
  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return <Outlet />;
}

/**
 * Login/register pages: bounce authenticated users away. After a successful login this is
 * what performs the redirect, so it must honour the page the user originally requested.
 */
export function GuestRoute() {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();
  if (isLoading) return <Spinner label="Restoring session" />;
  if (!isAuthenticated) return <Outlet />;
  const from = (location.state as { from?: string } | null)?.from;
  const safeFrom = from && from.startsWith('/') && !from.startsWith('//') ? from : '/dashboard';
  return <Navigate to={safeFrom} replace />;
}
