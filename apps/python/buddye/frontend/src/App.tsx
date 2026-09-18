import { Navigate, Route, Routes } from 'react-router-dom'
import HazardLayout from './pages/HazardLayout'
import Operations from './pages/Operations'
import Sweep from './pages/Sweep'
import CasePage from './pages/CasePage'
import Incidents from './pages/Incidents'
import Approvals from './pages/Approvals'
import Fleet from './pages/Fleet'
import Console from './pages/Console'

/**
 * The console follows one thing happening, not five dashboards.
 *
 * A notification arrives -> it opens the CASE for one person -> the case is where a call is
 * launched and where its outcome lands -> the outcome raises a deployment for the human to approve
 * on `incidents` -> an approved deployment is watched on `operations`. `approvals` is the record of
 * what was decided, after the fact, not a place work waits.
 *
 * `HazardLayout` is a layout route rather than a wrapper component because it owns the SSE
 * connection and the REST rows: nesting the pages under it is what makes a navigation a re-render
 * instead of a reconnect. That matters more now — moving between a case and its incident must not
 * drop the stream that is feeding both.
 *
 * `/live` is the original single-page console. It predates this flow and is kept as a deep link:
 * it is still the densest view of a whole sweep, and losing it would cost the call-by-call reading
 * that the case pages deliberately narrow.
 */
export default function App() {
  return (
    <Routes>
      <Route path="/hazards/:hazardId" element={<HazardLayout />}>
        <Route index element={<Operations />} />
        <Route path="sweep" element={<Sweep />} />
        {/* One page per person under watch. This is where a call is decided on and read. */}
        <Route path="sweep/:neighbourId" element={<CasePage />} />
        <Route path="incidents" element={<Incidents />} />
        {/* Deep link from a case: opens the catalogue with this deployment already expanded. */}
        <Route path="incidents/:incidentId" element={<Incidents />} />
        <Route path="approvals" element={<Approvals />} />
        <Route path="fleet" element={<Fleet />} />
        <Route path="live" element={<Console />} />
      </Route>
      {/* No hazard in the URL: the layout lands on the newest one and rewrites the address. */}
      <Route path="/" element={<HazardLayout />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
