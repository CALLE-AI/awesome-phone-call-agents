import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { getStoredApiKey, setStoredApiKey, UNAUTHORIZED_EVENT } from "./api";

/**
 * Blocks rendering of the dashboard until an admin API key is present.
 * Doesn't validate the key itself — the first real request will 401 and
 * bounce back here via the UNAUTHORIZED_EVENT if it's wrong.
 */
export function AuthGate({ children }: { children: ReactNode }): ReactNode {
  const [hasKey, setHasKey] = useState(() => getStoredApiKey() !== null);
  const [input, setInput] = useState("");

  useEffect(() => {
    const onUnauthorized = () => setHasKey(false);
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  if (hasKey) {
    return children;
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (input.trim() === "") return;
    setStoredApiKey(input.trim());
    setHasKey(true);
  };

  return (
    <div className="layout" style={{ alignItems: "center", justifyContent: "center", display: "flex" }}>
      <form onSubmit={onSubmit} className="card" style={{ width: 360 }}>
        <div className="sidebar-brand">
          AI <span>Front Desk</span>
        </div>
        <div className="field">
          <label htmlFor="api-key">Admin API key</label>
          <input
            id="api-key"
            className="input"
            type="password"
            autoFocus
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Paste the ADMIN_API_KEY value"
          />
        </div>
        <button type="submit" className="btn-primary" style={{ border: "none", padding: "10px 14px", cursor: "pointer" }}>
          Continue
        </button>
      </form>
    </div>
  );
}
