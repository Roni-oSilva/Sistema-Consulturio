import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Loading, ToastProvider } from './components/ui';
import { PublicLayout } from './pages/public/PublicLayout';
import { Home } from './pages/public/Home';
import { Booking } from './pages/public/Booking';
import { Manage } from './pages/public/Manage';
import { Lookup } from './pages/public/Lookup';
import { Privacy } from './pages/public/Privacy';
import { NotFound } from './pages/public/NotFound';

// O painel administrativo é carregado sob demanda (não pesa para o paciente).
const AdminApp = lazy(() => import('./pages/admin/AdminApp'));

export function App() {
  return (
    <ToastProvider>
      <BrowserRouter>
        <Routes>
          <Route
            path="/admin/*"
            element={
              <Suspense fallback={<Loading text="Abrindo o painel..." />}>
                <AdminApp />
              </Suspense>
            }
          />
          <Route element={<PublicLayout />}>
            <Route index element={<Home />} />
            <Route path="agendar" element={<Booking />} />
            <Route path="agendamento/:id" element={<Manage />} />
            <Route path="meus-agendamentos" element={<Lookup />} />
            <Route path="privacidade" element={<Privacy />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ToastProvider>
  );
}
