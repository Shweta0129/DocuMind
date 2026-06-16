import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, tokenStore } from "./api";

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [org, setOrg] = useState(null);
  const [loading, setLoading] = useState(true);

  // Hydrate session from a stored token on first load.
  useEffect(() => {
    (async () => {
      if (!tokenStore.get()) {
        setLoading(false);
        return;
      }
      try {
        const data = await api.me();
        setUser(data.user);
        setOrg(data.organization);
      } catch {
        tokenStore.clear();
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const apply = (data) => {
    tokenStore.set(data.access_token);
    setUser(data.user);
    setOrg(data.organization);
    return data;
  };

  const login = useCallback(async (email, password) => apply(await api.login({ email, password })), []);
  const register = useCallback(async (payload) => apply(await api.register(payload)), []);
  const googleLogin = useCallback(
    async (credential, company_name) => apply(await api.googleLogin(credential, company_name)),
    []
  );
  const logout = useCallback(() => {
    tokenStore.clear();
    setUser(null);
    setOrg(null);
    window.location.href = "/login";
  }, []);

  return (
    <AuthCtx.Provider value={{ user, org, loading, isAuthed: !!user, login, register, googleLogin, logout }}>
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);
