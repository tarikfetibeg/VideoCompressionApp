import React, { useContext } from 'react';
import { Navigate } from 'react-router-dom';
import { UserContext } from '../contexts/UserContext';

const PrivateRoute = ({ children, roles }) => {
  const { user } = useContext(UserContext);

  if (!user) {
    return <Navigate to="/login" />;
  }

  if (roles && !roles.includes(user.user.role)) {
    return <Navigate to="/login" />;
  }

  return children;
};

export default PrivateRoute;
