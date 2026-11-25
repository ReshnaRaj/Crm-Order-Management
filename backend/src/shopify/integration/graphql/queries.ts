/**
 * Shopify Admin GraphQL documents. Query sizes are chosen to stay well below the
 * 1,000-point single-query cost limit (orders × line items are multiplied).
 */

const ADDRESS_FIELDS = `
  firstName lastName name company address1 address2 city
  province provinceCode country countryCodeV2 zip phone
`;

export const LINE_ITEM_FIELDS = `
  id name title variantTitle sku quantity
  product { id }
  variant { id }
  originalUnitPriceSet { shopMoney { amount } }
  totalDiscountSet { shopMoney { amount } }
  discountedTotalSet { shopMoney { amount } }
`;

export const ORDER_FIELDS = `
  id name createdAt updatedAt processedAt cancelledAt closedAt
  displayFinancialStatus displayFulfillmentStatus
  currencyCode email phone note tags
  currentSubtotalPriceSet { shopMoney { amount } }
  currentTotalTaxSet { shopMoney { amount } }
  currentTotalDiscountsSet { shopMoney { amount } }
  totalShippingPriceSet { shopMoney { amount } }
  currentTotalPriceSet { shopMoney { amount } }
  customer {
    id firstName lastName displayName
    defaultEmailAddress { emailAddress }
    defaultPhoneNumber { phoneNumber }
  }
  billingAddress { ${ADDRESS_FIELDS} }
  shippingAddress { ${ADDRESS_FIELDS} }
`;

export const LINE_ITEMS_PER_ORDER = 10;
export const ORDERS_PER_PAGE = 10;

export const ORDERS_QUERY = `
  query CrmOrders($first: Int!, $after: String, $query: String) {
    orders(first: $first, after: $after, query: $query, sortKey: UPDATED_AT) {
      pageInfo { hasNextPage endCursor }
      nodes {
        ${ORDER_FIELDS}
        lineItems(first: ${LINE_ITEMS_PER_ORDER}) {
          pageInfo { hasNextPage endCursor }
          nodes { ${LINE_ITEM_FIELDS} }
        }
      }
    }
  }
`;

export const ORDER_LINE_ITEMS_QUERY = `
  query CrmOrderLineItems($id: ID!, $after: String) {
    order(id: $id) {
      lineItems(first: 50, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes { ${LINE_ITEM_FIELDS} }
      }
    }
  }
`;

export const ORDER_BY_ID_QUERY = `
  query CrmOrder($id: ID!) {
    order(id: $id) {
      ${ORDER_FIELDS}
      lineItems(first: ${LINE_ITEMS_PER_ORDER}) {
        pageInfo { hasNextPage endCursor }
        nodes { ${LINE_ITEM_FIELDS} }
      }
    }
  }
`;

export const ORDER_CREATE_MUTATION = `
  mutation CrmOrderCreate($order: OrderCreateOrderInput!, $options: OrderCreateOptionsInput) {
    orderCreate(order: $order, options: $options) {
      order {
        ${ORDER_FIELDS}
        lineItems(first: ${LINE_ITEMS_PER_ORDER}) {
          pageInfo { hasNextPage endCursor }
          nodes { ${LINE_ITEM_FIELDS} }
        }
      }
      userErrors { field message code }
    }
  }
`;

export const PRODUCTS_QUERY = `
  query CrmProducts($first: Int!, $after: String, $query: String) {
    products(first: $first, after: $after, query: $query, sortKey: TITLE) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id title status
        featuredMedia { preview { image { url altText } } }
        variants(first: 25) {
          nodes { id title displayName sku price inventoryQuantity availableForSale }
        }
      }
    }
  }
`;

export const SHOP_QUERY = `
  query CrmShop { shop { id name myshopifyDomain currencyCode } }
`;

export const WEBHOOK_SUBSCRIPTIONS_QUERY = `
  query CrmWebhookSubscriptions($topics: [WebhookSubscriptionTopic!]) {
    webhookSubscriptions(first: 50, topics: $topics) {
      nodes { id topic uri format }
    }
  }
`;

export const WEBHOOK_SUBSCRIPTION_CREATE = `
  mutation CrmWebhookCreate($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
    webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
      webhookSubscription { id topic uri }
      userErrors { field message }
    }
  }
`;

export const WEBHOOK_SUBSCRIPTION_DELETE = `
  mutation CrmWebhookDelete($id: ID!) {
    webhookSubscriptionDelete(id: $id) {
      deletedWebhookSubscriptionId
      userErrors { field message }
    }
  }
`;
