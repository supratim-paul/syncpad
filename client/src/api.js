const NO_REFRESH = ['/auth/login', '/auth/signup', '/auth/refresh', '/auth/logout'];
let refreshing = null;

const raw = (path, opts = {}) =>
  fetch('/api' + path, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

// true = refreshed, false = session really ended (401), null = transient problem (network/server).
// A cross-tab lock stops several tabs from rotating the refresh token at the same time.
export function refreshSession() {
  const run = async () => {
    try {
      const r = await raw('/auth/refresh', { method: 'POST' });
      return r.ok ? true : r.status === 401 ? false : null;
    } catch { return null; }
  };
  return navigator.locks ? navigator.locks.request('syncpad-refresh', run) : run();
}

export const signedOut = () => window.dispatchEvent(new Event('syncpad:signedout'));

export async function api(path, opts = {}) {
  let res = await raw(path, opts);
  if (res.status === 401 && !NO_REFRESH.includes(path)) {
    refreshing ??= refreshSession().finally(() => { refreshing = null; });
    const ok = await refreshing;
    if (ok) res = await raw(path, opts);
    else if (ok === false) signedOut();
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error(data?.error || 'Something went wrong. Try again.'), { status: res.status });
  return data;
}
