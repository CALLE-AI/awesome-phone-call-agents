import assert from "node:assert/strict";
import test from "node:test";
import { callCalendarContext } from "../lib/call-calendar.ts";

test("call date follows the recipient's calendar across UTC midnight",()=>{
  const at=new Date("2026-09-11T06:30:00.000Z");
  const pacific=callCalendarContext("America/Los_Angeles",at);
  const eastern=callCalendarContext("America/New_York",at);
  assert.deepEqual(pacific,{
    prepared_at_utc:"2026-09-11T06:30:00.000Z",
    customer_timezone:"America/Los_Angeles",
    local_date_at_preparation:"Thursday, September 10, 2026",
    following_local_calendar_date:"Friday, September 11, 2026",
  });
  assert.equal(eastern.local_date_at_preparation,"Friday, September 11, 2026");
  assert.equal(eastern.following_local_calendar_date,"Saturday, September 12, 2026");
});

test("following calendar date handles daylight saving transitions and year rollover",()=>{
  for(const [instant,today,tomorrow] of [
    ["2026-11-01T07:30:00Z","Sunday, November 1, 2026","Monday, November 2, 2026"],
    ["2026-03-09T06:30:00Z","Sunday, March 8, 2026","Monday, March 9, 2026"],
    ["2027-01-01T03:30:00Z","Thursday, December 31, 2026","Friday, January 1, 2027"],
  ]){
    const context=callCalendarContext("America/Los_Angeles",new Date(instant));
    assert.equal(context.local_date_at_preparation,today);
    assert.equal(context.following_local_calendar_date,tomorrow);
  }
});
