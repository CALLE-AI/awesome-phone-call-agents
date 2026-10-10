'use client';

import { createContext, useContext } from 'react';
import type { BusinessDto } from '@dial/schemas';

/**
 * The business the current section belongs to, loaded once by the layout.
 *
 * Before this, each page fetched the business for itself -- and three of the
 * five did not bother, passing `{ id }` to the header so the heading rendered
 * blank and the page appeared to lose its title on every second tab. One fetch
 * in the layout gives every tab the same name, and the header stops
 * re-mounting as you move between them.
 */

interface BusinessContextValue {
  business: BusinessDto;
  /** Re-reads the business after a settings change. */
  refresh: () => void;
}

const BusinessContext = createContext<BusinessContextValue | null>(null);

export const BusinessProvider = BusinessContext.Provider;

export function useBusiness(): BusinessContextValue {
  const value = useContext(BusinessContext);
  if (!value) {
    throw new Error('useBusiness must be used inside a business layout.');
  }
  return value;
}
