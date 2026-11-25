/**
 * Bộ selector Khung Neo Dòng Cha (Container Anchor) dùng chung giữa DomInspectorService và AtomicActionsService.
 * Ưu tiên các phần tử lặp nhỏ nhất (tr, [role="row"], li, article, card/product/item/ticket/record)
 * và loại bỏ selector mơ hồ [class*="row"] để không bắt nhầm lưới bao ngoài như Bootstrap .row hay Tailwind flex-grow.
 */
export const CONTAINER_TIER1_SELECTORS = Object.freeze([
  "tr",
  '[role="row"]',
  '[role="listitem"]',
  "article",
  '[role="article"]',
  "li",
  "figure",
  '[role="figure"]',
]);

export const CONTAINER_TIER2_SELECTORS = Object.freeze([
  '[class*="product"]',
  '[class*="card"]',
  '[class*="item"]',
  '[class*="ticket"]',
  '[class*="record"]',
  '[class*="figure"]',
]);

export const CONTAINER_ANCHOR_SELECTORS = Object.freeze([
  ...CONTAINER_TIER1_SELECTORS,
  ...CONTAINER_TIER2_SELECTORS,
]);

export const CONTAINER_ANCHOR_SELECTOR_STRING = CONTAINER_ANCHOR_SELECTORS.join(", ");
