
export const SHOPIFY_HEADERS = [
  "Handle",
  "Title",
  "Body (HTML)",
  "Vendor",
  "Standard Product Type",
  "Custom Product Type",
  "Tags",
  "Published",
  "Option1 Name",
  "Option1 Value",
  "Option2 Name",
  "Option2 Value",
  "Option3 Name",
  "Option3 Value",
  "Variant SKU",
  "Variant Grams",
  "Variant Inventory Tracker",
  "Variant Inventory Qty",
  "Variant Inventory Policy",
  "Variant Fulfillment Service",
  "Variant Price",
  "Variant Compare At Price",
  "Variant Requires Shipping",
  "Variant Taxable",
  "Variant Barcode",
  "Image Src",
  "Image Position",
  "Image Alt Text",
  "Gift Card",
  "SEO Title",
  "SEO Description",
  "Google Shopping / Google Product Category",
  "Google Shopping / Gender",
  "Google Shopping / Age Group",
  "Google Shopping / MPN",
  "Google Shopping / Adwords Grouping",
  "Google Shopping / Adwords Labels",
  "Google Shopping / Condition",
  "Google Shopping / Custom Product",
  "Google Shopping / Custom Label 0",
  "Google Shopping / Custom Label 1",
  "Google Shopping / Custom Label 2",
  "Google Shopping / Custom Label 3",
  "Google Shopping / Custom Label 4",
  "Variant Weight Unit",
  "Variant Tax Code",
  "Cost per item",
  "Price / International",
  "Compare At Price / International",
  "Status"
];

export const REQUIRED_HEADERS = ["Handle"];
export const RECOMMENDED_HEADERS = ["Title", "Variant Price", "Image Src"];

export interface ValidationError {
  row?: number;
  column?: string;
  message: string;
  severity: "error" | "warning";
  suggestion?: string;
}

function findUnclosedHtmlTags(html: string): string[] {
  const stack: string[] = [];
  const tagRegex = /<\/?([a-z1-6]+)(?:\s+[^>]*)?>/gi;
  let match;
  while ((match = tagRegex.exec(html)) !== null) {
    const isClosing = match[0].startsWith('</');
    const tagName = match[1].toLowerCase();
    if (["br", "img", "hr", "input", "meta", "link"].includes(tagName)) {
      continue;
    }
    if (isClosing) {
      if (stack.length > 0 && stack[stack.length - 1] === tagName) {
        stack.pop();
      }
    } else {
      stack.push(tagName);
    }
  }
  return stack;
}

