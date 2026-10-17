import React, { createContext, useState, useEffect } from 'react';
import { bindSessionIdentity, cancelSession, pauseSession, readStoredUser, resumeSession, subscribeSession } from '../utils/sessionRecovery';

export const UserContext = createContext();

const UserProvider = ({ children }) => {
  const [user, setUser] = useState(() => { const stored = readStoredUser(); bindSessionIdentity(stored); return stored; });
  const [sessionExpired, setSessionExpired] = useState(false);
  const [sessionIdentityChanged, setSessionIdentityChanged] = useState(false);
  useEffect(() => subscribeSession((paused, reason) => { setSessionExpired(paused); setSessionIdentityChanged(reason === 'identity_changed'); }), []);
  useEffect(() => {
    const changed = (event) => {
      if (event.key !== 'user' && event.key !== null) return;
      const current = readStoredUser();
      if (user && (!current || String(current.id) !== String(user.id) || current.role !== user.role)) {
        pauseSession('identity_changed');
      } else {
        bindSessionIdentity(current); setUser(current); resumeSession();
      }
    };
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, [user]);

  useEffect(() => {
    if (user) {
      localStorage.setItem('user', JSON.stringify(user));
    } else {
      localStorage.removeItem('user');
    }
  }, [user]);

  const login = (userData) => {
    localStorage.setItem('user', JSON.stringify(userData));
    bindSessionIdentity(userData);
    setUser(userData);
    resumeSession();
  };

  const logout = () => {
    localStorage.removeItem('user');
    setUser(null);
    cancelSession();
  };

  return (
    <UserContext.Provider value={{ user, login, logout, sessionExpired, sessionIdentityChanged }}>
      {children}
    </UserContext.Provider>
  );
};

export default UserProvider;
