import React, { useContext } from 'react';
import { Navigate } from 'react-router-dom';
import { UserContext } from '../contexts/UserContext';

const PrivateRoute = ({ roles, children }) => {
  const { user } = useContext(UserContext);

  if (!user) {
    return <Navigate to="/login" />;
  }

  if (roles && !roles.includes(user.role)) {
    // If the user does not have the required role, redirect or show an error
    return <Navigate to="/unauthorized" />;
  }

  return children;
};

export default PrivateRoute;
