import { createApprovedBookingContract, maskPhone } from "./domain/booking-contract.js";
import { FixtureBookingProvider } from "./providers/calle/fixture-provider.js";
import { BookingCallService } from "./services/booking-call-service.js";
import { FileIdempotencyStore } from "./services/idempotency-store.js";

const contract = createApprovedBookingContract({
  restaurant: {
    name: "Harbor Test Kitchen",
    address: "100 Example Avenue, New York, NY",
    phone: "+12025550143",
  },
  reservation: {
    date: "2026-09-12",
    time: "19:30",
    timeZone: "America/New_York",
    partySize: 2,
    guestName: "Demo Guest",
    specialRequests: "Quiet table if available",
  },
});

console.log("DineLine CALL-E Edition fixture preview");
console.log({
  restaurant: contract.restaurant.name,
  destination: maskPhone(contract.restaurant.phone),
  date: contract.reservation.date,
  time: contract.reservation.time,
  partySize: contract.reservation.partySize,
  contractId: contract.contractId,
  idempotencyKey: contract.idempotencyKey,
});

const service = new BookingCallService(
  new FixtureBookingProvider("confirmed"),
  new FileIdempotencyStore(".call-journal"),
);

console.log(await service.execute(contract));