export function validateShopifyCSV(data: any[]): ValidationError[] {
  const errors: ValidationError[] = [];
  
  if (data.length === 0) {
    errors.push({ message: "The CSV file is empty.", severity: "error" });
    return errors;
  }

  const headers = Object.keys(data[0]);

  // Check for required headers
  REQUIRED_HEADERS.forEach(req => {
    if (!headers.includes(req)) {
      errors.push({ message: `Missing required column: "${req}"`, severity: "error" });
    }
  });

  // Check for recommended headers
  RECOMMENDED_HEADERS.forEach(rec => {
    if (!headers.includes(rec)) {
      errors.push({ message: `Missing recommended column: "${rec}"`, severity: "warning" });
    }
  });

  // Keep track of handles and titles for conflict detection
  const handleToTitles: Record<string, Set<string>> = {};
  // Track which handles have already appeared, so we only require a Title on the first
  // row of each product (variant continuation rows may legitimately leave Title blank).
  const seenHandles = new Set<string>();
  
  // Track SKUs to find duplicates across different handles
  const skuToHandles: Record<string, Set<string>> = {};
  // Track SKUs duplicated WITHIN the same handle (variants must have unique SKUs)
  const handleSkuCounts: Record<string, Record<string, number>> = {};

  // Row-level validation
  data.forEach((row, index) => {
    const rowNum = index + 1;
    const titleVal = String(row.Title || "").trim();

    // 1. Handle validation
    const handle = String(row.Handle || "").trim();
    const normalizedH = slugifyHandle(handle);
    
    if (!handle) {
      errors.push({ row: rowNum, column: "Handle", message: "Handle is missing at row " + rowNum, severity: "error", suggestion: "Will be auto-generated from Title." });
    } else {
      if (handle !== normalizedH) {
        errors.push({
          row: rowNum,
          column: "Handle",
          message: `Handle "${handle}" contains spaces, uppercase letters, or special characters.`,
          severity: "warning",
          suggestion: `Will be normalized to "${normalizedH}" automatically.`
        });
      }

      // Track titles associated with handles to find clashes
      if (titleVal) {
        if (!handleToTitles[normalizedH]) {
          handleToTitles[normalizedH] = new Set();
        }
        handleToTitles[normalizedH].add(titleVal);
      }
    }

    // Title is required by Shopify on the FIRST row of every product (every unique Handle).
    // Variant continuation rows legitimately leave Title blank to inherit the parent's, so only
    // the first occurrence of a Handle must carry a Title; later blank-Title rows for the same
    // Handle are skipped (no error/warning).
    if (!titleVal && (!handle || !seenHandles.has(normalizedH))) {
      errors.push({
        row: rowNum,
        column: "Title",
        message: `Title is missing or empty at row ${rowNum}.`,
        severity: "error",
        suggestion: "Shopify requires a Title for every product. Add a product name before importing."
      });
    }
    if (handle) seenHandles.add(normalizedH);

    // SKU tracking for duplicates
    const sku = String(row["Variant SKU"] || "").trim();
    if (sku && handle) {
      if (!skuToHandles[sku]) {
        skuToHandles[sku] = new Set();
      }
      skuToHandles[sku].add(normalizedH);
      // per-handle SKU counts (variants of one product must have unique SKUs)
      if (!handleSkuCounts[normalizedH]) handleSkuCounts[normalizedH] = {};
      handleSkuCounts[normalizedH][sku] = (handleSkuCounts[normalizedH][sku] || 0) + 1;
    }

    // 2. Body HTML tag validation
    const bodyHtml = String(row["Body (HTML)"] || "").trim();
    if (bodyHtml) {
      const unclosed = findUnclosedHtmlTags(bodyHtml);
      if (unclosed.length > 0) {
        errors.push({
          row: rowNum,
          column: "Body (HTML)",
          message: `Description contains unclosed HTML tags: ${unclosed.map(t => `<${t}>`).join(', ')}.`,
          severity: "warning",
          suggestion: "Unclosed tags will be repaired with proper closing tags to preserve storefront formatting."
        });
      }
    } else {
      errors.push({
        row: rowNum,
        column: "Body (HTML)",
        message: "Body (HTML) is missing or empty.",
        severity: "warning",
        suggestion: "Will be auto-filled with an SEO-optimized premium description template."
      });
    }

    // 3. Image URL validation
    if (row["Image Src"]) {
      const url = String(row["Image Src"]).trim();
      if (!url.startsWith('https://')) {
        if (url.startsWith('http://')) {
          errors.push({
            row: rowNum,
            column: "Image Src",
            message: `Insecure HTTP image URL at row ${rowNum}.`,
            severity: "warning",
            suggestion: "Will be upgraded to secure HTTPS protocol."
          });
        } else if (url.startsWith('//') || (url.includes('.') && url.indexOf('.') > 1)) {
          errors.push({
            row: rowNum,
            column: "Image Src",
            message: `Relative or protocol-less image URL at row ${rowNum}.`,
            severity: "warning",
            suggestion: "Will be prepended with 'https://' protocol."
          });
        } else {
          errors.push({
            row: rowNum,
            column: "Image Src",
            message: `Invalid or unresolvable image reference "${url}" at row ${rowNum}.`,
            severity: "warning",
            suggestion: "This cell will be left empty. Add a full image URL starting with https:// so Shopify can import it."
          });
        }
      }
    }

    // 4. Variant Price validation
    if (row["Variant Price"] !== undefined && row["Variant Price"] !== "") {
      const priceStr = String(row["Variant Price"]).trim();
      if (/[$,\u20AC\u00A3\u00A5]/.test(priceStr) || isNaN(Number(priceStr))) {
        errors.push({
          row: rowNum,
          column: "Variant Price",
          message: `Non-standard price format "${priceStr}" at row ${rowNum}.`,
          severity: "warning",
          suggestion: "Will be parsed and converted to standard decimal format (e.g., 19.99)."
        });
      } else {
        const val = Number(priceStr);
        if (val === 0) {
          errors.push({
            row: rowNum,
            column: "Variant Price",
            message: `Variant Price is 0.00 at row ${rowNum}.`,
            severity: "warning",
            suggestion: "Please verify if this product is intended to be free."
          });
        } else if (val < 0) {
          // Shopify rejects a negative Variant Price. It passed silently before, which
          // meant the row survived into the exported file and failed at import time.
          errors.push({
            row: rowNum,
            column: "Variant Price",
            message: `Negative Variant Price "${priceStr}" at row ${rowNum}.`,
            severity: "error",
            suggestion: "Shopify will not import a negative price. Set it to 0.00 or the real amount."
          });
        }
      }
    } else {
      errors.push({
        row: rowNum,
        column: "Variant Price",
        message: "Variant Price is missing or empty.",
        severity: "warning",
        suggestion: "Will default to 0.00."
      });
    }

    // 5. Variant Inventory Qty validation
    if (row["Variant Inventory Qty"] !== undefined && row["Variant Inventory Qty"] !== "") {
      const qtyStr = String(row["Variant Inventory Qty"]).trim();
      const numVal = Number(qtyStr);
      if (isNaN(numVal)) {
        errors.push({
          row: rowNum,
          column: "Variant Inventory Qty",
          message: `Non-numeric inventory quantity "${qtyStr}" at row ${rowNum}.`,
          severity: "warning",
          suggestion: "Will be parsed to an integer (e.g., '100pcs' -> 100, 'sixty' -> 60)."
        });
      } else if (numVal < 0) {
        errors.push({
          row: rowNum,
          column: "Variant Inventory Qty",
          message: `Negative inventory quantity "${qtyStr}" detected at row ${rowNum}.`,
          severity: "warning",
          suggestion: "Will be automatically reset to 0 to prevent synchronization issues."
        });
      }
    }

    // 6. Tags check
    if (row["Tags"] && (row["Tags"].includes(',,') || row["Tags"].endsWith(',') || row["Tags"].startsWith(','))) {
      errors.push({
        row: rowNum,
        column: "Tags",
        message: `Tags list contains duplicate or empty separators at row ${rowNum}.`,
        severity: "warning",
        suggestion: "Will be formatted cleanly with standardized spacing."
      });
    }

    // 7. Option1 Name & Value
    if (!row["Option1 Name"] || !String(row["Option1 Name"]).trim()) {
      errors.push({
        row: rowNum,
        column: "Option1 Name",
        message: "Option1 Name is missing.",
        severity: "warning",
        suggestion: "Will default to 'Title'."
      });
    }
    if (!row["Option1 Value"] || !String(row["Option1 Value"]).trim()) {
      errors.push({
        row: rowNum,
        column: "Option1 Value",
        message: "Option1 Value is missing.",
        severity: "warning",
        suggestion: "Will default to 'Default Title'."
      });
    }

    // 8. Published state check
    if (row["Published"]) {
      const pub = String(row["Published"]).toLowerCase().trim();
      if (!["true", "false", "yes", "no", "y", "n", "1", "0"].includes(pub)) {
        errors.push({
          row: rowNum,
          column: "Published",
          message: `Non-standard Published state "${row["Published"]}" at row ${rowNum}.`,
          severity: "warning",
          suggestion: "Will be standardized to 'true' or 'false'."
        });
      }
    }
  });

  // Check for duplicate handles (same handle, same title is OK - those are variants!)
  // If same handle, different titles -> Conflict!
  Object.entries(handleToTitles).forEach(([handle, titles]) => {
    if (titles.size > 1) {
      errors.push({
        row: -1,
        column: "Handle",
        message: `Handle Collision: The handle "${handle}" is assigned to multiple distinct product titles: ${Array.from(titles).map(t => `"${t}"`).join(', ')}.`,
        severity: "error",
        suggestion: "Shopify will merge these under a single product, overwriting data. The tool will resolve this by generating unique handles."
      });
    }
  });

  // Check for duplicate SKUs across different product handles
  Object.entries(skuToHandles).forEach(([sku, handles]) => {
    if (handles.size > 1) {
      errors.push({
        row: -1,
        column: "Variant SKU",
        message: `SKU Duplicate: SKU "${sku}" is duplicated across different product handles: ${Array.from(handles).map(h => `"${h}"`).join(', ')}.`,
        severity: "warning",
        suggestion: "Different products should have unique SKU identifiers. The tool will append a suffix (e.g. '-1') to keep them distinct."
      });
    }
  });

  // Check for SKUs duplicated WITHIN the same product handle (Shopify rejects variant imports
  // with duplicate SKUs, and identical SKUs across variants of one product cause merge bugs).
  Object.entries(handleSkuCounts).forEach(([handle, skus]) => {
    Object.entries(skus).forEach(([sku, count]) => {
      if (count > 1) {
        errors.push({
          row: -1,
          column: "Variant SKU",
          message: `SKU Duplicate: SKU "${sku}" appears ${count} times within product handle "${handle}". Every variant needs a unique SKU.`,
          severity: "warning",
          suggestion: "The tool will append a suffix (e.g. '-1', '-2') to each repeated SKU."
        });
      }
    });
  });

  return errors;
}

