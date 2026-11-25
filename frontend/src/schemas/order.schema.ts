import { z } from 'zod';

const optional = (s: z.ZodType<string, string>) => z.union([s, z.literal('')]).optional();
const money = z
  .string()
  .trim()
  .regex(/^\d{1,10}(\.\d{1,2})?$/, 'Enter an amount like 5 or 5.00');
const phone = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{6,14}$/, 'Use international format, e.g. +14155550123');

const address = z
  .object({
    company: z.string().trim().max(255).optional(),
    address1: z.string().trim().max(255).optional(),
    address2: z.string().trim().max(255).optional(),
    city: z.string().trim().max(100).optional(),
    provinceCode: z.string().trim().max(10).optional(),
    countryCode: z.string().trim().optional(),
    zip: z.string().trim().max(20).optional(),
    phone: optional(phone),
  })
  .superRefine((a, ctx) => {
    const filled = Object.values(a).some((v) => v && String(v).trim());
    if (!filled) return;
    if (!a.address1) ctx.addIssue({ code: 'custom', path: ['address1'], message: 'Address is required' });
    if (!a.city) ctx.addIssue({ code: 'custom', path: ['city'], message: 'City is required' });
    if (!a.countryCode || !/^[A-Za-z]{2}$/.test(a.countryCode))
      ctx.addIssue({ code: 'custom', path: ['countryCode'], message: '2-letter country code, e.g. US' });
  });

export const lineItemSchema = z.object({
  variantId: z.string().regex(/^gid:\/\/shopify\/ProductVariant\/\d+$/),
  productTitle: z.string(),
  variantTitle: z.string(),
  sku: z.string().nullable(),
  price: z.string(),
  quantity: z.number({ error: 'Enter a quantity' }).int('Whole numbers only').min(1, 'At least 1').max(1000, 'At most 1000'),
});

export const createOrderSchema = z
  .object({
    customer: z.object({
      existingCustomerId: z.string().optional(),
      firstName: z.string().trim().min(1, 'First name is required').max(100),
      lastName: z.string().trim().min(1, 'Last name is required').max(100),
      email: optional(z.email('Enter a valid email')),
      phone: optional(phone),
    }),
    billingAddress: address,
    sameAsBilling: z.boolean(),
    shippingAddress: address,
    lineItems: z.array(lineItemSchema).min(1, 'Add at least one product'),
    shippingTitle: z.string().trim().max(100).optional(),
    shippingAmount: optional(money),
    discountCode: z.string().trim().max(50).optional(),
    discountAmount: optional(money),
    note: z.string().trim().max(5000).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.shippingAmount && Number(v.shippingAmount) > 0 && !v.shippingTitle)
      ctx.addIssue({ code: 'custom', path: ['shippingTitle'], message: 'Name the shipping method' });
    if (v.discountAmount && Number(v.discountAmount) > 0 && !v.discountCode)
      ctx.addIssue({ code: 'custom', path: ['discountCode'], message: 'Enter a discount code' });
  });

export type CreateOrderForm = z.infer<typeof createOrderSchema>;
export type LineItemForm = z.infer<typeof lineItemSchema>;
