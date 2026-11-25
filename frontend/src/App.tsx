import { lazy, Suspense, type ComponentType } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { Spinner } from './components/ui/states';
import { AppLayout } from './layouts/AppLayout';
import { LoginPage } from './pages/auth/LoginPage';
import { RegisterPage } from './pages/auth/RegisterPage';
import { GuestRoute, ProtectedRoute } from './routes/guards';

/** Route-level code splitting for named page exports. */
const page = <K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) =>
  lazy(() => load().then((m) => ({ default: m[name] })));

const DashboardPage = page(() => import('./pages/DashboardPage'), 'DashboardPage');
const OrdersPage = page(() => import('./pages/orders/OrdersPage'), 'OrdersPage');
const CreateOrderPage = page(() => import('./pages/orders/CreateOrderPage'), 'CreateOrderPage');
const OrderDetailsPage = page(() => import('./pages/orders/OrderDetailsPage'), 'OrderDetailsPage');
const ShopifyIntegrationPage = page(() => import('./pages/ShopifyIntegrationPage'), 'ShopifyIntegrationPage');
const WebhookLogsPage = page(() => import('./pages/webhooks/WebhookLogsPage'), 'WebhookLogsPage');
const WebhookLogDetailsPage = page(() => import('./pages/webhooks/WebhookLogDetailsPage'), 'WebhookLogDetailsPage');
const SettingsPage = page(() => import('./pages/SettingsPage'), 'SettingsPage');
const NotFoundPage = page(() => import('./pages/NotFoundPage'), 'NotFoundPage');

export function App() {
  return (
    <Suspense fallback={<Spinner />}>
      <Routes>
        <Route element={<GuestRoute />}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
        </Route>
        <Route element={<ProtectedRoute />}>
          <Route element={<AppLayout />}>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/orders" element={<OrdersPage />} />
            <Route path="/orders/new" element={<CreateOrderPage />} />
            <Route path="/orders/:id" element={<OrderDetailsPage />} />
            <Route path="/integrations/shopify" element={<ShopifyIntegrationPage />} />
            <Route path="/webhooks" element={<WebhookLogsPage />} />
            <Route path="/webhooks/:id" element={<WebhookLogDetailsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Route>
      </Routes>
    </Suspense>
  );
}
