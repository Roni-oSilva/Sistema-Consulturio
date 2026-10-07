import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { ApiError } from './api';

/** Carrega dados assíncronos com estados de carregando/erro e recarga. */
export function useAsync<T>(fn: (signal: AbortSignal) => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    fnRef
      .current(ctrl.signal)
      .then((d) => {
        if (!ctrl.signal.aborted) setData(d);
      })
      .catch((e) => {
        if (ctrl.signal.aborted || (e as Error).name === 'AbortError') return;
        setError(e instanceof ApiError ? e : new ApiError(0, 'ERROR', (e as Error).message));
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload, setData };
}

export type Clinic = {
  name: string;
  shortName: string;
  tagline: string;
  description: string;
  logoUrl: string | null;
  phone: string;
  whatsapp: string;
  email: string;
  address: string;
  mapsUrl: string;
  instagram: string;
  openingHours: string;
  bookingNotice: string;
  cancellationPolicy: string;
  privacyPolicy: string;
  privacyPolicyVersion: string;
  requireCpf: boolean;
  requireBirthDate: boolean;
  requireEmail: boolean;
  maxAdvanceDays: number;
  timezone: string;
  turnstileSiteKey: string | null;
};

export const ClinicContext = createContext<Clinic | null>(null);
export const useClinic = () => useContext(ClinicContext);

/** Atualiza o título da aba. */
export function useTitle(title: string) {
  useEffect(() => {
    document.title = title ? `${title} — JR Saúde` : 'JR Saúde — Agendamento online';
  }, [title]);
}
