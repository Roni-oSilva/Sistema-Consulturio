import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import '@fontsource/cormorant-garamond/500.css';
import '@fontsource/cormorant-garamond/600.css';
import '@fontsource/cormorant-garamond/700.css';
import './styles/base.css';
import './styles/public.css';
import './styles/admin.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
