const E164=/^\+[1-9]\d{7,14}$/;
export function normalizePhone(input:string):string { const v=input.trim().replace(/[\s().-]/g,''); if(!E164.test(v)) throw new Error('Phone must be E.164 formatted'); return v; }
export function normalizePhones(values:string[]):string[]{ return [...new Set(values.map(normalizePhone))]; }
