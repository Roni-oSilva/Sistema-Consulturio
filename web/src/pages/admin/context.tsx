import { createContext, useContext, type ReactNode } from 'react';
import { api } from '../../lib/api';
import { useAsync } from '../../lib/hooks';
import type { AdminProfessional, AdminService, Me } from './types';

type AdminCtx = {
  me: Me;
  can: (perm: string) => boolean;
  logout: () => Promise<void>;
  timezone: string;
};
export const AdminContext = createContext<AdminCtx | null>(null);
export const useAdmin = () => useContext(AdminContext)!;

type CatalogCtx = {
  services: AdminService[];
  professionals: AdminProfessional[];
  reload: () => void;
  loading: boolean;
};
const CatalogContext = createContext<CatalogCtx>({ services: [], professionals: [], reload: () => {}, loading: true });
export const useCatalog = () => useContext(CatalogContext);

/** Serviços e profissionais ficam em cache no painel (usados em várias telas). */
export function CatalogProvider({ children }: { children: ReactNode }) {
  const q = useAsync(async (signal) => {
    const [s, p] = await Promise.all([
      api.get<{ services: AdminService[] }>('/api/admin/services', { signal }),
      api.get<{ professionals: AdminProfessional[] }>('/api/admin/professionals', { signal }),
    ]);
    return { services: s.services, professionals: p.professionals };
  }, []);
  return (
    <CatalogContext.Provider
      value={{ services: q.data?.services ?? [], professionals: q.data?.professionals ?? [], reload: q.reload, loading: q.loading }}
    >
      {children}
    </CatalogContext.Provider>
  );
}
