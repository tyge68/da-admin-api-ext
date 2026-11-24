export type AdminFetchReq = { method?: string; path: string; body?: string };
export type AdminFetchRes =
  | { ok: true; status: number; statusText: string; json: unknown }
  | { ok: false; error: 'no-tab' | 'no-token' | 'expired' | 'network'; message?: string };

export type ProbeLogReq = { type: 'PROBE_LOG'; org: string; site: string; key: string };
export type Msg = ({ type: 'ADMIN_FETCH' } & AdminFetchReq) | ProbeLogReq;
