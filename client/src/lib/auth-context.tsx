import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { useLocation } from "wouter";
import { useRecaptcha } from "@/lib/recaptcha-context";
import { queryClient } from "@/lib/queryClient";
import { clearAuthenticatedQueryCache } from "@/lib/auth-query-cache";

export type UserRole = "admin" | "farmer" | "researcher";

interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  avatarUrl?: string | null;
  producerType?: string | null;
  hasDrones?: boolean | null;
  hasIoT?: boolean | null;
  techLevel?: string | null;
  farmingTypes?: string[] | null;
  currentPractices?: string[] | null;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAdmin: boolean;
  needsTechProfile: boolean;
  /** True when we are using a cached user because the server is unreachable. */
  isOfflineSession: boolean;
  refreshUser: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (data: RegisterData) => Promise<void>;
  logout: () => Promise<void>;
}

const CACHED_USER_KEY = "agregen-cached-user";

function readCachedUser(): User | null {
  try {
    const raw = localStorage.getItem(CACHED_USER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && parsed.id ? (parsed as User) : null;
  } catch {
    return null;
  }
}

function writeCachedUser(user: User | null): void {
  try {
    if (user) localStorage.setItem(CACHED_USER_KEY, JSON.stringify(user));
    else localStorage.removeItem(CACHED_USER_KEY);
  } catch {
    /* storage quota or disabled */
  }
}

/**
 * Purge every offline API/shell cache. Called on logout and whenever we
 * detect the authenticated user changed — without this, a cached
 * `/api/parcels` from a previous user could leak when the next user goes
 * offline on the same browser profile.
 */
async function purgeOfflineCaches(): Promise<void> {
  if (typeof caches === "undefined") return;
  try {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => k.includes("-api") || k.includes("-shell"))
        .map((k) => caches.delete(k)),
    );
  } catch {
    /* best-effort */
  }
}

interface RegisterData {
  name: string;
  email: string;
  passwordHash: string;
  role: "farmer" | "researcher";
  phone?: string;
  age?: number;
  gender?: "masculino" | "femenino" | "otro" | "prefiero_no_decir";
  schoolingYears?: number;
  farmingExperienceYears?: number;
  state?: string;
  municipality?: string;
  locality?: string;
  producerType?: "pequeno" | "mediano" | "grande";
  hasDrones?: boolean;
  hasIoT?: boolean;
  techLevel?: "basico" | "intermedio" | "avanzado";
  farmingTypes?: string[];
  currentPractices?: string[];
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  // Hydrate from cached user immediately so the offline shell renders the
  // logged-in UI without waiting for /api/auth/me.
  const [user, setUser] = useState<User | null>(() => readCachedUser());
  const [isLoading, setIsLoading] = useState(true);
  const [isOfflineSession, setIsOfflineSession] = useState(false);
  const [, setLocation] = useLocation();
  const getRecaptchaToken = useRecaptcha();

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      const response = await fetch("/api/auth/me", {
        credentials: "include",
      });

      if (response.ok) {
        const data = await response.json();
        // If the authenticated user changed (different account on same
        // browser), purge the offline API cache so the new user never sees
        // the prior user's cached data when offline.
        const prev = readCachedUser();
        if (prev?.id !== data.user.id) {
          await clearAuthenticatedQueryCache(queryClient);
          await purgeOfflineCaches();
        }
        setUser(data.user);
        writeCachedUser(data.user);
        setIsOfflineSession(false);
      } else if (response.status === 401) {
        // Server reachable but session expired — clear cached user + caches.
        await clearAuthenticatedQueryCache(queryClient);
        setUser(null);
        writeCachedUser(null);
        setIsOfflineSession(false);
        await purgeOfflineCaches();
      }
    } catch (error) {
      // Network failure → keep cached user (if any) and mark session offline.
      const cached = readCachedUser();
      if (cached) {
        setUser(cached);
        setIsOfflineSession(true);
      } else {
        console.error("Error checking auth:", error);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const login = async (email: string, password: string) => {
    setIsLoading(true);
    try {
      const recaptchaToken = await getRecaptchaToken("login");
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({ email, password, recaptchaToken }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || "Error al iniciar sesión");
      }

      const data = await response.json();
      const prev = readCachedUser();
      await clearAuthenticatedQueryCache(queryClient);
      if (prev?.id !== data.user.id) await purgeOfflineCaches();
      setUser(data.user);
      writeCachedUser(data.user);
      setIsOfflineSession(false);
      setLocation("/dashboard");
    } catch (error: any) {
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  const register = async (data: RegisterData) => {
    setIsLoading(true);
    try {
      const recaptchaToken = await getRecaptchaToken("register");
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({ ...data, recaptchaToken }),
      });

      if (!response.ok) {
        const responseData = await response.json();
        throw new Error(responseData.message || "Error al registrarse");
      }

      const responseData = await response.json();
      await clearAuthenticatedQueryCache(queryClient);
      await purgeOfflineCaches();
      setUser(responseData.user);
      writeCachedUser(responseData.user);
      setIsOfflineSession(false);
      setLocation("/dashboard");
    } catch (error: any) {
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    setIsLoading(true);
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      });
      await clearAuthenticatedQueryCache(queryClient);
      setUser(null);
      writeCachedUser(null);
      setIsOfflineSession(false);
      await purgeOfflineCaches();
      setLocation("/auth");
    } catch (error) {
      console.error("Error logging out:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const isAdmin = user?.role === "admin";
  const needsTechProfile = !!user && !user.producerType;

  const refreshUser = async () => {
    try {
      const response = await fetch("/api/auth/me", { credentials: "include" });
      if (response.ok) {
        const data = await response.json();
        if (user?.id !== data.user.id) {
          setIsLoading(true);
          await clearAuthenticatedQueryCache(queryClient);
          await purgeOfflineCaches();
        }
        setUser(data.user);
        writeCachedUser(data.user);
        setIsOfflineSession(false);
      }
    } catch (error) {
      // Network failure during refresh — keep current state, mark offline.
      setIsOfflineSession(true);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, isAdmin, needsTechProfile, isOfflineSession, refreshUser, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
