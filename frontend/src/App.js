// App.js

import React, { useContext } from 'react';
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
} from 'react-router-dom';
import { UserContext } from './contexts/UserContext';
import PrivateRoute from './components/PrivateRoute';
import Header from './components/Header';

// Import Pages
import LoginPage from './pages/LoginPage';
import ReporterDashboard from './pages/ReporterDashboard';
import EditorDashboard from './pages/EditorDashboard';
import VideoDetailsPage from './pages/VideoDetailsPage';
import NotFoundPage from './pages/NotFoundPage';
import AdminDashboard from './pages/AdminDashboard';

function App() {
  const { user } = useContext(UserContext);

  return (
    <Router>
      <Header />
      <Routes>
        {/* Public Routes */}
        <Route
          path="/login"
          element={user ? <Navigate to="/" /> : <LoginPage />}
        />

        {/* Default route based on user role:
            - Reporter and Admin users are redirected to the ReporterDashboard
              (so Admin users get the upload page by default).
            - Editor users go to the EditorDashboard.
            - Other roles (if any) or no user go to Login.
         */}
        <Route
          path="/"
          element={
            user ? (
              user.role === 'Reporter' || user.role === 'Admin' ? (
                <Navigate to="/reporter-dashboard" />
              ) : user.role === 'Editor' ? (
                <Navigate to="/editor-dashboard" />
              ) : (
                <Navigate to="/login" />
              )
            ) : (
              <Navigate to="/login" />
            )
          }
        />

        {/* Private Routes */}
        <Route
          path="/reporter-dashboard"
          element={
            <PrivateRoute roles={['Reporter', 'Admin']}>
              <ReporterDashboard />
            </PrivateRoute>
          }
        />
        <Route
          path="/admin-dashboard"
          element={
            <PrivateRoute roles={['Admin']}>
              <AdminDashboard />
            </PrivateRoute>
          }
        />
        <Route
          path="/editor-dashboard"
          element={
            <PrivateRoute roles={['Editor']}>
              <EditorDashboard />
            </PrivateRoute>
          }
        />

        {/* Other Routes */}
        <Route
          path="/video-details/:videoId"
          element={
            <PrivateRoute roles={['Reporter', 'Editor', 'VideoEditor', 'Producer', 'Admin']}>
              <VideoDetailsPage />
            </PrivateRoute>
          }
        />

        {/* Not Found */}
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Router>
  );
}

export default App;
