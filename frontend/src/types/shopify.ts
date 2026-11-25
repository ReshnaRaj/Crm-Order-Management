export type ConnectionStatus = 'PENDING' | 'CONNECTED' | 'DISCONNECTED' | 'INVALID_TOKEN' | 'ERROR';

export interface SyncRun {
  id: string;
  type: 'IMPORT' | 'SYNC';
  status: 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  ordersFetched: number;
  ordersCreated: number;
  ordersUpdated: number;
  ordersSkipped: number;
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface ShopifyStatus {
  connected: boolean;
  store: {
    id: string;
    shopDomain: string;
    name: string | null;
    currency: string | null;
    connectionStatus: ConnectionStatus;
    scopes: string[];
    lastError: string | null;
    lastSyncAt: string | null;
    webhooksRegisteredAt: string | null;
    connectedAt: string;
  } | null;
  requiredScopes: string[];
  missingScopes: string[];
  activeRun: SyncRun | null;
  lastRun: SyncRun | null;
  recentRuns: SyncRun[];
}

export interface ShopifyVariant {
  id: string;
  title: string;
  displayName: string;
  sku: string | null;
  price: string;
  inventoryQuantity: number | null;
  availableForSale: boolean;
}

export interface ShopifyProduct {
  id: string;
  title: string;
  status: string;
  imageUrl: string | null;
  variants: ShopifyVariant[];
}

export interface ProductsPage {
  products: ShopifyProduct[];
  hasNextPage: boolean;
  endCursor: string | null;
  currency: string | null;
}
