/** Structured pharmacy quotes. Unknown numeric values must remain null. */
export const offerSchema = {
  // CALL-E accepts simple array.items; enforce the three-offer limit locally.
  type: "array",
  items: {
    type: "object", additionalProperties: false,
    required: ["medicine", "brand", "strength", "form", "releaseType", "exactMatch", "stock_status", "pickup_readiness", "currency", "unit", "priceType", "purchaseMode", "quote"],
    properties: {
      medicine: { type: "string", description: "Confirmed active ingredient or exact requested medicine name; never infer brand equivalence." },
      brand: { type: "string" }, strength: { type: "string" }, form: { type: "string" },
      releaseType: { type: "string", description: "Confirmed release type: standard, extended, delayed, or unknown. Do not collapse unspecified modified-release products into a confirmed type." },
      exactMatch: { type: "boolean", description: "True only if staff explicitly confirmed the requested medicine, strength, form and release type." },
      stock_status: { type: "string", enum: ["in_stock", "limited", "out_of_stock", "unknown"] },
      pickup_readiness: { type: "string", enum: ["ready_today", "not_confirmed_today", "unknown"] },
      price: { type: "number", description: "Exact total quoted price for quantity. Omit this field for ranges, unknown prices or vague quotes; never use zero for unknown." },
      currency: { type: "string", description: "Explicitly confirmed three-letter currency code; empty if unknown." },
      quantity: { type: "number", description: "Number of tablets/capsules or mL/g covered by the price, not number of packs. Omit when unknown." },
      unit: { type: "string", enum: ["tablet", "capsule", "mL", "g", "unknown"] },
      priceType: { type: "string", enum: ["exact", "approximate", "range", "unknown"] },
      purchaseMode: { type: "string", enum: ["whole_pack", "per_unit", "unknown"], description: "whole_pack only if staff confirms quantity is one indivisible pack and price applies to every pack required; per_unit only if staff explicitly confirms the same proportional price for any requested quantity. Otherwise unknown; never infer from pack size." },
      availableQuantity: { type: "number", description: "Explicitly confirmed units available for purchase, in the same unit as quantity (not packs). Zero if none; omit if only general availability was confirmed. Never infer from pack size or in_stock status." },
      quote: { type: "string", description: "Original price and pack-size statement, including qualifications." },
    },
  },
};

/** @param {*} value */
function positive(value) { return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null; }

/** @param {*} value */
function normalized(value) {
  return String(value || "").toLowerCase().trim().replace(/milligrams/g, "mg").replace(/micrograms/g, "mcg").replace(/millilitres/g, "ml").replace(/grams/g, "g").replace(/\s+/g, "");
}

/** @param {*} value */
function canonicalUnit(value) {
  const key = normalized(value);
  return key === "ml" ? "mL" : ["tablet", "capsule", "g"].includes(key) ? key : "unknown";
}

/**
 * @param {*} offers
 * @param {Function} text
 */
export function sanitizeOffers(offers, text = value => typeof value === "string" ? value.trim().slice(0, 200) : "") {
  return (Array.isArray(offers) ? offers : []).slice(0, 3).filter(o => o && typeof o === "object" && !Array.isArray(o)).map(o => ({
    medicine: text(o.medicine), brand: text(o.brand), strength: text(o.strength), form: text(o.form), releaseType: text(o.releaseType),
    exactMatch: o.exactMatch === true,
    stock_status: ["in_stock", "limited", "out_of_stock"].includes(o.stock_status) ? o.stock_status : "unknown",
    pickup_readiness: ["ready_today", "not_confirmed_today"].includes(o.pickup_readiness) ? o.pickup_readiness : "unknown",
    price: positive(o.price), quantity: positive(o.quantity),
    purchaseMode: ["whole_pack", "per_unit"].includes(o.purchaseMode) ? o.purchaseMode : "unknown",
    availableQuantity: typeof o.availableQuantity === "number" && Number.isFinite(o.availableQuantity) && o.availableQuantity >= 0 ? o.availableQuantity : null,
    currency: /^[A-Z]{3}$/.test(String(o.currency || "").trim().toUpperCase()) ? String(o.currency).trim().toUpperCase() : "",
    unit: canonicalUnit(o.unit),
    priceType: ["exact", "approximate", "range"].includes(o.priceType) ? o.priceType : "unknown", quote: text(o.quote),
  }));
}

/** Only explicitly matching products enter the comparable shortlist.
 * @param {Object} record
 * @param {Object} offer
 */
function matches(record, offer) {
  const p = record.productRequest;
  return Boolean(p && p.strengthValue && p.strengthUnit && p.form && p.releaseType && offer.exactMatch
    && normalized(offer.medicine) === normalized(record.medicine)
    && normalized(offer.strength) === normalized(`${p.strengthValue} ${p.strengthUnit}`)
    && normalized(offer.form) === normalized(p.form)
    && normalized(offer.releaseType) === normalized(p.releaseType));
}

