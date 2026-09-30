"use strict";

/* Phase 2 procurement auto-chain — the visual/label logic for the sequence
   of calls fired from a single trigger:
   inventory -> reorder offer -> vendor order -> order status.

   app.js stays the orchestrator: it owns the modal, the poll loop, and the
   /api/checkins requests. This module is pure — given the run snapshots
   app.js has already fetched, it says which leg is "active" and how to
   render the trail underneath it. Nothing here calls the network or touches
   the DOM outside the strings it returns. Refs the 2026-09-10 auto-chain
   decision (server.py CHAIN_CAP) and the request to keep app.js from
   growing into one more monolith file.
*/

const CHAIN_LABEL = {
  inventory: "Morning check-in",
  sales: "Evening sales recap",
  reorder_offer: "Reorder offer",
  vendor_order: "Vendor call",
  order_status: "Owner update",
};

function chainLabel(callType){
  return CHAIN_LABEL[callType] || callType || "Call";
}

/* Beacon tone for one leg's current run snapshot (shape: /api/checkins/<key>). */
function chainTone(run){
  if(!run) return "waiting";
  if(run.phase === "failed") return "failed";
  if(run.done) return "done";
  if(run.phase === "in_progress") return "active";
  if(run.phase === "ringing") return "waiting";
  return "waiting";
}

/* Short label for the "now" line above the phase strip — a headline, not
   the explanation. The full error (CALL-E's own message, which can be a
   sentence) belongs in the result box below, styled as a callout, not
   stretched across the header where it reads like a crash dump. */
function chainStatusText(run){
  if(!run) return "Waiting to start";
  if(run.phase === "failed") return "Not placed";
  if(run.done) return "Completed";
  return {queued: "Queued", ringing: "Ringing", in_progress: "On the call"}[run.phase]
    || run.phase || "Queued";
}

/* Walk `runs` (key -> latest checkin snapshot) from `rootKey` following
   next_keys, returning every key reachable so far in discovery order. A
   fan-out (a reorder call naming two vendors) yields siblings in the order
   the server appended them to next_keys. Pure: safe to call every poll
   tick without tracking state of its own. */
function discoverChain(runs, rootKey){
  const order = [rootKey];
  for(let i = 0; i < order.length; i++){
    const run = runs[order[i]];
    for(const child of (run && run.next_keys) || []){
      if(!order.includes(child)) order.push(child);
    }
  }
  return order;
}

/* The leg that should drive the phase strip and clock: the first one not
   yet done, or the last one once the whole chain has finished. */
function activeLeg(order, runs){
  for(const key of order){
    const run = runs[key];
    if(!run || !run.done) return key;
  }
  return order[order.length - 1];
}

function allDone(order, runs){
  return order.every(key => runs[key] && runs[key].done);
}

/* The trail list under the phase strip. Empty string for a plain single
   call — the whole point is to surface a chain, not to relabel every call
   as one. */
function renderTrail(order, runs, activeKey, esc){
  if(order.length < 2) return "";
  const rows = order.map(key => {
    const run = runs[key];
    const tone = chainTone(run);
    const beaconClass = tone === "done" ? "done"
      : tone === "failed" ? "failed"
      : tone === "active" ? "live"
      : "waiting";
    const dim = key !== activeKey && run && run.done ? " dim" : "";
    const step = run && run.chain_position
      ? '<span class="chain-badge">Step ' + run.chain_position + "</span>" : "";
    return '<div class="trailrow' + dim + '">'
      + '<span class="beacon ' + beaconClass + '"></span>'
      + '<span class="trail-label">' + esc(chainLabel(run && run.call_type)) + step + "</span>"
      + '<span class="trail-sub">' + esc(chainStatusText(run)) + "</span>"
      + "</div>";
  }).join("");
  return '<div class="sub-label" style="margin-top:18px">Chain</div>'
    + '<div class="chaintrail">' + rows + "</div>";
}

const Chain = {
  chainLabel, chainTone, chainStatusText,
  discoverChain, activeLeg, allDone, renderTrail,
};
