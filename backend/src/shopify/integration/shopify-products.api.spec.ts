import { buildProductSearchQuery } from './shopify-products.api';

describe('buildProductSearchQuery', () => {
  it('lists active products when there is no search term', () => {
    expect(buildProductSearchQuery(undefined)).toBe('status:active');
    expect(buildProductSearchQuery('   ')).toBe('status:active');
  });

  it('uses prefix wildcards (Shopify does not support leading wildcards)', () => {
    expect(buildProductSearchQuery('wid')).toBe('status:active AND ((title:wid*) OR sku:wid*)');
  });

  it('requires every word to prefix-match the title', () => {
    expect(buildProductSearchQuery('blue  hoodie')).toBe(
      'status:active AND ((title:blue* AND title:hoodie*) OR sku:bluehoodie*)',
    );
  });

  it('strips search-syntax metacharacters from user input', () => {
    expect(buildProductSearchQuery('tee") OR (title:*')).toBe(
      'status:active AND ((title:tee* AND title:OR* AND title:title*) OR sku:teeORtitle*)',
    );
  });

  it('keeps SKU characters and unicode letters', () => {
    expect(buildProductSearchQuery('TEE-M_01.b')).toBe('status:active AND ((title:TEE-M_01.b*) OR sku:TEE-M_01.b*)');
    expect(buildProductSearchQuery('café')).toContain('title:café*');
  });
});
