/**
 * shoptools-kit — static entry point.
 * Product-CSV engine for e-commerce store migrations: validate, repair, export.
 */
export {
  SHOPIFY_HEADERS,
  REQUIRED_HEADERS,
  RECOMMENDED_HEADERS,
  validateShopifyCSV,
  repairHeaders,
  transformToExportFormat,
} from './schema.js';

export type { ValidationError } from './schema.js';
