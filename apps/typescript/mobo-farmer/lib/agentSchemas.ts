export const inputStockSchema = {
  type: "object",
  required: ["item_available"],
  properties: {
    item_available: { type: "boolean", description: "Is item in stock" },
    price_per_bag: { type: "number", description: "Price ZAR per bag" },
    stock_quantity: { type: "number", description: "Bags in stock" },
    next_delivery_date: { type: "string", description: "Next delivery date" },
    alternative_product: { type: "string", description: "Alternative if out of stock" },
    supplier_name: { type: "string" }
  }
};
export const marketPriceSchema = {
  type: "object",
  required: ["price_per_kg"],
  properties: {
    price_per_kg: { type: "number" },
    grade_accepted: { type: "string" },
    payment_terms_days: { type: "number" },
    pickup_available: { type: "boolean" }
  }
};
export const waterAllocationSchema = {
  type: "object",
  required: ["confirmed"],
  properties: {
    allocation_liters: { type: "number" },
    ration_days: { type: "string" },
    confirmed: { type: "boolean" }
  }
};
