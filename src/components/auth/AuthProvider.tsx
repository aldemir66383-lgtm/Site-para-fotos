import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { z } from "zod";
import { ApiError, apiRequest, userSchema, type AuthUser } from "./api";

interface AuthState {
  user: AuthUser | null; checking: boolean; error: string;
  refresh: () => Promise<void>;
  authenticated: (user: AuthUser) => void;
  logout: () => Promise<void>;
}
const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const initialized = useRef(false);
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    if (!initialized.current) setChecking(true);
    setError("");
    try {
      const result = await apiRequest("/api/auth/me", z.object({ user: userSchema }));
      if (current === generation.current) setUser(result.user);
    } catch (cause) {
      if (current !== generation.current) return;
      setUser(null);
      if (!(cause instanceof ApiError && cause.status === 401)) setError(cause instanceof Error ? cause.message : "Não foi possível verificar sua sessão.");
    } finally { if (current === generation.current) { initialized.current = true; setChecking(false); } }
  }, []);
  const authenticated = useCallback((value: AuthUser) => { generation.current++; initialized.current = true; setUser(value); setError(""); setChecking(false); }, []);
  const logout = useCallback(async () => {
    await apiRequest("/api/auth/logout", z.object({ success: z.literal(true) }), { method: "POST" });
    generation.current++; setUser(null); setError(""); setChecking(false);
    window.dispatchEvent(new Event("aire:session-changed"));
  }, []);
  useEffect(() => {
    void refresh();
    const recheck = () => { void refresh(); };
    const expired = () => { generation.current++; setUser(null); setChecking(false); setError(""); };
    window.addEventListener("focus", recheck);
    window.addEventListener("aire:access-changed", recheck);
    window.addEventListener("aire:unauthenticated", expired);
    return () => { generation.current++; window.removeEventListener("focus", recheck); window.removeEventListener("aire:access-changed", recheck); window.removeEventListener("aire:unauthenticated", expired); };
  }, [refresh]);
  return <AuthContext.Provider value={{ user, checking, error, refresh, authenticated, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("AuthProvider is required");
  return value;
}
