import ReplayBoard from "./ReplayBoard";

/**
 * The call board, driven by three synthetic calls replayed from disk.
 *
 * No network, no CALL-E, no phone. The fixtures in _replay.json were captures
 * of calls that actually happened; they are now written samples, because a
 * cold call's transcript is a recording of somebody who never agreed to be
 * published and this repository is public.
 *
 * The states are unchanged - a read-back that settles after an earlier one
 * did not, a confirmed rate that cannot be right, and the SIP 486 that never
 * connected - because those are what the page exists to show. The real
 * captures are kept privately.
 *
 * This exists because CALL-E's create endpoint has been returning 503
 * provider_unavailable - see our provider write-up, held privately - and because building
 * a live board by placing live calls is a bad way to build anything.
 */
export const metadata = { title: "Call board — replay" };

export default function CallBoardDevPage() {
  return <ReplayBoard />;
}
