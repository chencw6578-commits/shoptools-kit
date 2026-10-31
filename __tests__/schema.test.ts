import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SHOPIFY_HEADERS,
  validateShopifyCSV,
  repairHeaders,
  transformToExportFormat,
  type ValidationError,
} from '../src/schema.ts';

const row = (over: Record<string, string> = {}) => ({
  Handle: 'coffee-mug',
  Title: 'Ceramic Coffee Mug',
  'Body (HTML)': '<p>Handy mug.</p>',
  Vendor: 'Acme',
  'Variant SKU': 'ACME-MUG-001',
  'Variant Price': '19.99',
  'Image Src': 'https://example.com/mug.jpg',
  ...over,
});

test('empty dataset produces a single error', () => {
  const errs = validateShopifyCSV([]);
  assert.equal(errs.length, 1);
  assert.equal(errs[0].severity, 'error');
  assert.match(errs[0].message, /empty/i);
});

test('missing Handle column is an error', () => {
  const errs = validateShopifyCSV([{ Title: 'X', 'Variant Price': '5.00' }]);
  assert.ok(errs.some(e => e.severity === 'error' && /Missing required column: "Handle"/.test(e.message)));
});

test('missing recommended columns are warnings', () => {
  const errs = validateShopifyCSV([{ Handle: 'a' }]);
  const missing = errs.filter(e => /Missing recommended column/.test(e.message));
  assert.equal(missing.length, 3); // Title, Variant Price, Image Src
  assert.ok(missing.every(e => e.severity === 'warning'));
});

test('clean single-row catalog passes without errors', () => {
  const errs = validateShopifyCSV([row()]);
  assert.equal(errs.filter(e => e.severity === 'error').length, 0);
});

test('non-slug handle yields a normalization warning with suggestion', () => {
  const errs = validateShopifyCSV([row({ Handle: 'Coffee Mug!' })]);
  const w = errs.find(e => e.column === 'Handle' && e.severity === 'warning');
  assert.ok(w);
  assert.match(w.suggestion!, /coffee-mug/);
});

test('same handle with two different titles is a collision error', () => {
  const errs = validateShopifyCSV([
    row(),
    row({ Title: 'Totally Different Product' }),
  ]);
  const collision = errs.find(e => /Handle Collision/.test(e.message));
  assert.ok(collision);
  assert.equal(collision.severity, 'error');
});

test('same handle with same title (variants) is NOT a collision', () => {
  const errs = validateShopifyCSV([row(), row({ 'Variant SKU': 'ACME-MUG-002' })]);
  assert.ok(!errs.some(e => /Handle Collision/.test(e.message)));
});

test('duplicate SKU across different handles is a warning', () => {
  const errs = validateShopifyCSV([
    row(),
    row({ Handle: 'tea-cup', 'Variant SKU': 'ACME-MUG-001' }),
  ]);
  assert.ok(errs.some(e => /SKU Duplicate/.test(e.message) && e.severity === 'warning'));
});

test('currency-formatted price yields a format warning', () => {
  const errs = validateShopifyCSV([row({ 'Variant Price': '$19.99' })]);
  const w = errs.find(e => e.column === 'Variant Price' && /Non-standard price format/.test(e.message));
  assert.ok(w);
});

test('unclosed HTML tags in description are detected', () => {
  const errs = validateShopifyCSV([row({ 'Body (HTML)': '<p><em>oops' })]);
  const w = errs.find(e => /unclosed HTML tags/.test(e.message));
  assert.ok(w);
  assert.match(w!.message, /<p>/);
  assert.match(w!.message, /<em>/);
});

test('repairHeaders maps alias columns onto Shopify headers', () => {
  const { repairedData, mappings, fixesCount } = repairHeaders([
    { handle: 'hat', name: 'Wool Hat', price: '25,00', qty: 'sixty' },
  ]);
  assert.equal(mappings['handle'], 'Handle');
  assert.equal(mappings['name'], 'Title');
  assert.equal(mappings['price'], 'Variant Price');
  assert.ok(fixesCount > 0);
  assert.equal(repairedData[0]['Variant Price'], '25.00');   // European decimal
  assert.equal(repairedData[0]['Variant Inventory Qty'], '60'); // word → number
});

test('repairHeaders cleans thousands separators in price', () => {
  const { repairedData } = repairHeaders([{ Handle: 'x', Title: 'X', 'Variant Price': '1,234.56' }]);
  assert.equal(repairedData[0]['Variant Price'], '1234.56');
});

test('repairHeaders generates SKU for numeric-only SKU', () => {
  const { repairedData } = repairHeaders([{ Handle: 'socks', Title: 'Wool Socks', Vendor: 'Acme', 'Variant SKU': '12345' }]);
  const sku = repairedData[0]['Variant SKU'];
  assert.match(sku, /^ACME-WOOL-SOCKS-\d{3}$/);
});

test('repairHeaders deduplicates repeated SKUs with suffixes', () => {
  const { repairedData } = repairHeaders([
    { Handle: 'a', Title: 'A', 'Variant SKU': 'SAME-1' },
    { Handle: 'b', Title: 'B', 'Variant SKU': 'SAME-1' },
  ]);
  assert.equal(repairedData[0]['Variant SKU'], 'SAME-1');
  assert.equal(repairedData[1]['Variant SKU'], 'SAME-1-1');
});

test('repairHeaders output rows only contain official Shopify headers', () => {
  const { repairedData } = repairHeaders([row(), { junk: 'x' }]);
  for (const r of repairedData) {
    for (const k of Object.keys(r)) {
      assert.ok(SHOPIFY_HEADERS.includes(k), `unexpected key ${k}`);
    }
  }
});

test('repaired data passes validation with zero errors', () => {
  const messy = [{ title: 'wrist watch', price: '$9', sku: '999', image: 'watches.example.com/a.jpg' }];
  const { repairedData } = repairHeaders(messy);
  const errs: ValidationError[] = validateShopifyCSV(repairedData);
  assert.equal(errs.filter(e => e.severity === 'error').length, 0);
});

test('transformToExportFormat simplified renames inventory columns', () => {
  const out = transformToExportFormat(
    [{ Handle: 'a', 'Inventory Tracker': 'shopify', 'Inventory Qty': '5' }] as any,
    'simplified',
  );
  assert.equal(out[0]['Inventory Tracker'], 'shopify');
  assert.equal(out[0]['Inventory Qty'], '5');
  assert.equal(out[0]['Variant Inventory Qty'], undefined);
});

test('transformToExportFormat multi-location moves qty under location name', () => {
  const out = transformToExportFormat(
    [{ Handle: 'a', 'Variant Inventory Qty': '5' }] as any,
    'shopify-multi',
    'Warehouse B',
  );
  assert.equal(out[0]['Warehouse B'], '5');
  assert.equal(out[0]['Variant Inventory Qty'], undefined);
});
