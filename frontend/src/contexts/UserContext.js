import React, { createContext, useState, useEffect } from 'react';
import { isDesktopRuntime } from '../desktop/runtime';
import { getAccessToken, setAccessToken, clearAccessToken } from '../auth/tokenStore';
import { logoutCurrentSession, refreshCurrentSession } from '../auth/sessionApi';

export const UserContext = createContext();

const UserProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [sessionReady, setSessionReady] = useState(false);

  useEffect(() => {
    let active = true;

    const restore = async () => {
      const userData = localStorage.getItem('user');
      const persisted = userData ? JSON.parse(userData) : null;

      if (!isDesktopRuntime() && persisted?.token) {
        setAccessToken(persisted.token);
        if (active) setUser(persisted);
        if (active) setSessionReady(true);
        return;
      }

      try {
        const session = await refreshCurrentSession();
        if (active && session?.user) setUser(session.user);
      } catch (error) {
        localStorage.removeItem('user');
      } finally {
        if (active) setSessionReady(true);
      }
    };

    restore();
    const expire = () => {
      clearAccessToken();
      setUser(null);
      localStorage.removeItem('user');
    };
    window.addEventListener('vca:session-expired', expire);
    return () => {
      active = false;
      window.removeEventListener('vca:session-expired', expire);
    };
  }, []);

  useEffect(() => {
    if (user) {
      const persisted = isDesktopRuntime() ? user : { ...user, token: getAccessToken() };
      localStorage.setItem('user', JSON.stringify(persisted));
    } else {
      localStorage.removeItem('user');
    }
  }, [user]);

  const login = (sessionData) => {
    const nextUser = sessionData.user || sessionData;
    const token = sessionData.accessToken || sessionData.token || nextUser.token;
    if (token) setAccessToken(token);
    setUser(nextUser);
  };

  const logout = async () => {
    await logoutCurrentSession().catch(() => {});
    clearAccessToken();
    setUser(null);
  };

  return (
    <UserContext.Provider value={{ user, login, logout, sessionReady }}>
      {children}
    </UserContext.Provider>
  );
};

export default UserProvider;
