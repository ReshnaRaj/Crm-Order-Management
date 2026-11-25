/**
 * Deterministic, realistic demo data for local development and evaluation.
 * Everything is generated from a fixed PRNG seed, so re-running produces the same records
 * (idempotent upserts keyed by the demo Shopify identifiers below).
 */
import { OrderStatus } from '@prisma/client';
import type {
  NormalizedAddress,
  NormalizedCustomer,
  NormalizedLineItem,
  NormalizedOrder,
} from '../src/shopify/integration/normalized-order';

export const DEMO_SHOP_DOMAIN = 'crm-demo-store.myshopify.com';
export const DEMO_CURRENCY = 'USD';
export const DEMO_ORDER_COUNT = 48;

/** Demo Shopify numeric ids live in a reserved range so they never collide with real stores' ids. */
const ID_BASE = { order: 7_100_000_000, customer: 7_200_000_000, lineItem: 7_300_000_000, product: 7_400_000_000, variant: 7_500_000_000 };
export const demoGid = (type: keyof typeof ID_BASE, n: number) =>
  `gid://shopify/${type === 'lineItem' ? 'LineItem' : type === 'variant' ? 'ProductVariant' : type[0].toUpperCase() + type.slice(1)}/${ID_BASE[type] + n}`;

/** mulberry32 – tiny deterministic PRNG */
function prng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const PRODUCTS = [
  { title: 'Organic Cotton T-Shirt', variants: [['White / M', 'TSH-WHT-M', 24], ['Black / L', 'TSH-BLK-L', 24], ['Navy / S', 'TSH-NVY-S', 24]] },
  { title: 'Merino Wool Sweater', variants: [['Charcoal / M', 'SWT-CHR-M', 89], ['Oatmeal / L', 'SWT-OAT-L', 89]] },
  { title: 'Slim Fit Chinos', variants: [['Khaki / 32', 'CHN-KHK-32', 65], ['Olive / 34', 'CHN-OLV-34', 65]] },
  { title: 'Canvas Weekender Bag', variants: [['Default Title', 'BAG-WKD', 120]] },
  { title: 'Leather Card Holder', variants: [['Tan', 'ACC-CRD-TAN', 35], ['Black', 'ACC-CRD-BLK', 35]] },
  { title: 'Stainless Steel Water Bottle', variants: [['500 ml', 'BTL-500', 28], ['750 ml', 'BTL-750', 32]] },
  { title: 'Running Socks 3-Pack', variants: [['M', 'SCK-3P-M', 18], ['L', 'SCK-3P-L', 18]] },
  { title: 'Wool Beanie', variants: [['Forest Green', 'BNE-GRN', 22]] },
] as const;

interface CatalogVariant {
  productIndex: number;
  variantIndex: number;
  productId: string;
  variantId: string;
  productTitle: string;
  variantTitle: string;
  sku: string;
  price: number;
}

export const CATALOG: CatalogVariant[] = PRODUCTS.flatMap((p, pi) =>
  p.variants.map(([title, sku, price], vi) => ({
    productIndex: pi,
    variantIndex: vi,
    productId: demoGid('product', pi + 1),
    variantId: demoGid('variant', (pi + 1) * 10 + vi),
    productTitle: p.title,
    variantTitle: title,
    sku,
    price,
  })),
);

const CUSTOMERS = [
  { first: 'Emma', last: 'Johnson', city: 'Austin', province: 'TX', zip: '78701', street: '1208 Congress Ave', phone: '+15125550142' },
  { first: 'Liam', last: 'Martinez', city: 'Denver', province: 'CO', zip: '80202', street: '1600 Glenarm Pl', phone: null },
  { first: 'Olivia', last: 'Chen', city: 'Seattle', province: 'WA', zip: '98101', street: '400 Pine St', phone: '+12065550118' },
  { first: 'Noah', last: 'Williams', city: 'Chicago', province: 'IL', zip: '60611', street: '233 E Ontario St', phone: '+13125550190' },
  { first: 'Ava', last: 'Patel', city: 'San Jose', province: 'CA', zip: '95113', street: '55 S Market St', phone: null },
  { first: 'Ethan', last: 'Brown', city: 'Boston', province: 'MA', zip: '02108', street: '1 Beacon St', phone: '+16175550133' },
  { first: 'Sophia', last: 'Garcia', city: 'Miami', province: 'FL', zip: '33131', street: '801 Brickell Ave', phone: '+13055550177' },
  { first: 'Mason', last: "O'Connor", city: 'Portland', province: 'OR', zip: '97205', street: '1120 SW 5th Ave', phone: null },
  { first: 'Isabella', last: 'Nguyen', city: 'Houston', province: 'TX', zip: '77002', street: '910 Louisiana St', phone: '+17135550108' },
  { first: 'Lucas', last: 'Schmidt', city: 'Minneapolis', province: 'MN', zip: '55402', street: '80 S 8th St', phone: '+16125550164' },
  { first: 'Mia', last: 'Robinson', city: 'Atlanta', province: 'GA', zip: '30303', street: '191 Peachtree St NE', phone: null },
  { first: 'James', last: 'Kowalski', city: 'New York', province: 'NY', zip: '10001', street: '350 5th Ave', phone: '+12125550121' },
];

export interface DemoCustomer {
  customer: NormalizedCustomer;
  address: NormalizedAddress;
}

