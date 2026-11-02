import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import AnnouncementBanner from './components/AnnouncementBanner'
import ErrorBoundary from './components/ErrorBoundary'
import SiteStatusNotice from './components/SiteStatusNotice'
import { AuthProvider } from './lib/auth'
import { ConfirmProvider } from './lib/confirm'
import { ThemeProvider } from './lib/theme'
import { ToastProvider } from './lib/toast'
import './index.css'
import { registerServiceWorker } from './lib/pwa'

registerServiceWorker()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <ToastProvider>
        <ConfirmProvider>
          {/* Above the whole app, so it shows on every page (public, login, status screens, workspaces). A broken banner never takes a page down. */}
          <ErrorBoundary compact label="The announcement" resetKey="banner"><AnnouncementBanner /></ErrorBoundary>
          <ErrorBoundary compact label="The maintenance notice" resetKey="site-status"><SiteStatusNotice /></ErrorBoundary>
          <AuthProvider>
            <App />
          </AuthProvider>
        </ConfirmProvider>
      </ToastProvider>
    </ThemeProvider>
  </React.StrictMode>,
)
