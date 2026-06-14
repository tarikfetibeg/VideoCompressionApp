import React, { useContext } from 'react';
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
} from 'react-router-dom';
import { UserContext } from './contexts/UserContext';
import { BackgroundUploadProvider } from './contexts/BackgroundUploadContext';
import PrivateRoute from './components/PrivateRoute';
import Header from './components/Header';

// Import Pages
import LoginPage from './pages/LoginPage';
import ReporterDashboard from './pages/ReporterDashboard';
import EditorDashboard from './pages/EditorDashboard';
import EditJobDetailsPage from './pages/EditJobDetailsPage';
import ProducerDashboard from './pages/ProducerDashboard';
import RealizatorDashboard from './pages/RealizatorDashboard';
import ArchivistDashboard from './pages/ArchivistDashboard';
import FeedbackPage from './pages/FeedbackPage';
import VideoDetailsPage from './pages/VideoDetailsPage';
import NotFoundPage from './pages/NotFoundPage';
import AdminDashboard from './pages/AdminDashboard';

function App() {
  const { user } = useContext(UserContext);

  return (
    <BackgroundUploadProvider>
      <Router>
        <Header />
        <Routes>
        {/* Public Routes */}
        <Route
          path="/login"
          element={user ? <Navigate to="/" /> : <LoginPage />}
        />

        {/* Rute bazirane na ulogama korisnika:
            - Reporteri i Admini po defoultu učitavaju reporter-dashboard
              (tako da Admini po defoultu vide upload stranicu).
            - Editori po defoultu budu preusmjereni prema editor-dashbourdu
            - Drugi tipovi korisnika ne budu preusmjereni nigdje pa im se opet učita log in stranica
         */}
        <Route
          path="/"
          element={
            user ? (
              user.role === 'Reporter' || user.role === 'Admin' ? (
                <Navigate to="/reporter-dashboard" />
              ) : user.role === 'Producer' ? (
                <Navigate to="/producer-dashboard" />
              ) : user.role === 'Realizator' ? (
                <Navigate to="/realizator-dashboard" />
              ) : user.role === 'Archivist' ? (
                <Navigate to="/archivist-dashboard" />
              ) : ['Editor', 'VideoEditor'].includes(user.role) ? (
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
            <PrivateRoute roles={['Editor', 'VideoEditor', 'Producer', 'Admin']}>
              <EditorDashboard />
            </PrivateRoute>
          }
        />
        <Route
          path="/producer-dashboard"
          element={
            <PrivateRoute roles={['Producer', 'Admin']}>
              <ProducerDashboard />
            </PrivateRoute>
          }
        />
        <Route
          path="/realizator-dashboard"
          element={
            <PrivateRoute roles={['Realizator', 'Producer', 'Admin']}>
              <RealizatorDashboard />
            </PrivateRoute>
          }
        />
        <Route
          path="/archivist-dashboard"
          element={
            <PrivateRoute roles={['Archivist', 'Admin']}>
              <ArchivistDashboard />
            </PrivateRoute>
          }
        />
        <Route
          path="/feedback"
          element={
            <PrivateRoute roles={['Reporter', 'Editor', 'VideoEditor', 'Producer', 'Realizator', 'Archivist', 'Admin']}>
              <FeedbackPage />
            </PrivateRoute>
          }
        />
        <Route
          path="/edit-jobs/:jobId"
          element={
            <PrivateRoute roles={['Reporter', 'Editor', 'VideoEditor', 'Producer', 'Admin']}>
              <EditJobDetailsPage />
            </PrivateRoute>
          }
        />

        {/* Other Routes */}
        <Route
          path="/video-details/:videoId"
          element={
            <PrivateRoute roles={['Reporter', 'Editor', 'VideoEditor', 'Producer', 'Archivist', 'Admin']}>
              <VideoDetailsPage />
            </PrivateRoute>
          }
        />

        {/* Not Found */}
        <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Router>
    </BackgroundUploadProvider>
  );
}

export default App;