function cleanAndFormatPrice(priceStr: string): string {
  let p = priceStr.trim();
  if (!p) return "0.00";
  // A negative price is rejected by Shopify. Clamp to 0.00 here so the repair pass can
  // actually clear the error it now reports, instead of leaving it permanently blocking.
  const negative = /^\(.*\)|^[-−]/.test(p);
  if (negative) return "0.00";
  // Remove currency symbols ($, €, £, ¥, etc.) and space
  p = p.replace(/[$\u20AC\u00A3\u00A5]/g, '').replace(/\s+/g, '');
  
  if (p.includes(',') && p.includes('.')) {
    // If dot comes before comma, comma is decimal (e.g. 1.234,56)
    if (p.indexOf('.') < p.indexOf(',')) {
      p = p.replace(/\./g, '').replace(/,/g, '.');
    } else {
      // Comma is thousands separator (e.g. 1,234.56)
      p = p.replace(/,/g, '');
    }
  } else if (p.includes(',')) {
    // Only has commas, could be European decimal (e.g. 19,99)
    const parts = p.split(',');
    const lastPart = parts[parts.length - 1];
    if (lastPart.length === 2) {
      p = parts.slice(0, parts.length - 1).join('') + '.' + lastPart;
    } else if (parts.length === 2 && lastPart.length === 3) {
      p = parts.join('');
    } else {
      p = p.replace(/,/g, '.');
    }
  }
  
  // Handle scientific notation BEFORE stripping non-numeric characters. The previous
  // `replace(/[^-0-9.]/g, '')` turned "1e3" into "13" — a 1000x error on a price cell.
  const sciMatch = p.match(/^(-?\d+(?:\.\d+)?)[eE]([+-]?\d+)$/);
  if (sciMatch) {
    const scaled = Number(sciMatch[1]) * Math.pow(10, Number(sciMatch[2]));
    return isFinite(scaled) ? scaled.toFixed(2) : "0.00";
  }

  const cleaned = p.replace(/[^-0-9.]/g, '');
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? "0.00" : parsed.toFixed(2);
}

