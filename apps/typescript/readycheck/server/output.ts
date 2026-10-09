// Display-only copies: never change private request/evidence data used for binding.
export function maskOutputText(value: string): string {
  return value.replace(
    /\+[1-9][0-9]{6,14}\b|\+[1-9][0-9]{0,2}(?:[ ().-]+[0-9]{1,4}){2,5}|\([2-9][0-9]{2}\)[ .-]?[0-9]{3}[ .-]?[0-9]{4}\b|\b[2-9][0-9]{2}[ .-][0-9]{3}[ .-][0-9]{4}\b|\b[2-9][0-9]{9}\b/g,
    (phone) => {
      const digits = phone.replace(/[^0-9]/g, '');
      return digits.length >= 7 && digits.length <= 15
        ? `[phone …${digits.slice(-4)}]`
        : phone;
    },
  );
}

export function maskOutputPhones<T>(value: T): T {
  if (typeof value === 'string') return maskOutputText(value) as T;
  if (Array.isArray(value)) return value.map(maskOutputPhones) as T;
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, maskOutputPhones(item)]),
    ) as T;
  return value;
}
