import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { queryClient } from "./queryClient";

type AuthState = {
  loading: boolean;
  email: string | null;
  login(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
};

const AdminAuthContext = createContext<AuthState | null>(null);

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/session", { credentials: "same-origin" })
      .then(async response => {
        if (!response.ok) return null;
        return response.json() as Promise<{ email: string }>;
      })
      .then(session => setEmail(session?.email ?? null))
      .finally(() => setLoading(false));
  }, []);

  const value = useMemo<AuthState>(() => ({
    loading,
    email,
    async login(loginEmail, password) {
      const response = await fetch("/api/admin/session", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: loginEmail, password }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error || "Unable to sign in");
      }
      const session = await response.json() as { email: string };
      queryClient.clear();
      setEmail(session.email);
    },
    async logout() {
      await fetch("/api/admin/session", { method: "DELETE", credentials: "same-origin" });
      queryClient.clear();
      setEmail(null);
    },
  }), [email, loading]);

  return <AdminAuthContext.Provider value={value}>{children}</AdminAuthContext.Provider>;
}

export function useAdminAuth() {
  const value = useContext(AdminAuthContext);
  if (!value) throw new Error("useAdminAuth must be used inside AdminAuthProvider");
  return value;
}