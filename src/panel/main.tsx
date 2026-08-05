import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../styles/app.css';
import { App } from './App.tsx';

const container = document.getElementById('root');
if (!container) throw new Error('panel root element is missing');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
