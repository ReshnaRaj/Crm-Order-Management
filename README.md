# Mini Order Management CRM

A CRM for managing Shopify orders. It connects to a real Shopify store through OAuth and imports orders through the Admin GraphQL API. Orders can be listed, searched, filtered, sorted, paginated and viewed in detail. New orders can be created in Shopify from the CRM. Orders stay in sync through HMAC-verified `orders/create` and `orders/updated` webhooks.

| Layer | Stack |
|---|---|
| Frontend | React 19, TypeScript, Vite 7, Tailwind CSS 4, React Router 7, TanStack Query 5, React Hook Form, Zod 4 |
| Backend | Node.js 24, NestJS 11, TypeScript, REST, Prisma 6, Swagger |
| Database | PostgreSQL 16 |
| Integration | Shopify Admin GraphQL API (default version `2026-10`), OAuth, webhooks |
| Auth | JWT (HS256) and Argon2id password hashing |
| Tests | Jest, Supertest (unit tests plus integration tests against a real PostgreSQL) |

---

## 1. Architecture: modular monolith

The backend is **one NestJS application** with one codebase, one process and one deployable artifact. Inside that process the features are split into NestJS modules. Each module has its own controllers, services and repositories, and dependency injection wires them together. All modules share a single Prisma connection and one configuration service. There are no microservices. Shopify is an external API that the integration layer calls; it is not a service of this project.

```
AppModule ──────────────────────────────────────────────── single NestJS process
 ├─ AppConfigModule (global)   typed, validated env configuration
 ├─ PrismaModule   (global)    one shared PrismaClient
 ├─ UsersModule                profile, password hashing
 ├─ AuthModule                 register/login/logout/me, global JWT guard
 ├─ CustomersModule            customer search (for the Create Order form)
 ├─ OrdersModule               listing/details/summary, order sync, CRM order creation
 │    └─ imports ShopifyIntegrationModule
 ├─ ShopifyModule              OAuth connect flow, status, import/sync runs, product search
 │    └─ imports ShopifyIntegrationModule, OrdersModule
 ├─ WebhooksModule             HMAC-protected receivers, processing, retries, logs API
 │    └─ imports ShopifyIntegrationModule, OrdersModule
 └─ ShopifyIntegrationModule   integration layer: GraphQL client, OAuth, API gateways,
                               webhook verifier, store repository (no business logic)
```

### Layer responsibilities

| Layer | Responsibility | Example |
|---|---|---|
| **Controller** | HTTP only: routing, DTO validation (`class-validator`), status codes, Swagger metadata. No business logic, no database access. | `orders.controller.ts` |
| **Service** | Business rules and workflows. Coordinates repositories and integrations and maps errors. No Prisma queries. | `order-creation.service.ts`, `order-sync.service.ts` |
| **Repository** | All Prisma access: queries, filtering, pagination, sorting, transactions, row locks. No business rules. | `orders.repository.ts`, `webhooks.repository.ts` |
| **Integration** | All communication with Shopify: auth headers, retries, rate limits, error classification, GraphQL documents, payload mapping. | `shopify.client.ts`, `shopify-orders.api.ts` |

Cross-cutting pieces live in `common/`:
- a global exception filter that produces the standard error envelope
- a response envelope interceptor
- a structured access-log interceptor
- the `@Public()` and `@CurrentUser()` decorators
- crypto and pagination utilities

### How the SOLID principles show up

- **Single responsibility.** Each concern has its own class. For example, the GraphQL transport (`ShopifyGraphQLClient`), the order queries (`ShopifyOrdersApi`), the OAuth flow (`ShopifyOAuthService`) and webhook HMAC checks (`ShopifyWebhookVerifier`) are separate classes.
- **Open/closed.** Webhook topics are handled by `WebhookTopicHandler` strategies. A new topic means registering a new handler; the processor does not change.
- **Liskov substitution.** The `ShopifyError` subclasses can stand in for each other wherever errors are classified. Every subclass carries `retryable` and `outcomeUnknown` flags that the retry and reconciliation logic relies on.
- **Interface segregation.** Clients depend on small interfaces such as `NormalizedOrder`, `WebhookTopicHandler` and `ShopifyCredentials`.
- **Dependency inversion.** The HTTP transport (`SHOPIFY_FETCH`) and sleep function (`SHOPIFY_SLEEP`) are injected through tokens. Tests replace them with an in-memory fake of Shopify, so production code is never patched.

