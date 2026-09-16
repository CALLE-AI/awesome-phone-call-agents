import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Booking, FareRules, Flight } from "./types.ts";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");

function load<T>(name: string): T {
  return JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as T;
}

export interface Catalog {
  flights: Flight[];
  bookings: Booking[];
  rules: FareRules;
}

export function loadCatalog(): Catalog {
  return {
    flights: load<Flight[]>("flights.json"),
    bookings: load<Booking[]>("bookings.json"),
    rules: load<FareRules>("fare-rules.json"),
  };
}

export function findFlight(catalog: Catalog, id: string): Flight {
  const flight = catalog.flights.find((f) => f.id === id);
  if (!flight) throw new Error(`Unknown flight ${id}`);
  return flight;
}

export function findBooking(catalog: Catalog, pnr: string): Booking {
  const booking = catalog.bookings.find((b) => b.pnr === pnr);
  if (!booking) throw new Error(`Unknown booking ${pnr}`);
  return booking;
}
