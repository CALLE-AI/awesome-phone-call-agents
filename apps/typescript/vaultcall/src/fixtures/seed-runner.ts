import { store } from '../lib/store';

console.log('Seeding VaultCall database with judge fast-path fixtures...');
store.seed();
const count = store.listVerifications().length;
console.log(`Successfully seeded ${count} audit verification records.`);
console.log('1. CyberShield Technologies Inc. (CONFIRMED_VALID - $240,000)');
console.log('2. Apex Global Logistics LLC (FRAUD_INTERCEPTED - $785,000)');
console.log('3. Meridian Health Partners (GATEKEEPER_HOLD - $125,000)');