### Folder structure

```
backend/
  prisma/              schema.prisma, migrations/, seed.ts
  src/
    common/            decorators, filters, interceptors, interfaces, utils
    config/            env validation (zod) + AppConfigService
    prisma/            PrismaService / PrismaModule
    auth/              controller, service, repository (revoked tokens), token service, guard, dto
    users/             controller, service, repository, password service, dto
    customers/         controller, service, repository, dto
    orders/            controller, services (list/details, sync, creation), repositories, dto
    shopify/           controller, service (connection), order-import service, sync-run repository
      integration/     client, errors, OAuth, gateways (orders/products/shop), mapper, verifier,
                       store repository, store-context service, graphql/queries.ts
    webhooks/          receivers + logs controllers, service, processor, handlers, repository, guard
    app.module.ts, app.setup.ts, main.ts
  test/                e2e suites, fake Shopify, test app helpers
frontend/
  src/
    api/               typed API clients
    components/        ui/ (Button, Card, Badge, form, Pagination, states), orders/
    context/ hooks/    auth provider, useAuth, useDebouncedValue
    layouts/           AppLayout (sidebar, header, profile menu, mobile drawer), AuthLayout
    pages/             auth, dashboard, orders, shopify, webhooks, settings
    routes/            ProtectedRoute / GuestRoute
    schemas/           zod form schemas
    types/             API types
docker-compose.yml     local PostgreSQL only (dev convenience, not deployment)
```

---

## 2. Local setup

### Prerequisites
- Node.js 20 or newer (developed on Node 24) and npm 10 or newer
- PostgreSQL 14 or newer. You can install it yourself, or use the provided `docker compose`.
- A Shopify Partner account and a development store, for the live integration only

### PostgreSQL

```bash
docker compose up -d        # postgres:16 on localhost:5432, user/password crm/crm
```

This creates two databases: `mini_crm` (development) and `mini_crm_test`, which the e2e tests use. If you use your own PostgreSQL server, create both databases and adjust `DATABASE_URL`. For tests, also set `TEST_DATABASE_URL`.

### Backend

```bash
cd backend
npm install
cp .env.example .env        # then fill in the values (see §3)
npx prisma migrate deploy   # or `npm run prisma:migrate` while developing
npm run prisma:seed         # demo data (see "Demo data" below): demo@example.com / Demo1234!
npm run start:dev           # API on http://localhost:3000/api
```

Swagger UI is at **`/api/docs`**. It is disabled when `NODE_ENV=production`.

### Frontend

```bash
cd frontend
npm install
cp .env.example .env        # VITE_API_BASE_URL=/api, VITE_DEV_PROXY_TARGET=http://localhost:3000
npm run dev                 # http://localhost:5173
```

In development, Vite proxies `/api` to `VITE_DEV_PROXY_TARGET`. In other environments, set `VITE_API_BASE_URL` to the absolute API URL. URLs are never hardcoded: every host and port comes from env. If ports 3000 or 5173 are already taken, change `PORT` / `APP_URL` in the backend and `VITE_DEV_PORT` / `VITE_DEV_PROXY_TARGET` in the frontend.

### Demo data (seed)

`npm run prisma:seed` (in `backend/`) boots the real NestJS application context and writes data **through the application's own services**, so seeded records obey exactly the same rules as real ones:

| What | How it is created | Result |
|---|---|---|
| Demo user | `AuthService.register` (Argon2id) | `demo@example.com` / `Demo1234!` (override with `SEED_USER_EMAIL` / `SEED_USER_PASSWORD`) |
| Demo store | upsert, status **Disconnected**, no token | `crm-demo-store.myshopify.com`, never used for Shopify API calls |
| 12 customers, 48 orders, ~100 line items | `OrderSyncService.upsertFromShopify` (transactional, unique per store + Shopify id) | 8 products / 14 variants with SKUs, spread over the last ~90 days; mix of open / closed / cancelled, unfulfilled / partially / fulfilled, paid / pending / authorized / refunded; promo discounts, free shipping over $100, 8.25 % tax, 3 guest checkouts |
| Webhook logs | `WebhooksService.receive` + the real processor | orders/create and orders/updated (processed), one re-delivery (recognised as duplicate), one malformed payload (failed), one unknown shop (skipped) |

