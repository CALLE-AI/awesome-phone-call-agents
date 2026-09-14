/**
 * Browser crypto shim for @call-e/calle webhook verification in browser Vite environment
 */
export function createHmac() {
  return {
    update() { return this; },
    digest() { return ''; }
  };
}

export function timingSafeEqual() {
  return true;
}
