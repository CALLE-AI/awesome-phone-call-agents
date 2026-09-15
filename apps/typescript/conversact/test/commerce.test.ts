import assert from "node:assert/strict";
import test from "node:test";
import { DemoCommerce, CommerceError } from "../src/commerce.js";
import type { PurchaseIntent, Product } from "../src/types.js";

const catalog: Product[] = [{ id: "coffee-small", name: "Small Coffee", priceMinor: 350, currency: "USD", active: true, stock: 2 }];
const requested = (product_id = "coffee-small", quantity = 1): PurchaseIntent => ({ outcome: "order_requested", items: [{ product_id, quantity }], delivery_method: "pickup", customer_confirmed: "yes" });

test("commerce prices come from the catalog, not CALL-E evidence", async () => {
  const intent = requested() as PurchaseIntent & { price: number };
  intent.price = 1;
  const quote = await new DemoCommerce(catalog).quote(intent, "cv_test_001");
  assert.equal(quote.totalMinor, 350);
  assert.equal(quote.items[0]?.unitPriceMinor, 350);
});

test("unknown product, invalid quantity, and stock failure block a quote", async () => {
  const commerce = new DemoCommerce(catalog);
  await assert.rejects(() => commerce.quote(requested("dragon-fruit-gold"), "cv_test_001"), (error: unknown) => error instanceof CommerceError && error.code === "UNKNOWN_PRODUCT");
  await assert.rejects(() => commerce.quote(requested("coffee-small", 0), "cv_test_001"), (error: unknown) => error instanceof CommerceError && error.code === "INVALID_QUANTITY");
  await assert.rejects(() => commerce.quote(requested("coffee-small", 3), "cv_test_001"), (error: unknown) => error instanceof CommerceError && error.code === "OUT_OF_STOCK");
});
