import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ErrorBoundary } from './components/ErrorBoundary/ErrorBoundary.tsx'
import { App } from './App.tsx'
import './index.scss'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary fallbackLabel="The dashboard crashed. Click 'Try Again' to reload.">
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