/** Unit of the requested purchase quantity, derived from the dosage form.
 * @param {string} form - Requested dosage form.
 * @returns {string|undefined} Comparable quantity unit.
 */
export function quantityUnit(form) {
  return ({ tablet: "tablet", capsule: "capsule", syrup: "mL", suspension: "mL", cream: "g" })[normalized(form)];
}

/** Calculate a purchase only from explicit, exact pricing and purchase terms.
 * @param {Object} offer - Sanitized offer.
 * @param {number} requested - Requested quantity in offer units.
 * @param {number|null} unitPrice - Verified comparable unit price.
 * @returns {Object} Estimate and separate evidence of sufficient stock.
 */
function estimatePurchase(offer, requested, unitPrice) {
  const unknown = { total: null, packs: null, purchaseQuantity: null, extraQuantity: null, stock: "unknown" };
  if (!positive(requested) || unitPrice === null || offer.purchaseMode === "unknown") return unknown;
  if (["tablet", "capsule"].includes(offer.unit) && (!Number.isSafeInteger(requested) || !Number.isSafeInteger(offer.quantity) || (offer.availableQuantity !== null && !Number.isSafeInteger(offer.availableQuantity)))) return unknown;
  const packs = offer.purchaseMode === "whole_pack" ? Math.ceil(Number((requested / offer.quantity).toPrecision(15))) : null;
  const purchaseQuantity = packs === null ? requested : Number((packs * offer.quantity).toPrecision(15));
  // Remove binary arithmetic noise without assuming a currency's minor unit.
  const total = Number((packs === null ? requested * unitPrice : packs * offer.price).toPrecision(15));
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(purchaseQuantity) || (packs !== null && !Number.isSafeInteger(packs))) return unknown;
  return { total, packs, purchaseQuantity, extraQuantity: Math.max(0, Number((purchaseQuantity - requested).toPrecision(15))),
    stock: offer.availableQuantity === null ? "unknown" : offer.availableQuantity >= purchaseQuantity ? "sufficient" : "insufficient" };
}

/** Build display rows without mutating saved order or transcript indexes.
 * @param {Object} record
 * @param {Object} options
 */
