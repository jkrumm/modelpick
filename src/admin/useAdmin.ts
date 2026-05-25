import { useCallback, useEffect, useState } from "react";

// Lightweight client-side admin gate (NOT real auth, per PRD). The admin key is
// stored in localStorage and sent to server fns which verify it against ADMIN_KEY.
// `viewMode` lets an admin preview the visitor experience without logging out.

const KEY_STORAGE = "adminKey";
const VIEW_STORAGE = "adminViewMode";
const CHANGE_EVENT = "modelpick:admin-change";

export type ViewMode = "admin" | "visitor";

export interface AdminState {
  /** The stored admin key, regardless of current view mode (null if logged out). */
  adminKey: string | null;
  viewMode: ViewMode;
  /** True when a key is stored AND the user is viewing as admin. */
  isAdmin: boolean;
  /** The key to send to mutations — the stored key when acting as admin, else null. */
  effectiveKey: string | null;
  /** True once localStorage has been read (avoids SSR/hydration flicker). */
  ready: boolean;
  login: (key: string) => void;
  logout: () => void;
  setViewMode: (mode: ViewMode) => void;
}

function readState(): { key: string | null; view: ViewMode } {
  if (typeof window === "undefined") return { key: null, view: "admin" };
  const key = window.localStorage.getItem(KEY_STORAGE);
  const view = window.localStorage.getItem(VIEW_STORAGE) === "visitor" ? "visitor" : "admin";
  return { key, view };
}

export function useAdmin(): AdminState {
  const [adminKey, setAdminKey] = useState<string | null>(null);
  const [viewMode, setViewModeState] = useState<ViewMode>("admin");
  const [ready, setReady] = useState(false);

  const sync = useCallback(() => {
    const { key, view } = readState();
    setAdminKey(key);
    setViewModeState(view);
    setReady(true);
  }, []);

  useEffect(() => {
    sync();
    const handler = () => sync();
    window.addEventListener(CHANGE_EVENT, handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener(CHANGE_EVENT, handler);
      window.removeEventListener("storage", handler);
    };
  }, [sync]);

  const broadcast = useCallback(() => {
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  const login = useCallback(
    (key: string) => {
      window.localStorage.setItem(KEY_STORAGE, key);
      window.localStorage.setItem(VIEW_STORAGE, "admin");
      broadcast();
    },
    [broadcast],
  );

  const logout = useCallback(() => {
    window.localStorage.removeItem(KEY_STORAGE);
    broadcast();
  }, [broadcast]);

  const setViewMode = useCallback(
    (mode: ViewMode) => {
      window.localStorage.setItem(VIEW_STORAGE, mode);
      broadcast();
    },
    [broadcast],
  );

  const isAdmin = adminKey !== null && viewMode === "admin";
  return {
    adminKey,
    viewMode,
    isAdmin,
    effectiveKey: isAdmin ? adminKey : null,
    ready,
    login,
    logout,
    setViewMode,
  };
}
