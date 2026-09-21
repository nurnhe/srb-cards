// The screens shown before someone is signed in: the login form (with "forgot
// password") and the choose-a-password screen for reset and invitation links.
// Moved out of App.jsx unchanged.

import React, { useState } from 'react';
import { getSupabase } from './supabaseClient';
import { FONT_DISPLAY, FONT_BODY } from './theme';

const AUTH_INPUT_STYLE = { background: '#12192E', color: '#F5F1E8', border: '1px solid #2A3355' };

function AuthCard({ onSubmit, children }) {
  return (
    <div
      className="min-h-screen w-full flex items-center justify-center px-5"
      style={{ background: '#12192E', fontFamily: FONT_BODY }}
    >
      <form
        onSubmit={onSubmit}
        className="w-full rounded-xl p-6"
        style={{ maxWidth: 340, background: '#1B2440', border: '1px solid #2A3355' }}
      >
        <h1
          className="text-center mb-5"
          style={{ fontFamily: FONT_DISPLAY, color: '#F5F1E8', fontSize: '1.3rem' }}
        >
          речи <span style={{ color: '#C41E3A', fontStyle: 'italic' }}>&amp;</span> слова
        </h1>
        {children}
      </form>
    </div>
  );
}

// Real Supabase Auth accounts, not a shared password — see CLAUDE.md's auth
// notes. Accounts are still created by Kira in the Supabase dashboard
// (invite-only), so there is a login form and "forgot password", but no
// sign-up. Success doesn't need to notify a parent — App()'s
// onAuthStateChange listener picks up the new session on its own and
// re-renders past this gate.
export function LoginGate() {
  const [mode, setMode] = useState('login'); // 'login' | 'forgot'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);
  const [checking, setChecking] = useState(false);

  const switchMode = (next) => {
    setMode(next);
    setError(null);
    setInfo(null);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!email || (mode === 'login' && !password) || checking) return;
    setChecking(true);
    setError(null);
    setInfo(null);
    try {
      const supabase = await getSupabase();
      if (mode === 'login') {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) setError(signInError.message);
      } else {
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin,
        });
        // Same message whether or not the address has an account, so this
        // form can't be used to find out who is registered.
        if (resetError) setError(resetError.message);
        else setInfo('Провери пошту — ако налог постоји, послали смо везу за нову лозинку.');
      }
    } catch (err) {
      setError('Нема везе са сервером — покушај поново');
    } finally {
      // Always runs, even if the call itself throws unexpectedly — the button
      // must never stay stuck on "Пријављивање…" with no way out.
      setChecking(false);
    }
  };

  const linkStyle = { color: '#8892AE', background: 'none', border: 'none', cursor: 'pointer' };

  return (
    <AuthCard onSubmit={submit}>
      <input
        type="email"
        autoFocus
        value={email}
        onChange={(e) => {
          setEmail(e.target.value);
          setError(null);
        }}
        placeholder="имејл"
        autoComplete="username"
        className="w-full rounded-lg px-3 py-2.5 mb-2.5 outline-none"
        style={AUTH_INPUT_STYLE}
      />
      {mode === 'login' && (
        <input
          type="password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setError(null);
          }}
          placeholder="лозинка"
          autoComplete="current-password"
          className="w-full rounded-lg px-3 py-2.5 mb-3 outline-none"
          style={AUTH_INPUT_STYLE}
        />
      )}
      {error && (
        <div className="text-sm text-center mb-3" style={{ color: '#E8A0A8' }}>
          {error}
        </div>
      )}
      {info && (
        <div className="text-sm text-center mb-3" style={{ color: '#D4A54A' }}>
          {info}
        </div>
      )}
      <button
        type="submit"
        disabled={checking}
        className="w-full rounded-lg py-2.5 font-medium"
        style={{ background: '#C41E3A', color: '#F5F1E8', opacity: checking ? 0.7 : 1 }}
      >
        {mode === 'login'
          ? checking ? 'Пријављивање…' : 'Улаз'
          : checking ? 'Шаљем…' : 'Пошаљи везу'}
      </button>
      <div className="text-center mt-4 text-sm">
        {mode === 'login' ? (
          <button type="button" onClick={() => switchMode('forgot')} style={linkStyle}>
            Заборављена лозинка?
          </button>
        ) : (
          <button type="button" onClick={() => switchMode('login')} style={linkStyle}>
            ← Назад
          </button>
        )}
      </div>
    </AuthCard>
  );
}

// Shown after someone follows the link from a password-reset or invitation
// email: Supabase signs them in with a temporary session and App() flags it,
// and this form sets the password on that session. An invited account has no
// password at all until this is submitted.
export function NewPasswordGate({ onDone, invite = false }) {
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (saving) return;
    if (password.length < 6) return setError('Лозинка мора имати бар 6 знакова');
    if (password !== again) return setError('Лозинке се не поклапају');
    setSaving(true);
    setError(null);
    try {
      const supabase = await getSupabase();
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) setError(updateError.message);
      else onDone();
    } catch (err) {
      setError('Нема везе са сервером — покушај поново');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AuthCard onSubmit={submit}>
      <div className="text-center mb-4 text-sm" style={{ color: '#8892AE' }}>
        {invite ? 'Добродошли! Изабери лозинку за свој налог' : 'Изабери нову лозинку'}
      </div>
      <input
        type="password"
        autoFocus
        value={password}
        onChange={(e) => {
          setPassword(e.target.value);
          setError(null);
        }}
        placeholder={invite ? 'лозинка' : 'нова лозинка'}
        autoComplete="new-password"
        className="w-full rounded-lg px-3 py-2.5 mb-2.5 outline-none"
        style={AUTH_INPUT_STYLE}
      />
      <input
        type="password"
        value={again}
        onChange={(e) => {
          setAgain(e.target.value);
          setError(null);
        }}
        placeholder="понови лозинку"
        autoComplete="new-password"
        className="w-full rounded-lg px-3 py-2.5 mb-3 outline-none"
        style={AUTH_INPUT_STYLE}
      />
      {error && (
        <div className="text-sm text-center mb-3" style={{ color: '#E8A0A8' }}>
          {error}
        </div>
      )}
      <button
        type="submit"
        disabled={saving}
        className="w-full rounded-lg py-2.5 font-medium"
        style={{ background: '#C41E3A', color: '#F5F1E8', opacity: saving ? 0.7 : 1 }}
      >
        {saving ? 'Чувам…' : 'Сачувај'}
      </button>
    </AuthCard>
  );
}
