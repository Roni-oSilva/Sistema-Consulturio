import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Títulos: Archivo (variável com eixo de largura) · Texto: Plus Jakarta Sans
import '@fontsource-variable/archivo/wdth.css';
import '@fontsource-variable/plus-jakarta-sans';
// Serifada usada apenas no monograma "JR" do logo da clínica
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