function cleanInventoryQty(qtyStr: string): string {
  const s = qtyStr.trim().toLowerCase();
  if (!s) return "100"; // standard default
  
  const wordMap: Record<string, string> = {
    "zero": "0", "one": "1", "two": "2", "three": "3", "four": "4", "five": "5",
    "six": "6", "seven": "7", "eight": "8", "nine": "9", "ten": "10",
    "twenty": "20", "thirty": "30", "forty": "40", "fifty": "50", "sixty": "60",
    "seventy": "70", "eighty": "80", "ninety": "90", "hundred": "100"
  };
  if (wordMap[s] !== undefined) return wordMap[s];
  
  // Strip thousands separators before extracting digits. The previous
  // `match(/[-+]?\d+/)` took only the first digit run, so "1,000" became "1" — silently
  // turning a thousand units of stock into one, which can delist a product.
  //
  // Only ",", " " and NBSP count as group separators here. A "." or "," between digits
  // could be a decimal mark, so the fractional part is truncated, never concatenated:
  // "3.7" must be 3, never 37.
  const numeric = s.match(/[-+]?\d[\d,\u00a0 ]*/);
  if (numeric) {
    const negative = numeric[0].trim().charAt(0) === '-';
    const integerPart = numeric[0]
      .replace(/^[-+]/, '')
      .replace(/[,\u00a0 ]/g, '')
      .split('.')[0] || '0';
    const val = parseInt(integerPart, 10);
    if (isNaN(val)) return "0";
    if (negative || val < 0) return "0"; // Repair negative to 0
    return String(val);
  }
  return "0";
}

/**
 * Normalise an Image Src value. Deliberately never invents a URL.
 *
 * The previous version returned a stock Unsplash photo whenever the cell was empty
 * or unparseable. On a real catalog that is destructive: variant continuation rows
 * legitimately leave Image Src blank so Shopify inherits the parent's photo, and the
 * tool replaced those with an unrelated picture — a hoodie variant ended up with a
 * photo of a wristwatch. A blank now stays blank, and a genuinely unusable value is
 * preserved as-is so the merchant can see and fix it rather than having it silently
 * swapped for something they never chose.
 *
 * Returns '' for an empty cell, and the normalised URL otherwise.
 */
function cleanImageUrl(urlStr: string): string {
  const url = String(urlStr || '').trim();
  if (!url) return '';

  if (url.startsWith('//')) return 'https:' + url;

  // Protocol-relative or scheme-less but plausibly a host: add https.
  if (!/^https?:\/\//i.test(url)) {
    if (url.includes('.') && url.indexOf('.') > 1) return 'https://' + url;
    return '';   // not a URL at all (e.g. "not-a-url") - leave it empty
  }

  if (url.startsWith('http://')) return 'https://' + url.slice(7);

  return url;
}

