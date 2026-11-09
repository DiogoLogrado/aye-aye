import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ConfirmProvider, ToastProvider } from './components/feedback';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root element missing');

createRoot(root).render(
  <StrictMode>
    <ToastProvider>
      <ConfirmProvider>
        <App />
      </ConfirmProvider>
    </ToastProvider>
  </StrictMode>,
);
