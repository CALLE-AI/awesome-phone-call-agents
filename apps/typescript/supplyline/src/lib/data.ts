import { Load, Carrier, Quote, Booking, AppState } from './types';

export const initialLoads: Load[] = [
  {
    id: 'load-001',
    origin: 'Chicago, IL',
    destination: 'Atlanta, GA',
    equipmentType: 'Dry Van',
    pickupDate: '2026-09-01',
    weight: 43000,
    status: 'uncovered',
  },
];

export const initialCarriers: Carrier[] = [
  {
    id: 'carrier-a',
    name: 'Rockridge Transport LLC',
    phoneNumber: '+15550001001', // Example phone number for Carrier A
  },
  {
    id: 'carrier-b',
    name: 'Prairie Line Carriers',
    phoneNumber: '+15550001002', // Example phone number for Carrier B
  },
];

export const initialQuotes: Quote[] = [];
export const initialBookings: Booking[] = [];

export const createInitialState = (): AppState => ({
  loads: [...initialLoads],
  carriers: [...initialCarriers],
  quotes: [...initialQuotes],
  bookings: [...initialBookings],
  activeLoadId: 'load-001',
  isSourcing: false,
  currentRound: 0,
  error: null,
  recommendationSummary: null,
});