function closeHtmlTags(html: string): { closedHtml: string, closedTagsCount: number } {
  const stack: string[] = [];
  const tagRegex = /<\/?([a-z1-6]+)(?:\s+[^>]*)?>/gi;
  let match;
  while ((match = tagRegex.exec(html)) !== null) {
    const isClosing = match[0].startsWith('</');
    const tagName = match[1].toLowerCase();
    if (["br", "img", "hr", "input", "meta", "link"].includes(tagName)) {
      continue;
    }
    if (isClosing) {
      if (stack.length > 0 && stack[stack.length - 1] === tagName) {
        stack.pop();
      }
    } else {
      stack.push(tagName);
    }
  }
  
  let closedHtml = html;
  let closedTagsCount = 0;
  while (stack.length > 0) {
    const tag = stack.pop();
    closedHtml += `</${tag}>`;
    closedTagsCount++;
  }
  return { closedHtml, closedTagsCount };
}


/**
 * Turn free text into a Shopify-safe Handle.
 *
 * Shopify accepts Unicode in handles, and a Chinese catalog needs it: the old
 * `[a-z0-9-_]`-only filter reduced a title like "男士 休闲 衬衫" to the
 * placeholder "--", which is a worse handle than keeping the original text.
 * Latin text is still lowercased and space-separated into dashes; anything with
 * no usable ASCII at all falls back to the untouched trimmed text, and only then
 * to a row-scoped default so the handle is never empty.
 */
function slugifyHandle(raw: string, fallbackIndex = 0): string {
  const input = String(raw || '').trim();
  if (!input) return `product-${fallbackIndex + 1}`;
  const slug = input
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}_\-/]+/gu, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  // Strip a leftover dash-only slug such as "--" (pure punctuation input).
  if (!slug || /^-+$/.test(slug)) return `product-${fallbackIndex + 1}`;
  return slug;
}

function generateSKU(title: string, vendor: string, index: number): string {
  // P3-hotfix: non-Latin vendor names (e.g. Chinese) previously produced an empty
  // prefix and SKUs like "-PROD-001". Fall back to "GEN" when the prefix is empty.
  const vPrefix = (vendor || "GEN").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").substring(0, 4) || "GEN";
  const tSlug = (title || "").trim().toUpperCase()
    .replace(/[^A-Z0-9\s]/g, "")
    .split(/\s+/)
    .filter(word => word && !["A", "AN", "THE", "AND", "OR", "OF", "FOR", "TO", "WITH", "BY"].includes(word))
    .slice(0, 3)
    .join("-");
  
  const paddedIndex = String(index + 1).padStart(3, "0");
  return `${vPrefix}-${tSlug || "PROD"}-${paddedIndex}`;
}

function generateBodyHtml(title: string, vendor: string, productType: string): string {
  const t = title || "Product";
  const v = vendor || "our store";
  const typeText = productType ? ` in the ${productType} category` : "";
  
  return `<h3>Premium ${t}</h3>
<p>Discover the <strong>${t}</strong>, brought to you by <em>${v}</em>. Built for everyday use, it combines solid materials with a clean, practical design${typeText}.</p>
<ul>
  <li><strong>Durable materials:</strong> Made to hold up through daily use and repeated handling.</li>
  <li><strong>Practical design:</strong> A look that works as well on the shelf as it does in your hands.</li>
  <li><strong>Reliable quality:</strong> Consistent from unit to unit, so customers know what they are getting.</li>
</ul>
<p>Add it to your cart and see why it earns repeat orders.</p>`;
}

function generateTags(title: string, vendor: string, productType: string): string {
  const tagsList: string[] = [];
  if (vendor && vendor !== "My Store" && vendor !== "GEN") tagsList.push(vendor.trim());
  if (productType) tagsList.push(productType.trim());
  
  const keywords = (title || "").toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter(w => w.length > 3 && !["with", "from", "your", "that", "this", "premium", "super", "item", "product"].includes(w));
  
  keywords.slice(0, 3).forEach(kw => {
    const formattedKw = kw.charAt(0).toUpperCase() + kw.slice(1);
    if (!tagsList.includes(formattedKw)) {
      tagsList.push(formattedKw);
    }
  });

  return tagsList.join(", ");
}

