export interface Load {
  id: string;
  origin: string;
  destination: string;
  equipmentType: string;
  pickupDate: string;
  weight: number;
  status: 'uncovered' | 'sourcing' | 'quoted' | 'negotiating' | 'recommended' | 'booked';
}

export interface Carrier {
  id: string;
  name: string;
  phoneNumber: string; // E.164 format, e.g. "+15551234567"
}

export interface Quote {
  id: string;
  loadId: string;
  carrierId: string;
  round: 1 | 2;
  available: 'yes' | 'no' | 'unknown';
  quotedRate: number | null;
  pickupConfirmed: 'yes' | 'no' | 'unknown';
  evidence: string;
  transcript: string;
  timestamp: string;
}

export interface Booking {
  id: string;
  loadId: string;
  winningQuoteId: string;
  finalRate: number;
  savingsVsOriginal: number;
  savingsVsNextBest: number;
  timestamp: string;
}

export interface AppState {
  loads: Load[];
  carriers: Carrier[];
  quotes: Quote[];
  bookings: Booking[];
  activeLoadId: string | null;
  isSourcing: boolean;
  currentRound: 0 | 1 | 2;
  error: string | null;
  recommendationSummary: string | null;
}
