import React, { useState, useCallback, useRef } from 'react';
import { AuthContext } from './AuthContext';
import { CREDENTIALS } from './credentials';

const SESSION_KEY = 'cw_auth_v1';

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function getSession(): string | null {
  try {
    const v = sessionStorage.getItem(SESSION_KEY);
    return v ? atob(v) : null;
  } catch { return null; }
}

// ── Login screen ──────────────────────────────────────────────────────────────

function LoginScreen({ onSuccess }: { onSuccess: (u: string) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]     = useState('');
  const [shaking, setShaking] = useState(false);
  const [loading, setLoading] = useState(false);
  const passRef = useRef<HTMLInputElement>(null);

  const shake = () => {
    setShaking(true);
    setTimeout(() => setShaking(false), 420);
  };

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) { shake(); setError('Enter username and password.'); return; }
    setLoading(true);
    setError('');
    try {
      const hash = await sha256(password);
      const stored = CREDENTIALS[username.trim().toLowerCase()];
      if (stored && stored === hash) {
        sessionStorage.setItem(SESSION_KEY, btoa(username.trim().toLowerCase()));
        onSuccess(username.trim().toLowerCase());
      } else {
        shake();
        setError('Invalid username or password.');
        setPassword('');
        passRef.current?.focus();
      }
    } finally {
      setLoading(false);
    }
  }, [username, password, onSuccess]);

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'var(--bg)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'var(--font)',
    }}>
      {/* subtle grid */}
      <div style={{
        position: 'absolute', inset: 0, opacity: 0.04,
        backgroundImage: 'linear-gradient(var(--border) 1px, transparent 1px), linear-gradient(90deg, var(--border) 1px, transparent 1px)',
        backgroundSize: '32px 32px',
        pointerEvents: 'none',
      }} />

      <div style={{
        position: 'relative',
        width: 360,
        background: 'var(--surface)',
        border: '1px solid var(--border2)',
        borderRadius: 10,
        padding: '36px 32px 28px',
        boxShadow: '0 24px 60px rgba(0,0,0,0.5)',
        animation: shaking ? 'cw-shake 0.42s ease' : undefined,
      }}>
        {/* Logo strip */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{
            display: 'inline-block',
            fontSize: 28, lineHeight: 1,
            color: 'var(--accent)',
            marginBottom: 10,
          }}>◈</div>
          <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: 2, color: 'var(--text)', textTransform: 'uppercase' }}>
            Chassis Workbench
          </div>
          <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>
            Motorcycle Dynamics · Foale / Cossalter
          </div>
        </div>

        <form onSubmit={handleSubmit} autoComplete="off">
          {/* Username */}
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1, display: 'block', marginBottom: 5 }}>
              Username
            </label>
            <input
              type="text"
              value={username}
              onChange={e => { setUsername(e.target.value); setError(''); }}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              style={{
                width: '100%', boxSizing: 'border-box',
                background: 'var(--surface2)', border: '1px solid var(--border2)',
                borderRadius: 5, padding: '8px 10px',
                color: 'var(--text)', fontFamily: 'var(--font)', fontSize: 13,
                outline: 'none',
              }}
              onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
              onBlur={e  => (e.currentTarget.style.borderColor = 'var(--border2)')}
            />
          </div>

          {/* Password */}
          <div style={{ marginBottom: 22 }}>
            <label style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1, display: 'block', marginBottom: 5 }}>
              Password
            </label>
            <input
              ref={passRef}
              type="password"
              value={password}
              onChange={e => { setPassword(e.target.value); setError(''); }}
              autoComplete="current-password"
              style={{
                width: '100%', boxSizing: 'border-box',
                background: 'var(--surface2)', border: '1px solid var(--border2)',
                borderRadius: 5, padding: '8px 10px',
                color: 'var(--text)', fontFamily: 'var(--font)', fontSize: 13,
                outline: 'none',
              }}
              onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
              onBlur={e  => (e.currentTarget.style.borderColor = 'var(--border2)')}
            />
          </div>

          {/* Error */}
          <div style={{
            minHeight: 18, marginBottom: 12,
            fontSize: 11, color: 'var(--danger)',
            textAlign: 'center',
            opacity: error ? 1 : 0,
            transition: 'opacity 0.2s',
          }}>
            {error || ' '}
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%', padding: '9px 0',
              background: 'var(--accent)', border: 'none',
              borderRadius: 5, cursor: loading ? 'default' : 'pointer',
              color: '#fff', fontFamily: 'var(--font)', fontSize: 12,
              fontWeight: 700, letterSpacing: 1,
              opacity: loading ? 0.7 : 1,
              transition: 'opacity 0.15s',
            }}
          >
            {loading ? 'Verifying…' : 'SIGN IN'}
          </button>
        </form>
      </div>

      <style>{`
        @keyframes cw-shake {
          0%,100% { transform: translateX(0); }
          20%      { transform: translateX(-8px); }
          40%      { transform: translateX(8px); }
          60%      { transform: translateX(-5px); }
          80%      { transform: translateX(5px); }
        }
      `}</style>
    </div>
  );
}

// ── Wrapper ───────────────────────────────────────────────────────────────────

export default function AuthWrapper({ children }: { children: React.ReactNode }) {
  const [username, setUsername] = useState<string | null>(getSession);

  const logout = useCallback(() => {
    sessionStorage.removeItem(SESSION_KEY);
    setUsername(null);
  }, []);

  if (!username) {
    return <LoginScreen onSuccess={setUsername} />;
  }

  return (
    <AuthContext.Provider value={{ username, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