Data comes from a fixed-seed generator: there are no hardcoded database ids, and re-running the seed **updates the same records instead of duplicating them**. `SEED_RESET=true npm run prisma:seed` deletes and recreates only the demo store's data. When you connect a real store, its orders sit alongside the demo orders; run the reset with the demo store removed, or use a fresh database, if you want only real data.

### Prisma migrations

| Command | Purpose |
|---|---|
| `npm run prisma:migrate` | Create and apply a migration from schema changes (development) |
| `npm run prisma:deploy` | Apply pending migrations (CI, staging, production, test database) |
| `npm run prisma:generate` | Regenerate the Prisma client |

The project pins **Prisma 6**. The datasource `url` in `schema.prisma` is valid for Prisma 6. The VS Code Prisma extension may flag it with Prisma 7 rules; you can ignore that warning.

---

## 3. Environment variables (`backend/.env`)

All variables are validated with Zod at startup. The app refuses to boot with invalid configuration. Do not commit `.env`; `.env.example` contains only placeholders.

| Variable | Description |
|---|---|
| `NODE_ENV` | `development`, `test` or `production` |
| `PORT` | HTTP port |
| `APP_URL` | Public base URL of this backend, used to build the OAuth callback and webhook URLs |
| `FRONTEND_URL` | SPA origin. The user is redirected here after OAuth. |
| `CORS_ORIGINS` | Comma-separated allowed origins. Defaults to `FRONTEND_URL`. |
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | At least 32 characters |
| `JWT_EXPIRES_IN` | Token lifetime, e.g. `8h` |
| `ENCRYPTION_KEY` | Base64-encoded 32-byte key for AES-256-GCM encryption of Shopify tokens at rest. Generate one with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` | The app's client ID and client secret |
| `SHOPIFY_API_VERSION` | Admin API version. Default `2026-10`. Supported stable versions at the time of writing: 2026-01, -04, -07, -10. |
| `SHOPIFY_SCOPES` | Default `read_orders,write_orders,read_products,read_customers` |
| `SHOPIFY_CALLBACK_URL` | Defaults to `${APP_URL}/api/shopify/callback` |
| `SHOPIFY_WEBHOOK_SECRET` | HMAC key for webhooks. Defaults to `SHOPIFY_API_SECRET`, which Shopify uses to sign webhooks for OAuth apps. |
| `SHOPIFY_WEBHOOK_BASE_URL` | Public base URL that Shopify posts webhooks to. Defaults to `APP_URL`. |
| `SHOPIFY_REQUEST_TIMEOUT_MS`, `SHOPIFY_MAX_RETRIES` | Timeout and retry limit for Shopify calls |
| `WEBHOOK_MAX_RETRIES`, `WEBHOOK_RETRY_INTERVAL_MS` | Webhook retry limit and how often the recovery loop runs |

Frontend variables (`frontend/.env`): `VITE_API_BASE_URL`, `VITE_DEV_PROXY_TARGET`, `VITE_DEV_PORT`.

---

## 4. Shopify configuration

### 4.1 Development store and app
1. In the Shopify Partner dashboard, create a **development store** and add a few products and test orders.
2. In the Dev Dashboard (or Partner dashboard), create an **app** that uses OAuth, i.e. an app that is not embedded. Copy its **Client ID** into `SHOPIFY_API_KEY` and its **Client secret** into `SHOPIFY_API_SECRET`.
3. Under the app's URLs:
   - **App URL**: your frontend URL.
   - **Allowed redirection URL(s)**: `${APP_URL}/api/shopify/callback`. It must match exactly.
4. Under **API access, Protected customer data**, request access to customer data and to the fields **name, email, phone and address**. Without this, the API returns customer and address fields as `null`. The CRM handles that, but the data will be missing.
5. Shopify must be able to reach the backend over **HTTPS** for webhooks. In local development, run a tunnel such as `cloudflared tunnel --url http://localhost:3000` or `ngrok http 3000`, then set `APP_URL` (or `SHOPIFY_WEBHOOK_BASE_URL`) to the tunnel URL.

### 4.2 Required API scopes

