import React, { useContext } from 'react';
import { Navigate } from 'react-router-dom';
import { UserContext } from '../contexts/UserContext';

const PrivateRoute = ({ roles, children }) => {
  const { user } = useContext(UserContext);
  console.log('PrivateRoute: user role is', user ? user.role : 'No user');

  if (!user) {
    return <Navigate to="/login" />;
  }

  if (roles && !roles.includes(user.role)) {
    // Ako korisnik nema potrebni role, prikažu unauthorized.
    return <Navigate to="/unauthorized" />;
  }

  return children;
};

export default PrivateRoute;
