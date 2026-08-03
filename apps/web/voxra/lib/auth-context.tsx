"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CalleUser {
  email: string | null;
  name:  string | null;
  picture: string | null;
}

type AuthStatus = "loading" | "authenticated" | "unauthenticated";

interface AuthState {
  status:  AuthStatus;
  user:    CalleUser | null;
  signIn:  () => Promise<void>;
  signOut: () => Promise<void>;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthState>({
  status:  "loading",
  user:    null,
  signIn:  async () => {},
  signOut: async () => {},
});

// ─── Provider ─────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user,   setUser]   = useState<CalleUser | null>(null);
  const pollRef             = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Check existing session ──────────────────────────────────────────────

  const checkSession = useCallback(async () => {
    try {
      const res  = await fetch("/api/auth/session");
      const data = await res.json();
      if (data?.session) {
        setUser(data.session);
        setStatus("authenticated");
      } else {
        setUser(null);
        setStatus("unauthenticated");
      }
    } catch {
      setStatus("unauthenticated");
    }
  }, []);

  useEffect(() => { checkSession(); }, [checkSession]);

  // Cleanup auth polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, []);

  // ── Sign in via CALL-E broker ───────────────────────────────────────────

  const signIn = useCallback(async () => {
    setStatus("loading");

    // 1. Create broker session
    const loginRes  = await fetch("/api/auth/login", { method: "POST" });
    const loginData = await loginRes.json();
    if (!loginRes.ok || !loginData.login_url || !loginData.auth_state) {
      setStatus("unauthenticated");
      throw new Error(loginData.error ?? "Failed to start login");
    }

    const { auth_state, login_url, poll_after_ms } = loginData;

    // 2. Open CALL-E auth URL in a popup
    const popup = window.open(login_url, "calle_auth", "width=520,height=640,left=200,top=100");
    if (!popup || popup.closed || typeof popup.closed === "undefined") {
      setStatus("unauthenticated");
      throw new Error("Popup was blocked. Please allow popups for this site and try again.");
    }

    // 3. Poll callback until AUTHORIZED or FAILED
    const delay = Math.max(2000, Number(poll_after_ms) || 2000);
    try {
      await new Promise<void>((resolve, reject) => {
        const startedAt = Date.now();
        let cancelled = false;

        const finish = (fn: () => void) => {
          cancelled = true;
          if (pollRef.current) {
            clearTimeout(pollRef.current);
            pollRef.current = null;
          }
          popup?.close();
          fn();
        };

        const tick = async () => {
          if (cancelled) return;
          if (Date.now() - startedAt > 5 * 60 * 1000) {
            finish(() => reject(new Error("Login timed out after 5 minutes")));
            return;
          }

          try {
            // If popup was closed early, keep polling (user may have auth'd and closed it)
            const res  = await fetch("/api/auth/callback", {
              method:  "POST",
              headers: { "Content-Type": "application/json" },
              body:    JSON.stringify({ auth_state }),
            });
            const data = await res.json();

            if (data.status === "ok") {
              finish(resolve);
              return;
            } else if (data.status === "failed") {
              finish(() => reject(new Error(data.error ?? "Authentication failed")));
              return;
            }
            // else still PENDING → keep polling
          } catch {
            // network hiccup — keep polling
          }

          pollRef.current = setTimeout(tick, delay);
        };

        pollRef.current = setTimeout(tick, delay);
      });

      await checkSession();
    } catch (err) {
      // Auth failed or timed out — reset to unauthenticated
      setStatus("unauthenticated");
      throw err;
    }
  }, [checkSession]);

  // ── Sign out ────────────────────────────────────────────────────────────

  const signOut = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch { /* ignore network errors on logout */ }
    setUser(null);
    setStatus("unauthenticated");
  }, []);

  return (
    <AuthContext.Provider value={{ status, user, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
