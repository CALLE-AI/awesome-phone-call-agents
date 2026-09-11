export function maskPhone(value) {
  return value.replace(/\+[1-9]\d{7,14}/g, (phone) => {
    const suffix = phone.slice(-4);
    return `${phone.slice(0, 2)}••••${suffix}`;
  });
}

export function sanitizeForDisplay(value) {
  if (typeof value === "string") return maskPhone(value);
  if (Array.isArray(value)) return value.map(sanitizeForDisplay);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, sanitizeForDisplay(item)]),
    );
  }
  return value;
}
