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

        {/* Redirect based on role */}
        <Route
          path="/"
          element={
            user ? (
              user.role === 'Reporter' ? (
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
            <PrivateRoute roles={['Reporter']}>
              <ReporterDashboard />
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
            <PrivateRoute roles={['Reporter', 'Editor', 'VideoEditor', 'Producer']}>
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
