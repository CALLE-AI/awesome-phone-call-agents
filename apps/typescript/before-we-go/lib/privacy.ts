// Output minimization only, not complete PII redaction. Preserve the original
// evidence while matching quotes; mask the resulting display/storage copy.
const phonePattern = /\+[1-9](?:[\s().-]*[0-9]){6,14}(?![0-9])|(?<![0-9])(?:\([0-9]{3}\)|[0-9]{3})[ .-]?[0-9]{3}[ .-]?[0-9]{4}(?![0-9])/g;

export function maskPhones<T>(value:T):T {
 if(typeof value==='string')return value.replace(phonePattern,phone=>{
  const digits=phone.replace(/\D/g,'');
  return '[phone ending '+digits.slice(-4)+']';
 }) as T;
 if(Array.isArray(value))return value.map(item=>maskPhones(item)) as T;
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,maskPhones(item)])) as T;
 return value;
}
