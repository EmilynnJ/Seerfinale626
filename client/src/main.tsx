import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import '@neondatabase/neon-js/ui/css';
import './styles/global.css';
import './styles/pages.css';

pendo.initialize({
  visitor: {
    id: ''
  }
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
