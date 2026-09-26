// Landed cost + margin -> customer price. All rates from config/market.json;
// currency conversion APIs are deliberately not integrated.

import type { MarketConfig } from '../types.js';

export interface Pricing {
  landedCost: number;
  customerPrice: number;
}

export function priceQuote(unitPrice: number, market: MarketConfig): Pricing {
  const inTargetCurrency = unitPrice * market.fxRate;
  const withDuty = inTargetCurrency * (1 + market.customsDutyPct / 100);
  const withTax = withDuty * (1 + market.igstPct / 100);
  const withForexBuffer = withTax * (1 + market.forexBufferPct / 100);
  const landedCost = round2(withForexBuffer + market.freightPerUnit);
  const customerPrice = round2(landedCost * (1 + market.marginPct / 100));
  return { landedCost, customerPrice };
}

export function formatMoney(value: number, market: MarketConfig): string {
  return `${market.currencySymbol}${value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
