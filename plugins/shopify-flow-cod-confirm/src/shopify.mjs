/**
 * Shopify Admin API client, scoped to exactly what the gate writes back.
 *
 * The gate is deliberately low-permission: it reads one order and writes tags
 * plus a note on that order. It never creates products, customers, discounts or
 * fulfilments, so a leaked token cannot be used to move money.
 */

const API_VERSION = "2026-01";

export class ShopifyClient {
  constructor({ shopDomain, accessToken, apiVersion = API_VERSION, fetchImpl = globalThis.fetch } = {}) {
    if (!shopDomain) throw new Error("ShopifyClient requires shopDomain, e.g. my-store.myshopify.com.");
    if (!accessToken) throw new Error("ShopifyClient requires an Admin API access token.");
    this.shopDomain = shopDomain.replace(/^https?:\/\//, "").replace(/\/+$/, "");
    this.accessToken = accessToken;
    this.apiVersion = apiVersion;
    this.fetchImpl = fetchImpl;
    this.baseUrl = `https://${this.shopDomain}/admin/api/${this.apiVersion}`;
  }

  async #request(path, { method = "GET", body } = {}) {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: {
        "x-shopify-access-token": this.accessToken,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text().catch(() => "");
    const payload = text ? JSON.parse(text) : {};
    if (!response.ok) {
      const error = new Error(`Shopify ${method} ${path} failed: HTTP ${response.status}`);
      error.status = response.status;
      error.body = payload;
      throw error;
    }
    return payload;
  }

  async getOrder(orderId) {
    const payload = await this.#request(`/orders/${encodeURIComponent(orderId)}.json`);
    return payload?.order ?? payload;
  }

  /** Write the verdict back onto the order: tags plus a timeline note. */
  async writeVerdict(orderId, { tags, note }) {
    return this.#request(`/orders/${encodeURIComponent(orderId)}.json`, {
      method: "PUT",
      body: { order: { id: Number(orderId) || orderId, tags, note } },
    });
  }
}

/**
 * Verify a Shopify webhook HMAC.
 *
 * Without this anyone who learns the endpoint URL can make the gate phone
 * arbitrary numbers, which is both a spam vector and a bill.
 */
export async function verifyShopifyHmac({ rawBody, hmacHeader, secret }) {
  if (!hmacHeader || !secret) return false;
  const { createHmac, timingSafeEqual } = await import("node:crypto");
  const digest = createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
  const a = Buffer.from(digest, "utf8");
  const b = Buffer.from(String(hmacHeader), "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
