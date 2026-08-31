export interface Product {
  sku: string;
  name: string;
  price: number;
  stock: number;
}

/** In memory on purpose: the example is about the timeline, not about having a real catalogue. */
export const PRODUCTS: Product[] = [
  { sku: 'SYN-001', name: 'Field notebook', price: 1800, stock: 42 },
  { sku: 'SYN-002', name: 'Mechanical pencil', price: 2400, stock: 17 },
  { sku: 'SYN-003', name: 'Timeline poster', price: 3200, stock: 8 },
  { sku: 'SYN-004', name: 'Trace-id mug', price: 1500, stock: 0 },
];

export function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
