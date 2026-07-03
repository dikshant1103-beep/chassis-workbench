/**
 * gazeboClient.ts — drive the headless Gazebo high-fidelity load-case job (Layer B).
 *
 * POST run → poll status → GET result. The job spawns Gazebo Classic + ROS 2 on the
 * backend host; the app only consumes the parsed FT-sensor loads. Same base-URL
 * detection as backendClient.ts.
 */

const isElectron: boolean =
  typeof window !== 'undefined' &&
  !!(window as unknown as { electronAPI?: { isElectron?: boolean } }).electronAPI?.isElectron;

const BASE = isElectron ? 'http://localhost:8770/api' : '/api';

export interface GazeboRunParams {
  mode?: 'rig' | 'ride';
  world?: 'flat' | 'bump' | 'kerb' | 'jump';
  params: Record<string, number | boolean | string>;
  timeout?: number;
}

export interface GazeboResult {
  ok: boolean;
  provenance?: 'gazebo';
  mode?: string;
  cases?: Record<string, Record<string, { resultantF_N: number; moment_Nm: number; Fz_N: number }>>;
  measured_daf?: Record<string, Record<string, number>>;
  error?: string;
}

async function jfetch(path: string, init?: RequestInit) {
  const res = await fetch(BASE + path, init);
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json();
}

export async function gazeboRun(p: GazeboRunParams): Promise<{ job_id: string }> {
  return jfetch('/structural/gazebo/run', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'rig', world: 'flat', timeout: 90, ...p }),
  });
}

export async function gazeboStatus(id: string): Promise<{ state: string; elapsed: number }> {
  return jfetch(`/structural/gazebo/status/${id}`);
}

export async function gazeboResult(id: string): Promise<GazeboResult> {
  return jfetch(`/structural/gazebo/result/${id}`);
}

/** Run a job and poll to completion (or timeout). onState reports progress. */
export async function gazeboRunToCompletion(
  p: GazeboRunParams, onState: (s: string, elapsed: number) => void, maxMs = 180000,
): Promise<GazeboResult> {
  const { job_id } = await gazeboRun(p);
  const t0 = Date.now();
  for (;;) {
    await new Promise(r => setTimeout(r, 2000));
    const st = await gazeboStatus(job_id);
    onState(st.state, st.elapsed);
    if (st.state === 'done') return gazeboResult(job_id);
    if (st.state === 'error') return { ok: false, error: 'gazebo run failed (see backend logs)' };
    if (Date.now() - t0 > maxMs) return { ok: false, error: 'timeout polling gazebo job' };
  }
}
