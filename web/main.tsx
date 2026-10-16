import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PurlManager } from './PurlManager';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PurlManager />
  </StrictMode>,
);