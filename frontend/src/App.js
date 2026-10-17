import React, { Suspense, lazy, useContext } from 'react';
import { LinearProgress } from '@mui/material';
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
} from 'react-router-dom';
import { UserContext } from './contexts/UserContext';
import { BackgroundUploadProvider } from './contexts/BackgroundUploadContext';
import { BackgroundDownloadProvider } from './contexts/BackgroundDownloadContext';
import { NotificationProvider } from './contexts/NotificationContext';
import PrivateRoute from './components/PrivateRoute';
import AppShell from './components/layout/AppShell';
import SessionRecoveryDialog from './components/SessionRecoveryDialog';

import LoginPage from './pages/LoginPage';
import NotFoundPage from './pages/NotFoundPage';

const ReporterDashboard = lazy(() => import('./pages/ReporterDashboard'));
const EditorDashboard = lazy(() => import('./pages/EditorDashboard'));
const EditJobDetailsPage = lazy(() => import('./pages/EditJobDetailsPage'));
const ProducerDashboard = lazy(() => import('./pages/ProducerDashboard'));
const RealizatorDashboard = lazy(() => import('./pages/RealizatorDashboard'));
const ArchivistDashboard = lazy(() => import('./pages/ArchivistDashboard'));
const FeedbackPage = lazy(() => import('./pages/FeedbackPage'));
const VideoDetailsPage = lazy(() => import('./pages/VideoDetailsPage'));
const AdminDashboard = lazy(() => import('./pages/AdminDashboard'));

function App() {
  const { user } = useContext(UserContext);

  return (
    <BackgroundUploadProvider>
      <BackgroundDownloadProvider>
        <Router>
          <NotificationProvider>
            <AppShell>
              <Suspense fallback={<LinearProgress aria-label="Učitavanje radnog prostora" />}>
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
            <PrivateRoute roles={['Editor', 'VideoEditor', 'Admin']}>
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
            <PrivateRoute roles={['Realizator', 'Admin']}>
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
            <PrivateRoute roles={['Reporter', 'Editor', 'VideoEditor', 'Producer', 'Realizator', 'Archivist', 'Admin']}>
              <VideoDetailsPage />
            </PrivateRoute>
          }
        />

        {/* Not Found */}
        <Route path="*" element={<NotFoundPage />} />
              </Routes>
              </Suspense>
            </AppShell>
            <SessionRecoveryDialog />
          </NotificationProvider>
        </Router>
      </BackgroundDownloadProvider>
    </BackgroundUploadProvider>
  );
}

export default App;
