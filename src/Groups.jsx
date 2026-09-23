import React, { useEffect, useState } from 'react';
import { Plus, Copy, Check, LogOut, Users } from 'lucide-react';
import { FONT_MONO, FONT_DISPLAY, FONT_BODY } from './theme';
import { getGroups } from './api';

const INPUT_STYLE = {
  fontFamily: FONT_DISPLAY,
  fontSize: '1rem',
  background: '#F5F1E8',
  color: '#1C2333',
  border: '1.5px solid transparent',
};

// Same submit-handler shape as Auth.jsx's LoginGate/NewPasswordGate: guard
// against a double-submit, clear the error on every keystroke, try/catch/
// finally so `saving` never gets stuck true if something throws unexpectedly.
function CreateGroupForm({ onCreate }) {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const created = await onCreate(name.trim());
      if (!created) {
        setError('Не могу да направим групу — покушај поново.');
        return;
      }
      setName('');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <label style={{ color: '#8892AE', fontSize: '0.8rem', fontFamily: FONT_MONO, letterSpacing: 0.5 }}>
        НАПРАВИ НОВУ ГРУПУ
      </label>
      <div className="flex items-center gap-2">
        <input
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          placeholder="нпр. Српски четвртком"
          autoComplete="off"
          className="flex-1 rounded-lg px-3.5 py-2.5 outline-none"
          style={INPUT_STYLE}
        />
        <button
          type="submit"
          disabled={!name.trim() || saving}
          className="rounded-lg px-4 py-2.5 text-sm font-semibold flex items-center gap-1.5 shrink-0"
          style={{
            fontFamily: FONT_BODY,
            background: name.trim() ? '#C41E3A' : '#2A3355',
            color: name.trim() ? '#F5F1E8' : '#5C6690',
          }}
        >
          <Plus size={16} /> Направи
        </button>
      </div>
      {error && <p style={{ color: '#E28B95', fontSize: '0.8rem' }}>{error}</p>}
    </form>
  );
}

function JoinGroupForm({ onJoin }) {
  const [code, setCode] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    if (!code.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const joined = await onJoin(code.trim());
      if (!joined) {
        setError('Није пронађена група са тим кодом.');
        return;
      }
      setCode('');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <label style={{ color: '#8892AE', fontSize: '0.8rem', fontFamily: FONT_MONO, letterSpacing: 0.5 }}>
        ПРИДРУЖИ СЕ ПОМОЋУ КОДА
      </label>
      <div className="flex items-center gap-2">
        <input
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            setError(null);
          }}
          placeholder="нпр. AB12CD34"
          autoComplete="off"
          className="flex-1 rounded-lg px-3.5 py-2.5 outline-none"
          style={{ ...INPUT_STYLE, fontFamily: FONT_MONO, letterSpacing: 1 }}
        />
        <button
          type="submit"
          disabled={!code.trim() || saving}
          className="rounded-lg px-4 py-2.5 text-sm font-semibold shrink-0"
          style={{
            fontFamily: FONT_BODY,
            background: code.trim() ? '#3D8B5F' : '#2A3355',
            color: code.trim() ? '#F5F1E8' : '#5C6690',
          }}
        >
          Придружи се
        </button>
      </div>
      {error && <p style={{ color: '#E28B95', fontSize: '0.8rem' }}>{error}</p>}
    </form>
  );
}

function InviteCode({ code }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      // Clipboard access can fail (no permission, insecure context) — the
      // code is still shown in plain text, so nothing is actually lost.
    }
  };
  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex items-center gap-1.5 rounded-md px-2 py-1"
      style={{ fontFamily: FONT_MONO, fontSize: '0.78rem', color: '#D4A54A', background: '#12192E', border: '1px solid #2A3355' }}
      title="Копирај код за позивницу"
    >
      {code}
      {copied ? <Check size={13} /> : <Copy size={13} />}
    </button>
  );
}

// GET /api/vocabulary's `groups` (the prop this component receives) is
// deliberately minimal — {id, name}, just enough for the scope-selector
// pills used elsewhere — so invite codes are fetched separately here via
// GET /api/groups, the one place that needs the fuller detail. Re-fetched
// whenever the number of groups changes (create/join/leave), not just once
// on mount, so a code appears promptly after creating/joining rather than
// only surviving until the next full page reload overwrites the minimal list.
export function Groups({ groups, onCreate, onJoin, onLeave }) {
  const [details, setDetails] = useState({}); // group id -> { invite_code, ... }
  const [membersByGroup, setMembersByGroup] = useState({}); // group id -> [{ email, mine }]

  useEffect(() => {
    let cancelled = false;
    getGroups().then(({ data }) => {
      if (cancelled || !data) return;
      setDetails(Object.fromEntries((data.groups || []).map((g) => [g.id, g])));
      const byGroup = {};
      (data.members || []).forEach((m) => {
        (byGroup[m.group_id] ||= []).push(m);
      });
      setMembersByGroup(byGroup);
    });
    return () => {
      cancelled = true;
    };
  }, [groups.length]);

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-2xl px-6 py-7 flex flex-col gap-5" style={{ background: '#1B2440', border: '1px solid #2A3355' }}>
        <CreateGroupForm onCreate={onCreate} />
        <div style={{ borderTop: '1px solid #2A3355' }} />
        <JoinGroupForm onJoin={onJoin} />
      </div>

      {groups.length === 0 ? (
        <div className="text-center rounded-2xl py-16 px-6" style={{ background: '#1B2440', border: '1px solid #2A3355' }}>
          <p style={{ fontFamily: FONT_DISPLAY, color: '#F5F1E8', fontSize: '1.15rem' }}>Још ниси ни у једној групи</p>
          <p style={{ color: '#8892AE', fontSize: '0.9rem', marginTop: 8 }}>
            Направи групу или се придружи постојећој помоћу кода.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {groups.map((g) => {
            const members = membersByGroup[g.id] || [];
            return (
              <div
                key={g.id}
                className="rounded-xl px-4 py-3 flex flex-col gap-1.5"
                style={{ background: '#1B2440', border: '1px solid #2A3355' }}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Users size={16} color="#8892AE" className="shrink-0" />
                    <span style={{ fontFamily: FONT_DISPLAY, color: '#F5F1E8', fontSize: '1rem' }}>{g.name}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {details[g.id]?.invite_code && <InviteCode code={details[g.id].invite_code} />}
                    <button
                      type="button"
                      onClick={() => onLeave(g.id)}
                      className="p-2 rounded-md"
                      style={{ color: '#8892AE' }}
                      aria-label={`Напусти групу ${g.name}`}
                      title="Напусти групу"
                    >
                      <LogOut size={15} />
                    </button>
                  </div>
                </div>
                {members.length > 0 && (
                  <p style={{ color: '#5C6690', fontSize: '0.78rem', paddingLeft: 25 }}>
                    Чланови:{' '}
                    {members
                      .map((m) => (m.mine ? 'ти' : m.email))
                      .filter(Boolean)
                      .join(', ')}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
