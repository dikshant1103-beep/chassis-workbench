/**
 * useBackendSync — mounts once in App.tsx, drives backend ↔ store synchronisation.
 *
 * Behaviour:
 *  • On mount: pings /api/health. If reachable, fetches immediately.
 *  • On every input change: fires immediately (no debounce — user wants real values).
 *    A 150 ms coalesce window prevents flooding while dragging a slider quickly.
 *  • On success: status='synced', all 13 physics sections merged into live results.
 *  • On network error or timeout: status='error', TypeScript fallback values remain.
 *  • Backend going offline mid-session: status='offline', stale backend results retained.
 */

import { useEffect, useRef } from 'react';
import { useStore } from '../store/useStore';
import { checkHealth, runDagAnalysis, runDynamics } from '../api/backendClient';

export function useBackendSync() {
  const input          = useStore(s => s.input);
  const setStatus      = useStore(s => s.setBackendStatus);
  const setResults     = useStore(s => s.setBackendResults);
  const timerRef       = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef     = useRef(true);

  // Fetch both endpoints in parallel; update store atomically
  async function sync() {
    if (!mountedRef.current) return;
    setStatus('syncing');
    try {
      const [dag, dynamics] = await Promise.all([
        runDagAnalysis(input),
        runDynamics(input),
      ]);
      if (!mountedRef.current) return;
      setResults(dag, dynamics);
      setStatus('synced');
    } catch {
      if (!mountedRef.current) return;
      setStatus('error');
    }
  }

  // On mount: check if backend is reachable before first fetch.
  // In Electron the backend may not be up yet — the IPC 'backend:ready' event
  // (sent by main.cjs after polling /api/health) is used as an additional trigger.
  useEffect(() => {
    mountedRef.current = true;

    // Immediate health check (works in browser; in Electron may return false initially)
    checkHealth().then(alive => {
      if (!mountedRef.current) return;
      if (alive) sync(); else setStatus('offline');
    });

    // Electron: main.cjs sends 'backend:ready' once uvicorn is confirmed up.
    // This fires even if the immediate health check above returned false.
    const elAPI = (window as unknown as { electronAPI?: { onBackendReady?: (cb: () => void) => void } }).electronAPI;
    if (elAPI?.onBackendReady) {
      elAPI.onBackendReady(() => {
        if (!mountedRef.current) return;
        sync();
      });
    }

    return () => { mountedRef.current = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // On input change: debounced re-sync
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      checkHealth().then(alive => {
        if (!mountedRef.current) return;
        if (alive) {
          sync();
        } else {
          setStatus('offline');
        }
      });
    }, 150);  // 150ms coalesce — prevents flooding while slider is dragged
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [input]); // eslint-disable-line react-hooks/exhaustive-deps
}
