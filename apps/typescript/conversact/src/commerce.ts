import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { CommercePort, CommerceQuote, Product, PurchaseIntent } from "./types.js";

export class CommerceError extends Error {
  constructor(readonly code: "UNKNOWN_PRODUCT" | "INACTIVE_PRODUCT" | "INVALID_QUANTITY" | "OUT_OF_STOCK", message: string) {
    super(message);
  }
}

export class DemoCommerce implements CommercePort {
  constructor(private readonly catalog: Product[]) {}

  static fromFixture(path = resolve(import.meta.dirname, "../fixtures/catalog.json")): DemoCommerce {
    return new DemoCommerce(JSON.parse(readFileSync(path, "utf8")) as Product[]);
  }

  async quote(intent: PurchaseIntent, sessionId: string): Promise<CommerceQuote> {
    const items = intent.items.map((requested) => {
      if (!Number.isInteger(requested.quantity) || requested.quantity <= 0) {
        throw new CommerceError("INVALID_QUANTITY", `quantity for ${requested.product_id} must be a positive integer`);
      }
      const product = this.catalog.find((candidate) => candidate.id === requested.product_id);
      if (product === undefined) throw new CommerceError("UNKNOWN_PRODUCT", `product ${requested.product_id} is not in the catalog`);
      if (!product.active) throw new CommerceError("INACTIVE_PRODUCT", `product ${requested.product_id} is inactive`);
      if (product.stock < requested.quantity) throw new CommerceError("OUT_OF_STOCK", `product ${requested.product_id} has insufficient stock`);
      const lineTotalMinor = product.priceMinor * requested.quantity;
      return { productId: product.id, name: product.name, quantity: requested.quantity, unitPriceMinor: product.priceMinor, lineTotalMinor };
    });
    const subtotalMinor = items.reduce((sum, item) => sum + item.lineTotalMinor, 0);
    const deliveryMinor = intent.delivery_method === "standard" ? 250 : 0;
    return { quoteId: `quote_${sessionId}`, items, subtotalMinor, deliveryMinor, totalMinor: subtotalMinor + deliveryMinor, currency: "USD" };
  }
}