| Scope | Why |
|---|---|
| `read_orders` | Import and sync orders, and receive `orders/create` and `orders/updated` webhooks |
| `write_orders` | `orderCreate` from the CRM |
| `read_products` | Product and variant search, and server-side price and availability checks |
| `read_customers` | Customer data on orders, and associating existing customers |

Notes:
- **Webhook management** needs no extra scope. Each topic needs the scope of its resource, so `read_orders` covers both order topics.
- **`read_all_orders`** is only needed to import orders older than 60 days. Add it to `SHOPIFY_SCOPES` if you need that history. Public apps must request approval for it.
- **Inventory** is not decremented: `orderCreate` uses the default `BYPASS` inventory behaviour, so no inventory scope is requested.

### 4.3 Authentication flow (OAuth authorization code grant, offline token)

```
SPA  ── GET /api/shopify/connect?shop=x (JWT) ─▶ backend: validate domain, store single-use `state`
SPA  ◀─ { authorizationUrl } ── window.location → https://x.myshopify.com/admin/oauth/authorize
Shopify ── redirect ─▶ GET /api/shopify/callback?code&hmac&shop&state&timestamp  (public)
backend: verify query HMAC (timing-safe) → consume state (CSRF, expiry, shop match)
       → POST /admin/oauth/access_token → query `shop` (validates token)
       → encrypt token (AES-256-GCM) → upsert ShopifyStore → register webhooks
       → 302 to FRONTEND_URL/integrations/shopify?status=connected
```

- The access token is stored only on the backend, encrypted, and never returned by any API. The frontend never sees credentials or secrets.
- A **401** from Shopify marks the store `INVALID_TOKEN`. An **`app/uninstalled`** webhook marks it `DISCONNECTED` and deletes the token. In both cases the UI prompts the user to reconnect.
- The schema supports **multiple stores**: orders and customers are unique per `(store, Shopify id)`. The UI currently works with the most recently connected store.

### 4.4 Order import and sync

- **Import all** (`POST /api/shopify/import-orders`) pages through every order with cursor pagination (`orders(first, after)`).
- **Sync** (`POST /api/shopify/sync-orders`) fetches only orders matching `updated_at:>='lastSync - 5 min'`. The overlap catches edits that race the previous run.
- Both run **in the background** as a `SyncRun` with live counters. The UI polls `/status` while a run is active. Only one run per store can be active, enforced by a serializable transaction. Runs interrupted by a restart are marked failed on boot.
- Query cost is kept under Shopify's 1,000-point per-query limit with 10 orders × 10 line items per page. Orders with more line items are completed through follow-up line-item pagination.
- Rate limits: the client honours `Retry-After` on HTTP 429. For GraphQL `THROTTLED` errors it waits based on the cost bucket's `restoreRate`, and it slows down proactively when the bucket runs low. Timeouts, network errors and 5xx responses on reads get exponential backoff with jitter.
- Duplicates are prevented by a unique constraint on `(storeId, shopifyOrderId)`. Each order is written in one transaction (customer, order, then a full replace of its line items) under a `SELECT … FOR UPDATE` row lock. An update whose Shopify `updated_at` is older than the stored one is ignored.
- The browser never loads the full order set. Every list is paginated on the server.

### 4.5 Creating orders from the CRM (approach and limitations)

The CRM uses the Admin GraphQL **`orderCreate`** mutation (requires `write_orders` and an offline token):

1. The frontend validates the form with Zod and sends a client-generated **idempotency key** (UUID).
2. The backend validates the DTO, rejects duplicate variants, and re-fetches the variants from Shopify. Prices and availability always come from Shopify, never from the client.
3. An `OrderCreationRequest` row (status `PENDING`, payload hash) is stored. Its unique key makes concurrent double-submits resolve to a single request.
4. `orderCreate` is called with:
   - `financialStatus: PENDING`, so **no payment is captured and the order is not marked paid**
   - `sendReceipt: false`
   - tags `crm` and `crm-ref-<key>`, plus `sourceIdentifier=<key>`
