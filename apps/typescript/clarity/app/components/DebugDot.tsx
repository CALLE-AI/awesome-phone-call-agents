/**
 * The entire visible surface of `?debug=1`.
 *
 * Debug mode renders the production components with mock data, so the only
 * thing that may distinguish it on screen is this dot — anything larger would
 * make the thing being iterated on look different from the thing that ships.
 */
export function DebugDot() {
  return (
    <span
      title="debug mode — mock data, no calls placed"
      className="fixed bottom-2.5 right-2.5 z-50 block size-2 rounded-full bg-red-500/90"
    >
      <span className="sr-only">Debug mode active</span>
    </span>
  );
}
