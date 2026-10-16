import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { api, refreshSession } from './api.js';

const Ctx = createContext(null);
export const useAuth = () => useContext(Ctx);

const KEEPALIVE_MS = 10 * 60 * 1000;

// user: undefined = loading, null = signed out
export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined);

  // Initial load. Only a real 401 means "signed out"; network errors retry instead of logging out.
  useEffect(() => {
    let dead = false;
    let timer;
    const load = () => api('/auth/me').then((d) => !dead && setUser(d.user)).catch((e) => {
      if (dead) return;
      if (e.status === 401) setUser(null); else timer = setTimeout(load, 3000);
    });
    load();
    return () => { dead = true; clearTimeout(timer); };
  }, []);

  // Keep the session alive: renew while the tab is open, and the moment it becomes visible/online again.
  useEffect(() => {
    if (!user) return undefined;
    const renew = async () => { if ((await refreshSession()) === false) setUser(null); };
    const onVisible = () => { if (document.visibilityState === 'visible') renew(); };
    const iv = setInterval(renew, KEEPALIVE_MS);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', renew);
    return () => { clearInterval(iv); document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('online', renew); };
  }, [user]);

  useEffect(() => {
    const out = () => setUser(null);
    window.addEventListener('syncpad:signedout', out);
    return () => window.removeEventListener('syncpad:signedout', out);
  }, []);

  const value = useMemo(() => ({
    user,
    setUser,
    logout: async () => { await api('/auth/logout', { method: 'POST' }).catch(() => {}); setUser(null); },
  }), [user]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