export function repairHeaders(data: any[]): { repairedData: any[], mappings: Record<string, string>, fixesCount: number } {
  if (data.length === 0) return { repairedData: [], mappings: {}, fixesCount: 0 };
  
  const headers = Object.keys(data[0]);
  const mappings: Record<string, string> = {};
  let fixesCount = 0;
  
  const possibleMappings: Record<string, string[]> = {
    "Title": ["title", "product_name", "name", "Product Title", "ProductName", "item_name", "item"],
    "Variant Price": ["variant price", "variant_price", "price", "unit_price", "Value", "Price", "item_price", "cost", "selling_price", "retail_price"],
    "Image Src": ["image src", "image_src", "image url", "image_url", "img", "image", "picture", "photo", "main_image"],
    "Variant SKU": ["variant sku", "variant_sku", "sku", "SKUCode", "item_number", "id", "product_sku", "variant_sku"],
    "Handle": ["handle", "slug", "url_key", "permalink"],
    "Variant Inventory Qty": ["variant inventory qty", "variant_inventory_qty", "quantity", "qty", "stock", "inventory", "inventory_qty", "quantity_on_hand"]
  };

  // 1. Identify mappings needed
  for (const [standard, aliases] of Object.entries(possibleMappings)) {
    if (!headers.includes(standard)) {
      const foundAlias = headers.find(h => 
        h && typeof h === 'string' && aliases.some(a => a.toLowerCase() === h.toLowerCase())
      );
      if (foundAlias) {
        mappings[foundAlias] = standard;
      }
    }
  }

  // Pre-process rows to apply mappings first
  const mappedData = data.map(row => {
    if (!row || typeof row !== 'object') return row;
    const newRow = { ...row };
    Object.entries(mappings).forEach(([from, to]) => {
      if (row[from] !== undefined) {
        newRow[to] = row[from];
        if (from !== to) {
          delete newRow[from];
        }
      }
    });

    // Semantic Mapping: "source" -> "Vendor"
    const rawSource = newRow.source || newRow.Source;
    if (rawSource && !newRow.Vendor) {
      newRow.Vendor = String(rawSource);
      delete newRow.source;
      delete newRow.Source;
    }

    // Semantic Mapping: "category" -> "Standard Product Type"
    const rawCategory = newRow.category || newRow.Category || newRow.type || newRow.Type;
    if (rawCategory && !newRow["Standard Product Type"]) {
      newRow["Standard Product Type"] = String(rawCategory);
      delete newRow.category;
      delete newRow.Category;
      delete newRow.type;
      delete newRow.Type;
    }

    return newRow;
  });

  // Pre-pass: Resolve Handle Collision / Title Clashes
  //
  // Shopify merges rows into ONE product by Handle, so a variant block is a run of rows
  // that repeat the parent's Handle and leave Title blank on the continuation rows.
  // The previous grouping key was `handle::title`, which classified every blank-Title
  // continuation row as a different product: a normal 3-size export came back as
  // ["hoodie", "hoodie-1", "hoodie-1"] and Shopify silently split the catalog in two.
  //
  // The rule is now positional, matching Shopify's own reader:
  //   - a row with a non-empty Title OPENS a product;
  //   - a row with a blank Title is a variant continuation of the product currently
  //     open and inherits its Handle unchanged;
  //   - when Handle itself changes, a new product opens;
  //   - only a Handle that would be emitted twice for two DIFFERENT products gets a
  //     numeric suffix, and the suffix loop makes the output globally unique so no
  //     Handle can ever be emitted twice.
  const usedHandles = new Set<string>();
  // Handle slug -> the set of titles that legitimately belong to the product currently
  // open on that handle.
  const openHandleTitles = new Map<string, string>();
  const resolvedHandleByRow = new Array<string | undefined>(mappedData.length);
  let openHandle = '';       // slug of the product currently open
  let openRow = -1;          // row index where the open product started

  mappedData.forEach((row, idx) => {
    if (!row || typeof row !== 'object') { resolvedHandleByRow[idx] = undefined; return; }

    const rawTitle = String(row.Title || '').trim();
    let rawHandle = String(row.Handle || '').trim();
    const hadOwnHandle = !!rawHandle;
    if (!rawHandle && rawTitle) {
      rawHandle = rawTitle.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-_]/g, '');
    }
    const slug = hadOwnHandle ? slugifyHandle(rawHandle, idx) : (rawTitle ? slugifyHandle(rawTitle, idx) : '');

    // Both Handle and Title empty: this is a continuation row whose parent carried the
    // handle. Shopify carries the handle forward implicitly, so we do too — otherwise the
    // exported row lands with an empty Handle and Shopify starts a new nameless product.
    if (!slug && !rawTitle && openRow >= 0) {
      resolvedHandleByRow[idx] = resolvedHandleByRow[openRow];
      return;
    }

    if (!slug) { resolvedHandleByRow[idx] = undefined; return; }

    // Blank Title => variant continuation row of the product already open.
    if (!rawTitle) {
      // A continuation row whose handle matches the open product inherits it verbatim.
      // A continuation row on some OTHER handle (a file that starts mid-product, or a
      // stray row) opens its own group so the row survives instead of being renamed
      // into something the merchant did not ask for.
      const inheritsOpenProduct = slug === openHandle;
      resolvedHandleByRow[idx] = inheritsOpenProduct
        ? resolvedHandleByRow[openRow]
        : claimHandle(slug, usedHandles);
      if (!inheritsOpenProduct) {
        openHandle = slug;
        openRow = idx;
        openHandleTitles.set(slug, '');
      }
      return;
    }

    // Non-empty Title => this row opens a product.
    if (slug === openHandle) {
      // Same handle, another titled row. Shopify would MERGE these into the open
      // product, which silently discards one of the two titles. Give the new product
      // its own handle so both survive as separate products.
      const otherTitle = openHandleTitles.get(slug);
      if (otherTitle && otherTitle !== rawTitle) {
        resolvedHandleByRow[idx] = claimHandle(`${slug}-${idx + 1}`, usedHandles);
      } else {
        // Same handle and the same title: a repeated block for one product. Keep it.
        resolvedHandleByRow[idx] = resolvedHandleByRow[openRow];
        openHandleTitles.set(slug, rawTitle);
        return;
      }
    } else {
      resolvedHandleByRow[idx] = claimHandle(slug, usedHandles);
    }

    openHandle = slug;
    openRow = idx;
    openHandleTitles.set(slug, rawTitle);
  });

  function claimHandle(base: string, used: Set<string>): string {
    if (!used.has(base)) {
      used.add(base);
      return base;
    }
    let counter = 1;
    while (used.has(`${base}-${counter}`)) counter++;
    const final = `${base}-${counter}`;
    used.add(final);
    return final;
  }

  // Pre-pass 2: (SKU cross-handle detection is done in validateShopifyCSV; here we only
  // need a per-row counter so that ANY repeated SKU - within or across handles - gets a
  // unique suffix. Each Shopify variant requires a unique SKU.)

  // 2. Process data and apply robust fixes
  // Per-row SKU counter for dedup (each variant needs a unique SKU)
  const rowSkuCounts: Record<string, number> = {};
  const repairedData = mappedData.map((row, index) => {
    if (!row || typeof row !== 'object') return row;
    const newRow = { ...row };

    const titleVal = String(newRow.Title || "").trim();
    let rawHandle = String(newRow.Handle || "").trim();

    if (!rawHandle && titleVal) {
      rawHandle = slugifyHandle(titleVal, index);
    }
    const slugifiedHandle = slugifyHandle(rawHandle, index);

    const resolvedHandle = resolvedHandleByRow[index] ?? slugifiedHandle;

    if (newRow.Handle !== resolvedHandle) {
      newRow.Handle = resolvedHandle;
      fixesCount++;
    }

    // Fix Title Case Cleanup
    if (typeof newRow.Title === 'string' && newRow.Title === newRow.Title.toUpperCase() && newRow.Title.length > 5) {
      newRow.Title = newRow.Title.toLowerCase().split(' ').map((word: string) => 
        word.charAt(0).toUpperCase() + word.slice(1)
      ).join(' ');
      fixesCount++;
    }

    // Fix Price Formatting
    const originalPrice = String(newRow["Variant Price"] || "").trim();
    const formattedPrice = cleanAndFormatPrice(originalPrice);
    if (originalPrice !== formattedPrice) {
      newRow["Variant Price"] = formattedPrice;
      fixesCount++;
    }

    // Fix Inventory Quantity
    const originalQty = String(newRow["Variant Inventory Qty"] || "").trim();
    const formattedQty = cleanInventoryQty(originalQty);
    if (originalQty !== formattedQty) {
      newRow["Variant Inventory Qty"] = formattedQty;
      fixesCount++;
    }

    // Fix Image URL
    const originalImg = String(newRow["Image Src"] || "").trim();
    const typeVal = String(newRow["Standard Product Type"] || "");
    const formattedImg = cleanImageUrl(originalImg);
    if (originalImg !== formattedImg) {
      newRow["Image Src"] = formattedImg;
      fixesCount++;
    }

    // Fix HTML Body closed tags
    const originalBody = String(newRow["Body (HTML)"] || "").trim();
    if (originalBody) {
      const { closedHtml, closedTagsCount } = closeHtmlTags(originalBody);
      if (closedTagsCount > 0) {
        newRow["Body (HTML)"] = closedHtml;
        fixesCount += closedTagsCount;
      }
    } else {
      newRow["Body (HTML)"] = generateBodyHtml(titleVal, String(newRow.Vendor || "My Store"), typeVal);
      fixesCount++;
    }

    // Fix Tags Format
    const originalTags = String(newRow["Tags"] || "").trim();
    if (originalTags) {
      const cleanedTags = originalTags.split(',').map(t => t.trim()).filter(Boolean);
      const uniqueTags = Array.from(new Set(cleanedTags)).join(', ');
      if (originalTags !== uniqueTags) {
        newRow["Tags"] = uniqueTags;
        fixesCount++;
      }
    } else {
      newRow["Tags"] = generateTags(titleVal, String(newRow.Vendor || "My Store"), typeVal);
      fixesCount++;
    }

    // Ensure Defaults
    const productionDefaults: Record<string, string> = {
      "Status": "active",
      "Published": "true",
      "Variant Requires Shipping": "true",
      "Variant Taxable": "true",
      "Variant Inventory Tracker": "shopify",
      "Variant Inventory Policy": "deny",
      "Variant Fulfillment Service": "manual",
      "Variant Grams": "0",
      "Vendor": "My Store"
    };

    Object.entries(productionDefaults).forEach(([field, defaultVal]) => {
      if (!newRow[field] || !String(newRow[field]).trim()) {
        newRow[field] = defaultVal;
        fixesCount++;
      }
    });

    // Option1 Name & Value
    if (!newRow["Option1 Name"] || !String(newRow["Option1 Name"]).trim()) {
      newRow["Option1 Name"] = "Title";
      fixesCount++;
    }
    if (!newRow["Option1 Value"] || !String(newRow["Option1 Value"]).trim()) {
      newRow["Option1 Value"] = "Default Title";
      fixesCount++;
    }

    // Standardize Published State
    if (newRow["Published"]) {
      const pub = String(newRow["Published"]).toLowerCase().trim();
      if (["yes", "y", "true", "1", "published", "active"].includes(pub)) {
        newRow["Published"] = "true";
      } else {
        newRow["Published"] = "false";
      }
    }

    // Sku generator
    let currentSku = String(newRow["Variant SKU"] || "").trim();
    const isGenericSku = !currentSku || /^\d+$/.test(currentSku);
    if (isGenericSku) {
      const vendorName = String(newRow.Vendor || "My Store");
      currentSku = generateSKU(titleVal, vendorName, index);
      newRow["Variant SKU"] = currentSku;
      fixesCount++;
    }

    // Deduplicate ANY repeated SKU (within one handle or across handles) by appending
    // an incremental suffix. Walk the rows in order: first occurrence keeps the SKU,
    // second -> -1, third -> -2, etc.
    const skuAfterGen = String(newRow["Variant SKU"] || "").trim();
    if (skuAfterGen) {
      rowSkuCounts[skuAfterGen] = (rowSkuCounts[skuAfterGen] || 0) + 1;
      const occurrence = rowSkuCounts[skuAfterGen];
      if (occurrence > 1) {
        newRow["Variant SKU"] = `${skuAfterGen}-${occurrence - 1}`;
        fixesCount++;
      }
    }

    // Trim Whitespace
    Object.keys(newRow).forEach(k => {
      if (typeof newRow[k] === 'string') {
        const val = newRow[k] as string;
        const trimmed = val.trim();
        if (val !== trimmed) {
          newRow[k] = trimmed;
          fixesCount++;
        }
      }
    });

    // Map strictly to Shopify headers
    const filteredRow: Record<string, any> = {};
    SHOPIFY_HEADERS.forEach(header => {
      if (newRow[header] !== undefined) {
        filteredRow[header] = newRow[header];
      } else {
        if (["Body (HTML)", "Variant SKU", "Tags", "Option1 Name", "Option1 Value"].includes(header)) {
          filteredRow[header] = "";
        }
      }
    });

    return filteredRow;
  });

  return { repairedData, mappings, fixesCount };
}

export function transformToExportFormat(
  data: any[], 
  format: 'shopify-legacy' | 'shopify-multi' | 'simplified', 
  locationName: string = 'Default'
): any[] {
  const finalLocation = (locationName || 'Default').trim();
  
  return data.map(row => {
    const newRow: Record<string, any> = {};
    
    Object.keys(row).forEach(key => {
      let targetKey = key;
      if (format === 'shopify-multi' && key === 'Variant Inventory Qty') {
        targetKey = finalLocation;
      } else if (format === 'simplified') {
        if (key === 'Variant Inventory Tracker') targetKey = 'Inventory Tracker';
        else if (key === 'Variant Inventory Policy') targetKey = 'Inventory Policy';
        else if (key === 'Variant Inventory Qty') targetKey = 'Inventory Qty';
        else if (key === 'Variant Fulfillment Service') targetKey = 'Fulfillment Service';
      }
      newRow[targetKey] = row[key];
    });
    
    return newRow;
  });
}
