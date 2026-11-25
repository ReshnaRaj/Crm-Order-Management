import { Injectable } from '@nestjs/common';
import { PRODUCTS_QUERY } from './graphql/queries';
import { ShopifyCredentials, ShopifyGraphQLClient } from './shopify.client';

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
}

interface GqlProduct {
  id: string;
  title: string;
  status: string;
  featuredMedia?: { preview?: { image?: { url: string } | null } | null } | null;
  variants: { nodes: ShopifyVariant[] };
}

/**
 * Builds a Shopify search-syntax query. Shopify supports *prefix* wildcards (`title:shirt*`)
 * but not leading wildcards, so each word must prefix-match a title word (AND), or the whole
 * input must prefix-match the SKU. Search-syntax metacharacters are stripped from user input.
 */
export function buildProductSearchQuery(search: string | undefined): string {
  const words = (search ?? '')
    .replace(/[^\p{L}\p{N}\s\-_.]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5);
  if (!words.length) return 'status:active';
  const title = words.map((w) => `title:${w}*`).join(' AND ');
  return `status:active AND ((${title}) OR sku:${words.join('')}*)`;
}

/** Product catalogue reads used by the Create Order form. */
@Injectable()
export class ShopifyProductsApi {
  constructor(private readonly client: ShopifyGraphQLClient) {}

  async searchProducts(
    creds: ShopifyCredentials,
    search: string | undefined,
    after: string | null,
    first = 20,
  ): Promise<ProductsPage> {
    const data = await this.client.request<{
      products: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: GqlProduct[] };
    }>(creds, PRODUCTS_QUERY, { first, after, query: buildProductSearchQuery(search) });

    return {
      products: data.products.nodes.map((p) => ({
        id: p.id,
        title: p.title,
        status: p.status,
        imageUrl: p.featuredMedia?.preview?.image?.url ?? null,
        variants: p.variants.nodes,
      })),
      hasNextPage: data.products.pageInfo.hasNextPage,
      endCursor: data.products.pageInfo.endCursor,
    };
  }

  /** Resolves variant prices server-side so totals never rely on client-supplied prices. */
  async getVariants(creds: ShopifyCredentials, ids: string[]): Promise<Map<string, ShopifyVariant & { productTitle: string }>> {
    const data = await this.client.request<{
      nodes: ({ id: string; title: string; displayName: string; sku: string | null; price: string; inventoryQuantity: number | null; availableForSale: boolean; product: { title: string } } | null)[];
    }>(
      creds,
      `query CrmVariants($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on ProductVariant { id title displayName sku price inventoryQuantity availableForSale product { title } }
        }
      }`,
      { ids },
    );
    const map = new Map<string, ShopifyVariant & { productTitle: string }>();
    for (const n of data.nodes) {
      if (n?.id) map.set(n.id, { ...n, productTitle: n.product.title });
    }
    return map;
  }
}
