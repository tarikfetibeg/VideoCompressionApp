import React, { lazy, Suspense, useContext } from 'react';
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
} from 'react-router-dom';
import { Box, CircularProgress } from '@mui/material';
import { UserContext } from './contexts/UserContext';
import { BackgroundUploadProvider } from './contexts/BackgroundUploadContext';
import { BackgroundDownloadProvider } from './contexts/BackgroundDownloadContext';
import { NotificationProvider } from './contexts/NotificationContext';
import { RealtimeProvider } from './contexts/RealtimeContext';
import PrivateRoute from './components/PrivateRoute';
import AppShell from './components/layout/AppShell';
import DesktopRuntimeBridge from './desktop/DesktopRuntimeBridge';

const LoginPage = lazy(() => import('./pages/LoginPage'));
const ReporterDashboard = lazy(() => import('./pages/ReporterDashboard'));
const EditorDashboard = lazy(() => import('./pages/EditorDashboard'));
const EditJobDetailsPage = lazy(() => import('./pages/EditJobDetailsPage'));
const ProducerDashboard = lazy(() => import('./pages/ProducerDashboard'));
const RealizatorDashboard = lazy(() => import('./pages/RealizatorDashboard'));
const ArchivistDashboard = lazy(() => import('./pages/ArchivistDashboard'));
const FeedbackPage = lazy(() => import('./pages/FeedbackPage'));
const VideoDetailsPage = lazy(() => import('./pages/VideoDetailsPage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));
const AdminDashboard = lazy(() => import('./pages/AdminDashboard'));
const StoryboardPage = lazy(() => import('./pages/StoryboardPage'));
const MyWorkPage = lazy(() => import('./pages/MyWorkPage'));

const RouteLoading = () => (
  <Box sx={{ minHeight: '50vh', display: 'grid', placeItems: 'center' }}>
    <CircularProgress size={30} aria-label="Učitavanje radnog prostora" />
  </Box>
);

function App() {
  const { user } = useContext(UserContext);

  return (
    <BackgroundUploadProvider>
      <BackgroundDownloadProvider>
        <Router>
          <DesktopRuntimeBridge />
          <RealtimeProvider>
            <NotificationProvider>
            <AppShell>
              <Suspense fallback={<RouteLoading />}>
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
          element={user ? <Navigate to="/my-work" /> : <Navigate to="/login" />}
        />

        {/* Private Routes */}
        <Route
          path="/my-work"
          element={
            <PrivateRoute roles={['Reporter', 'Editor', 'VideoEditor', 'Producer', 'Realizator', 'Archivist', 'Admin']}>
              <MyWorkPage />
            </PrivateRoute>
          }
        />
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
        <Route
          path="/edit-jobs/:jobId/storyboard"
          element={
            <PrivateRoute roles={['Reporter', 'Editor', 'VideoEditor', 'Producer', 'Admin']}>
              <StoryboardPage />
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
            </NotificationProvider>
          </RealtimeProvider>
        </Router>
      </BackgroundDownloadProvider>
    </BackgroundUploadProvider>
  );
}

export default App;