5. On success, the order Shopify returns is persisted locally and the request becomes `SUCCEEDED`. The response is HTTP 201.
6. If Shopify returns `userErrors`, the request becomes `FAILED` and the API returns 422 with the details. **No local order is written.**
7. A timeout, network error or 5xx is an **uncertain outcome**. The mutation is **never retried automatically**. The request becomes `UNKNOWN` and the API returns HTTP 202. Reconciliation then searches Shopify for the unique `crm-ref-<key>` tag:
   - immediately after the failure
   - every minute through a scheduled job
   - on demand from the UI ("Check status")
   - when the same key is resubmitted

   If the order is found, it is persisted. If it is still missing after 30 minutes, the request is marked `FAILED` and a fresh key is safe to submit.
8. Resubmitting the same key replays the earlier result (`replayed: true`). Reusing a key with a different payload returns 422 `IDEMPOTENCY_KEY_REUSED`.

The `orders/create` webhook for a CRM-created order upserts the same row, so it never creates a duplicate.

**Limitations**
- **Taxes:** not calculated. `orderCreate` does not run Shopify's tax engine; tax lines would have to be supplied explicitly.
- **Discounts:** one fixed-amount discount code per order (`itemFixedDiscountCode`). Automatic discounts are not applied.
- **Shipping:** one custom shipping line (title and amount).
- **Inventory:** not reserved (`BYPASS`).
- **Rate limit on dev stores:** development and trial stores accept at most 5 `orderCreate` calls per minute.
- **Customers:** a new customer is upserted by email or phone. If neither is given, the order is created without a customer and only the address names are set.
- **Large orders:** line items beyond the first 10 are fetched with additional paginated requests.

---

## 5. Webhooks

### 5.1 Subscriptions
After a successful OAuth connection, the backend idempotently creates shop-scoped subscriptions with `webhookSubscriptionCreate`. The request uses `uri`, because `callbackUrl` is deprecated, and `format: JSON`.

| Topic | Endpoint |
|---|---|
| `ORDERS_CREATE` | `POST /api/webhooks/shopify/orders-create` |
| `ORDERS_UPDATED` | `POST /api/webhooks/shopify/orders-update` |
| `APP_UNINSTALLED` | `POST /api/webhooks/shopify/app-uninstalled` |

The **Register webhooks** button (`POST /api/shopify/webhooks/register`) re-checks the subscriptions and recreates any that are missing. Shopify deletes Admin-API subscriptions after repeated delivery failures, so this repairs them. As an alternative, the same topics can be declared in `shopify.app.toml`; the receivers and HMAC handling are identical.

### 5.2 HMAC verification
- The app is created with `NestFactory.create(AppModule, { rawBody: true })`, so `req.rawBody` keeps the exact bytes Shopify signed.
- `ShopifyHmacGuard` computes `base64(HMAC-SHA256(rawBody, SHOPIFY_WEBHOOK_SECRET))`. It compares that with `X-Shopify-Hmac-Sha256` using `crypto.timingSafeEqual`, after a length check.
- Invalid or missing signatures get **401**, and nothing is stored or processed.
- Webhook routes are `@Public()` (no JWT), skip throttling, and are protected only by the HMAC guard. The guard also checks that the topic header matches the endpoint and that the required headers are present.

### 5.3 Idempotency and duplicate prevention
- Every delivery is stored in `WebhookEvent` with a unique constraint on `(shopDomain, shopifyEventId)`. `shopifyEventId` is **`X-Shopify-Webhook-Id`**: it is unique per delivery and stays the same across Shopify's retries, so Shopify recommends it for deduplication. `X-Shopify-Event-Id` is kept for correlation.
- A re-delivery hits the unique constraint and is acknowledged with `200 { duplicate: true }` without being processed. Concurrent duplicate deliveries race on the same constraint: exactly one insert wins.
- Processing is an idempotent upsert on `(store, Shopify order id)` with stale-update protection. Even distinct deliveries for the same order, such as a create and an update racing each other, converge to one consistent row.

### 5.4 Acknowledgement, retry and recovery
1. **Verify, persist, then acknowledge.** The event is written to the database **before** the 200 response. A database failure returns 5xx, so Shopify retries the delivery later. Shopify allows about 5 seconds per delivery, and this path stays well within that.
2. Processing is dispatched in-process right after the acknowledgement. A worker **claims** the event atomically (`updateMany … status IN (RECEIVED, FAILED)` → `PROCESSING`), so two workers never handle the same event.
3. A failure sets `FAILED`, increments `retryCount`, and schedules `nextRetryAt` with exponential backoff: 30 s, 1 min, 2 min, and so on, capped at 1 h. When `WEBHOOK_MAX_RETRIES` is reached, retries stop. Invalid payloads fail permanently without retries.
4. A **recovery loop** runs every `WEBHOOK_RETRY_INTERVAL_MS`. It retries due failures and rescues two kinds of stuck events:
   - events still `RECEIVED` after 60 s (the process crashed after acknowledging)
   - events stuck in `PROCESSING` for 5 minutes (the worker died)