export const DEMO_CUSTOMERS: DemoCustomer[] = CUSTOMERS.map((c, i) => {
  const email = `${c.first}.${c.last}`.toLowerCase().replace(/[^a-z.]/g, '') + '@example.com';
  const address: NormalizedAddress = {
    firstName: c.first,
    lastName: c.last,
    name: `${c.first} ${c.last}`,
    address1: c.street,
    city: c.city,
    province: c.province,
    provinceCode: c.province,
    country: 'United States',
    countryCode: 'US',
    zip: c.zip,
    phone: c.phone,
  };
  return {
    customer: {
      shopifyCustomerId: demoGid('customer', i + 1),
      firstName: c.first,
      lastName: c.last,
      name: `${c.first} ${c.last}`,
      email,
      phone: c.phone,
    },
    address,
  };
});

const money = (n: number) => n.toFixed(2);
const TAX_RATE = 0.0825;

/**
 * Builds the demo orders. Dates are spread over the ~90 days before `anchor`
 * (start of the current UTC day), newest order last.
 */
export function buildDemoOrders(anchor: Date): NormalizedOrder[] {
  const rand = prng(20261124);
  const pick = <T>(arr: readonly T[]) => arr[Math.floor(rand() * arr.length)];
  const orders: NormalizedOrder[] = [];

  for (let i = 0; i < DEMO_ORDER_COUNT; i++) {
    const n = i + 1;
    const guest = n % 16 === 0; // a few guest checkouts without a customer record
    const c = guest ? null : DEMO_CUSTOMERS[Math.floor(rand() * DEMO_CUSTOMERS.length)];
    const daysAgo = Math.round(((DEMO_ORDER_COUNT - n) / DEMO_ORDER_COUNT) * 88) + 1;
    const orderDate = new Date(anchor.getTime() - daysAgo * 86_400_000 + Math.floor(rand() * 10 * 3600_000) + 8 * 3600_000);

    // 1–3 distinct variants
    const lineCount = 1 + Math.floor(rand() * 3);
    const chosen = new Map<string, CatalogVariant>();
    while (chosen.size < lineCount) {
      const v = pick(CATALOG);
      chosen.set(v.variantId, v);
    }
    const lineItems: NormalizedLineItem[] = [...chosen.values()].map((v, li) => {
      const qty = 1 + Math.floor(rand() * 3);
      return {
        shopifyLineItemId: demoGid('lineItem', n * 10 + li),
        shopifyProductId: v.productId,
        shopifyVariantId: v.variantId,
        productName: v.productTitle,
        variantName: v.variantTitle === 'Default Title' ? null : v.variantTitle,
        sku: v.sku,
        quantity: qty,
        unitPrice: money(v.price),
        totalDiscount: '0.00',
        totalPrice: money(v.price * qty),
      };
    });

    const subtotal = lineItems.reduce((s, l) => s + Number(l.totalPrice), 0);
    const discount = n % 7 === 0 ? Math.round(subtotal * 0.1 * 100) / 100 : 0; // occasional 10% promo
    const shipping = subtotal - discount >= 100 ? 0 : 7.95;
    const tax = Math.round((subtotal - discount) * TAX_RATE * 100) / 100;
    const total = subtotal - discount + shipping + tax;

    const cancelled = n % 17 === 0;
    const closed = !cancelled && n % 11 === 0;
    const age = DEMO_ORDER_COUNT - n; // newer orders are less likely to be fulfilled
    const fulfillment = cancelled
      ? 'UNFULFILLED'
      : closed || age > 14
        ? 'FULFILLED'
        : age > 6 && n % 3 === 0
          ? 'PARTIALLY_FULFILLED'
          : age > 6 && n % 2 === 0
            ? 'FULFILLED'
            : 'UNFULFILLED';
    const financial = cancelled
      ? 'VOIDED'
      : n % 13 === 0
        ? 'REFUNDED'
        : n % 9 === 0
          ? 'PARTIALLY_REFUNDED'
          : age <= 3 && n % 2 === 1
            ? 'PENDING'
            : n % 10 === 0
              ? 'AUTHORIZED'
              : 'PAID';

    orders.push({
      shopifyOrderId: demoGid('order', n),
      orderNumber: `#${1000 + n}`,
      orderDate,
      shopifyUpdatedAt: orderDate,
      cancelledAt: cancelled ? new Date(orderDate.getTime() + 3600_000) : null,
      closedAt: closed ? new Date(orderDate.getTime() + 5 * 86_400_000) : null,
      orderStatus: cancelled ? OrderStatus.CANCELLED : closed ? OrderStatus.CLOSED : OrderStatus.OPEN,
      financialStatus: financial,
      fulfillmentStatus: fulfillment,
      currency: DEMO_CURRENCY,
      subtotal: money(subtotal),
      totalTax: money(tax),
      totalDiscount: money(discount),
      shippingAmount: money(shipping),
      totalAmount: money(total),
      email: c?.customer.email ?? `guest${n}@example.net`,
      phone: c?.customer.phone ?? null,
      customerName: c?.customer.name ?? null,
      customer: c?.customer ?? null,
      billingAddress: c?.address ?? null,
      shippingAddress: c?.address ?? null,
      note: n % 8 === 0 ? 'Gift wrap requested' : null,
      tags: [...(subtotal >= 150 ? ['vip'] : []), ...(discount ? ['promo-10'] : [])],
      lineItems,
    });
  }
  return orders;
}