export function compareOffers(record, options = {}) {
  const { sort = "price", brand = "", today = false } = options;
  const requested = positive(record.productRequest?.requestedQuantity);
  const budgetActive = options.budget !== undefined && options.budget !== null;
  const budgetValid = typeof options.budget === "number" && Number.isFinite(options.budget) && options.budget >= 0 && /^[A-Z]{3}$/.test(options.budgetCurrency || "");
  const priceWeight = typeof options.priceWeight === "number" && Number.isFinite(options.priceWeight)
    ? Math.round(Math.max(0, Math.min(100, options.priceWeight))) : 50;
  const eligible = [], other = [];
  (record.results || []).forEach((result, resultIndex) => {
    const offers = sanitizeOffers(result.result?.offers);
    if (!offers.length) {
      other.push({ result, resultIndex, offer: null, reason: "No structured offer; original quote is not comparable." });
      return;
    }
    offers.forEach((offer, offerIndex) => {
      const distance = typeof result.distanceKm === "number" && Number.isFinite(result.distanceKm) && result.distanceKm >= 0 ? result.distanceKm : null;
      const unitCompatible = quantityUnit(offer.form) === offer.unit;
      const unitPrice = offer.priceType === "exact" && offer.price !== null && offer.quantity !== null && offer.currency && unitCompatible
        && Number.isFinite(offer.price / offer.quantity) ? offer.price / offer.quantity : null;
      const purchase = estimatePurchase(offer, requested, unitPrice);
      const row = { result, resultIndex, offer, offerIndex, distance, unitPrice, purchase, rankingPrice: requested ? purchase.total : unitPrice };
      if (!matches(record, offer)) row.reason = "Product match not confirmed; review with the pharmacist.";
      else if (result.error || !["in_stock", "limited"].includes(offer.stock_status)) row.reason = "Availability not confirmed.";
      else if (brand && normalized(offer.brand) !== normalized(brand)) row.reason = "Outside selected brand preference.";
      else if (today && offer.pickup_readiness !== "ready_today") row.reason = "Pickup today not confirmed.";
      else if (requested && purchase.total === null) row.reason = "Estimated total unavailable: confirm exact price, pack size and purchase terms.";
      else if (requested && purchase.stock !== "sufficient") row.reason = purchase.stock === "insufficient" ? "Insufficient confirmed stock for the required purchase quantity." : "Enough stock for the required purchase quantity is not confirmed.";
      else if (budgetActive && (!requested || !budgetValid)) row.reason = "A requested quantity, valid budget and currency are required to filter totals.";
      else if (budgetActive && offer.currency !== options.budgetCurrency) row.reason = "Outside budget currency; no currency conversion applied.";
      else if (budgetActive && purchase.total > options.budget) row.reason = "Estimated total exceeds your budget.";
      if (row.reason) other.push(row); else eligible.push(row);
    });
  });
  const groups = new Map();
  eligible.forEach(row => {
    const key = row.unitPrice === null ? "Price not comparable" : `${row.offer.currency} / ${row.offer.unit}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  });
  for (const [key, rows] of groups) {
    const complete = rows.filter(row => row.rankingPrice !== null && row.distance !== null);
    if (sort === "balance") {
      const prices = complete.map(row => row.rankingPrice), distances = complete.map(row => row.distance);
      const minPrice = Math.min(...prices), maxPrice = Math.max(...prices);
      const minDistance = Math.min(...distances), maxDistance = Math.max(...distances);
      for (const row of rows) {
        row.balanceScore = row.rankingPrice === null || row.distance === null ? null
          : (priceWeight / 100) * (maxPrice === minPrice ? 0 : (row.rankingPrice - minPrice) / (maxPrice - minPrice))
            + (1 - priceWeight / 100) * (maxDistance === minDistance ? 0 : (row.distance - minDistance) / (maxDistance - minDistance));
      }
    }
    rows.sort((a, b) => sort === "balance"
      ? (a.balanceScore ?? Infinity) - (b.balanceScore ?? Infinity) || (a.rankingPrice ?? Infinity) - (b.rankingPrice ?? Infinity) || (a.distance ?? Infinity) - (b.distance ?? Infinity)
      : sort === "total"
      ? (a.purchase.total ?? Infinity) - (b.purchase.total ?? Infinity) || (a.distance ?? Infinity) - (b.distance ?? Infinity)
      : sort === "distance"
      ? (a.distance ?? Infinity) - (b.distance ?? Infinity) || (a.unitPrice ?? Infinity) - (b.unitPrice ?? Infinity)
      : (a.unitPrice ?? Infinity) - (b.unitPrice ?? Infinity) || (a.distance ?? Infinity) - (b.distance ?? Infinity));
    const tiedBest = sort === "balance" ? complete.filter(row => Math.abs(row.balanceScore - rows[0].balanceScore) < 1e-9).length : 0;
    rows.forEach((row, index) => {
      const best = rows[0];
      row.reason = sort === "distance" && row.distance !== null && row.distance === best.distance
        ? "Nearest confirmed available option in this group."
        : sort === "price" && row.unitPrice !== null && row.unitPrice === best.unitPrice
          ? "Lowest confirmed unit price in this group."
          : key === "Price not comparable" ? "Price, currency or quantity is unconfirmed; no price recommendation." : "Confirmed matching offer.";
      if (sort === "balance") {
        row.reason = row.balanceScore === null ? "Balance not ranked: exact unit price and distance are both required."
          : `${complete.length === 1 ? "Only offer with confirmed price and distance" : Math.abs(row.balanceScore - best.balanceScore) < 1e-9 ? (tiedBest > 1 ? "Joint best balance" : "Best balance") : "Matching option"} in this group. ${priceWeight}% price / ${100 - priceWeight}% distance; weighted cost ${(row.balanceScore * 100).toFixed(1)} / 100 (lower is better).`;
        if (requested) row.reason += " Price priority uses estimated purchase total.";
      }
      if (sort === "total" && row.purchase.total !== null && row.purchase.total === best.purchase.total) row.reason = "Lowest estimated purchase total in this group.";
      row.rank = index + 1;
    });
  }
  return { groups: [...groups].map(([label, rows]) => ({ label, rows })), other };
}

/** Summarize the current eligible offers independently of table sort order.
 * Price and balance winners stay within their currency/unit groups; all ties
 * are retained. Distance can be compared across those groups.
 * @param {Object} record - Saved check record.
 * @param {Object} options - Brand, pickup and price-weight preferences.
 * @returns {Object} Evidence-backed selections for the summary cards.
 */
export function summarizeOffers(record, options = {}) {
  const comparison = compareOffers(record, { ...options, sort: "balance" });
  const eligible = comparison.groups.flatMap(group => group.rows);
  const price = [], balance = [], total = [];
  for (const group of comparison.groups) {
    const priced = group.rows.filter(row => row.unitPrice !== null);
    const scored = group.rows.filter(row => row.balanceScore !== null);
    const estimated = group.rows.filter(row => row.purchase.total !== null);
    if (estimated.length) {
      const lowest = Math.min(...estimated.map(row => row.purchase.total));
      total.push({ label: group.label, rows: estimated.filter(row => row.purchase.total === lowest) });
    }
    if (priced.length) {
      const lowest = Math.min(...priced.map(row => row.unitPrice));
      price.push({ label: group.label, rows: priced.filter(row => row.unitPrice === lowest) });
    }
    if (scored.length) {
      const lowest = Math.min(...scored.map(row => row.balanceScore));
      balance.push({ label: group.label, rows: scored.filter(row => Math.abs(row.balanceScore - lowest) < 1e-9) });
    }
  }
  const located = eligible.filter(row => row.distance !== null);
  const nearestDistance = Math.min(...located.map(row => row.distance));
  return {
    price, balance, total,
    nearest: located.filter(row => row.distance === nearestDistance),
    brandName: options.brand || "",
    brand: options.brand ? eligible : [],
  };
}
