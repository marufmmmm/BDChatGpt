import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { BDChatAdmin } from './admin/BDChatAdmin.tsx';
import './index.css';

const rootEl = document.getElementById('root')!;

// The WordPress admin screen gets its own simple page (no customer sidebar).
const isAdminScreen = rootEl.dataset.bdchatView === 'admin';

createRoot(rootEl).render(
  <StrictMode>
    {isAdminScreen ? <BDChatAdmin /> : <App />}
  </StrictMode>
);
