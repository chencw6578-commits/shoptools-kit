# shoptools-kit

Product-CSV engine for e-commerce store migrations: **validate, repair and export** Shopify-format product catalogs. Pure TypeScript, zero dependencies, fully typed.

This is the CSV engine behind [ShopTools](https://shoptools.one)'s browser-based catalog tools, extracted into a standalone library so the rules are inspectable and reusable.

## What's inside

| Function | Purpose |
|---|---|
| `validateShopifyCSV(rows)` | Full rule scan: missing/duplicate handles, SKU collisions (within and across products), price formats, inventory quantities, unclosed HTML in descriptions, insecure image URLs, tag separators, option defaults |
| `repairHeaders(rows)` | Column alias mapping (`price` → `Variant Price`, `qty` → `Variant Inventory Qty`, …), handle collision resolution, price normalization (`1.234,56` / `$19.99` / `19,99` → `19.99`-style decimals), quantity cleaning (`"sixty"` → `60`), HTTPS image upgrades, HTML tag closing, SKU generation and deduplication, official-header filtering |
| `transformToExportFormat(rows, format, location?)` | Export shapes: `shopify-legacy`, `shopify-multi` (per-location inventory columns), `simplified` |

Each rule reports a `severity` (`error` / `warning`) plus a human-readable `suggestion` describing exactly what the repair step will do.

No classes, no side effects, no I/O — pass rows, get rows back.

## Install

```bash
npm install shoptools-kit
```

## Usage

```ts
import { validateShopifyCSV, repairHeaders, transformToExportFormat } from 'shoptools-kit';

// rows: array of objects as parsed from a CSV (e.g. via Papa Parse)
const errors = validateShopifyCSV(rows);
const { repairedData, mappings, fixesCount } = repairHeaders(rows);
const exportable = transformToExportFormat(repairedData, 'shopify-multi', 'Warehouse B');
```

## Design rules

- **Pure functions** — same input, same output; trivially testable and safe in any runtime (Node, Deno, Bun, browsers).
- **Honest severities** — only genuine import-blockers are `error`s; everything else is a `warning` with a stated fix.
- **Shopify-format only** — this library deliberately validates against the real product-CSV header set, not an invented schema.

## Used by

- [ShopTools](https://shoptools.one) — free browser-based product CSV validator, repair and export tools.
- Source code: [github.com/chencw6578-commits/shoptools-kit](https://github.com/chencw6578-commits/shoptools-kit)

## License

MIT