5. Events for shops that aren't connected are marked `SKIPPED`. The **Webhook Logs** page shows every event with its status, retries, errors and payload, and lets you **retry manually**.

Each event logs:
- event ID and correlation ID
- shop and topic
- Shopify order ID
- status
- received, triggered and processed timestamps
- retry count and next retry time
- error message
- the full payload

---

## 6. REST API (prefix `/api`, documented in Swagger)

All routes require `Authorization: Bearer <jwt>` unless marked public. Responses use the envelope `{ success: true, data }`. Errors use `{ success: false, statusCode, error: { code, message, details? }, path, timestamp }`.

| Method & path | Description |
|---|---|
| `POST /auth/register` · `POST /auth/login` (public, rate-limited) | Create an account or sign in; returns a JWT. The first user becomes ADMIN. |
| `POST /auth/logout` · `GET /auth/me` | Revoke the current token (server-side denylist) · current user |
| `GET/PATCH /users/me` · `PATCH /users/me/password` | Profile and password (Settings page) |
| `GET /shopify/connect?shop=` | Start OAuth; returns `authorizationUrl` |
| `GET /shopify/callback` (public) | OAuth callback (HMAC and state verified) |
| `GET /shopify/status` · `POST /shopify/verify` | Connection status, scopes, sync runs · re-validate the token |
| `POST /shopify/import-orders` · `POST /shopify/sync-orders` | Start a background full import or incremental sync (202) |
| `GET /shopify/sync-runs/:id` | Status of one run |
| `POST /shopify/webhooks/register` · `POST /shopify/disconnect` | Ensure webhook subscriptions exist · forget the token |
| `GET /shopify/products?search=` | Live product and variant search |
| `GET /orders` | `page`, `pageSize` (≤100), `search` (order # / customer / email), `orderStatus`, `fulfillmentStatus`, `financialStatus`, `dateFrom`, `dateTo`, `sortBy=orderDate\|totalAmount`, `sortOrder=asc\|desc` |
| `GET /orders/summary` · `GET /orders/filters` | Dashboard metrics · distinct statuses |
| `GET /orders/:id` | Full order details |
| `POST /orders` | Create in Shopify (201 created or replayed, 202 outcome being reconciled) |
| `GET /orders/creation-requests/:id` · `POST …/:id/reconcile` | Creation request status · reconcile now |
| `GET /customers?search=` | Customer typeahead |
| `POST /webhooks/shopify/orders-create` · `orders-update` · `app-uninstalled` (public, HMAC) | Webhook receivers |
| `GET /webhooks/logs` · `GET /webhooks/logs/:id` · `POST /webhooks/logs/:id/retry` | Webhook logs and manual retry |
| `GET /health` (public) | Liveness and database check |

---

## 7. Security notes
- Passwords are hashed with Argon2id, and login errors are identical whether the email or the password is wrong, so they don't reveal which accounts exist.
- JWTs (HS256) carry a `jti`. Logout puts the `jti` on a database denylist, and expired entries are purged hourly. An expired session returns `SESSION_EXPIRED`, which sends the SPA back to the login page.
- Login and registration are rate-limited, and a global throttle applies to all routes.
- `helmet` sets security headers, and CORS only allows the configured origins.
- Shopify tokens are encrypted at rest with AES-256-GCM and never leave the backend.
- Errors are logged on the server with stack traces, but clients only receive generic messages. Logs are structured objects.
- The SPA stores the JWT in `localStorage` for simplicity, which is an XSS-exposure tradeoff. For stricter deployments, switch to an httpOnly cookie plus CSRF protection.

---

## 8. Testing

```bash
cd backend
npm test            # unit tests: GraphQL client retry/throttle/timeout/partial-data handling, product
                    #   search syntax, mappers, webhook + OAuth HMAC, crypto, pagination, back-off
npm run test:e2e    # API integration tests against PostgreSQL `mini_crm_test`
npm run lint && npm run typecheck
cd ../frontend && npm run lint && npm run typecheck && npm run build
```

**Browser end-to-end tests (Playwright).** These drive real Chromium against the running app with the seeded demo data. They cover login, registration, validation, logout, revoked sessions, redirect-after-login, settings, dashboard figures, the orders list (search, filters, date range, sorting, pagination, state kept on Back), order details, webhook logs and retry, the Shopify page (validation and the OAuth redirect, intercepted so no external traffic), the Create Order guard, the 404 page and mobile navigation.

```bash
# backend running + `npm run prisma:seed` done, frontend dev server running
cd frontend
npx playwright install chromium          # first time only
E2E_BASE_URL=http://localhost:5173 npm run test:e2e
```

The suite signs in once and reuses the session. The API limits login to 10 attempts per minute, so wait a minute before re-running it immediately.

`e2e/create-order-form.crm.spec.ts` checks the Create Order **form** (validation, line items, totals, customer linking, payload, double-submit prevention, the uncertain-outcome banner and reconciliation, and a new idempotency key after a failure). Because the demo store is not connected, it stubs only the Shopify-backed endpoints the form calls. It verifies frontend behaviour, not the Shopify integration itself.

Browser tests create a few `e2e-…@example.com` users in the development database. `SEED_RESET=true npm run prisma:seed` restores the demo data.

`test:e2e` applies migrations to the test database with `prisma migrate deploy`, which never deletes anything. It refuses to run unless the database name ends with `_test`, and it truncates tables between tests. Shopify is replaced through the `SHOPIFY_FETCH` provider with an in-memory **fake Shopify Admin API** (`test/utils/fake-shopify.ts`) that supports failure injection: 429, `THROTTLED`, 5xx, timeouts, 401, "created but the response was lost", and `userErrors`.

| Area | Covered |
|---|---|
| Auth | registration, hashing, first-user admin, duplicate email, validation, login, wrong password, unknown email, protected routes, malformed token, logout revocation |
| Shopify | OAuth success (token encrypted, webhooks registered), authorize URL, invalid domain, bad HMAC, forged state, failed token exchange, 401 → `INVALID_TOKEN`, paginated import, duplicate import, line-item pagination, throttling and Retry-After, persistent 5xx, timeouts, revoked token mid-import, concurrent import rejection, incremental sync, product search |
| Orders | pagination metadata, last/empty page, filters kept across pages, order-number and customer search, status / fulfillment / date-range filters, combined filters, invalid range, query validation, sorting by total and date, details, 404/400, summary metrics, filter options |
| Order creation | success (payload sent to Shopify, local persistence, appears in listing), existing customer, eight validation cases, duplicate variants, unavailable or missing variants, Shopify `userErrors`, retry after a definitive failure, 5xx → UNKNOWN without retry, lost response reconciled, timeout reconciled on resubmit, give-up → FAILED, replay, key reuse with a different payload, 5 concurrent submits → 1 Shopify order |
| Webhooks | valid HMAC, invalid / missing / wrong-secret / tampered-body HMAC, raw-bytes verification, topic mismatch, create, update replacing items, update before create, stale updates ignored, app/uninstalled, unknown shop skipped, duplicate re-delivery, 8 concurrent duplicates, mixed create/update race, CRM order plus webhook, transient failure → backoff → recovery, max retries, permanent failure, crash-after-ack recovery, stale-lock recovery, concurrent workers, logs listing / filtering / details, manual retry |

### Verifying against a real development store
The automated suites use a fake Shopify. The real-store checks below are manual: run them after completing §4.1 with a tunnel URL.
1. Connect the store, then check that **Shopify Integration** shows `Connected`, the scopes are granted, and webhooks are registered.
2. Click **Import all** and confirm that the order count matches Shopify admin.
3. Create an order in the CRM and confirm it appears in Shopify admin as *Payment pending*.
4. Edit or fulfil an order in Shopify admin. Within seconds the **Webhook Logs** page should show an `orders/updated` event as *Processed*, and the order should be updated.
5. Uninstall the app in Shopify admin and confirm the store shows *Disconnected*.
