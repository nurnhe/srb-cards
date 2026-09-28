import React, { useState, useEffect } from 'react';
import { BookMarked, LogOut, Users } from 'lucide-react';
import { getSupabase } from './supabaseClient';
import { FONT_DISPLAY, FONT_BODY, useGoogleFonts } from './theme';
import { LoginGate, NewPasswordGate } from './Auth';
import { Practice } from './Practice';
import { WordsList } from './WordsList';
import { AddWord } from './AddWord';
import { Groups } from './Groups';
import { useVocabulary } from './useVocabulary';

export default function App() {
  useGoogleFonts();

  const [tab, setTab] = useState('practice');
  // Derived from Supabase's own session state rather than a synchronous
  // localStorage check — a session can't be confirmed valid without asking
  // Supabase, so this starts null ("still checking") until getSession()
  // resolves, then tracks onAuthStateChange from then on. authed itself
  // stays a plain boolean (not the session object) so effects keyed on it
  // don't refire on every silent token refresh (~every 55 min).
  const [authed, setAuthed] = useState(null);
  // Set while someone who followed an emailed link — a password reset, or an
  // invitation to a brand-new account — picks their password. Supabase signs
  // them in with a temporary session first. Read from the address as well as
  // from the auth event, because Supabase may announce the event before the
  // listener below exists (an invitation has no dedicated event at all).
  const [passwordFlow, setPasswordFlow] = useState(() => {
    const m = window.location.hash.match(/type=(recovery|invite)/);
    return m ? m[1] : null;
  });

  useEffect(() => {
    let cancelled = false;
    let subscription;
    getSupabase()
      .then(async (supabase) => {
        const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
          if (event === 'PASSWORD_RECOVERY') setPasswordFlow('recovery');
          setAuthed(!!session);
        });
        subscription = listener.subscription;
        if (cancelled) return subscription.unsubscribe();
        const { data } = await supabase.auth.getSession();
        if (!cancelled) setAuthed(!!data.session);
      })
      // Couldn't reach the server for the sign-in settings: show the login
      // form, which retries the same lookup when submitted.
      .catch(() => {
        if (!cancelled) setAuthed(false);
      });
    return () => {
      cancelled = true;
      subscription?.unsubscribe();
    };
  }, []);

  const {
    words,
    tags,
    groups,
    ready,
    storageError,
    updateWord,
    recordAnswer,
    deleteWord,
    linkWords,
    unlinkWords,
    tagWord,
    untagWord,
    detectPartsOfSpeech,
    addWordWithRelated,
    importWords,
    shareWordToGroup,
    unshareWordFromGroup,
    createGroup,
    joinGroup,
    leaveGroup,
  } = useVocabulary(authed);

  // authed === null means the initial getSession() check hasn't resolved yet
  // — render nothing rather than flashing the login form for one frame.
  if (authed === null) return null;
  if (!authed) return <LoginGate />;
  if (passwordFlow) {
    return (
      <NewPasswordGate
        invite={passwordFlow === 'invite'}
        onDone={() => {
          // Drop the link's leftovers from the address so a reload doesn't
          // show this screen again.
          window.history.replaceState(null, '', window.location.pathname + window.location.search);
          setPasswordFlow(null);
        }}
      />
    );
  }

  return (
    <div
      className="min-h-screen w-full"
      style={{ background: '#12192E', fontFamily: FONT_BODY }}
    >
      <div className="max-w-2xl mx-auto px-5 py-8">
        <Header
          onLogout={async () => (await getSupabase()).auth.signOut()}
          onOpenGroups={() => setTab('groups')}
          groupsActive={tab === 'groups'}
        />
        <TabBar tab={tab} setTab={setTab} count={words.length} />

        {!ready ? (
          <div className="text-center py-20" style={{ color: '#8892AE' }}>
            Учитавање…
          </div>
        ) : (
          <>
            {tab === 'practice' && <Practice words={words} tags={tags} groups={groups} onAnswer={recordAnswer} />}
            {tab === 'words' && (
              <WordsList
                words={words}
                tags={tags}
                groups={groups}
                onDelete={deleteWord}
                onUpdate={updateWord}
                onLink={linkWords}
                onUnlink={unlinkWords}
                onTag={tagWord}
                onUntag={untagWord}
                onImport={importWords}
                onDetectPartsOfSpeech={detectPartsOfSpeech}
                onShareToGroup={shareWordToGroup}
                onUnshareFromGroup={unshareWordFromGroup}
              />
            )}
            {tab === 'add' && (
              <AddWord
                onAdd={addWordWithRelated}
                goToList={() => setTab('words')}
                words={words}
                tags={tags}
                groups={groups}
              />
            )}
            {tab === 'groups' && (
              <Groups groups={groups} onCreate={createGroup} onJoin={joinGroup} onLeave={leaveGroup} />
            )}
          </>
        )}

        {storageError && (
          <div
            className="mt-6 text-sm text-center rounded-lg py-2 px-3"
            style={{ background: '#3A1F26', color: '#E8A0A8' }}
          >
            {storageError}
          </div>
        )}
      </div>
    </div>
  );
}

function Header({ onLogout, onOpenGroups, groupsActive }) {
  return (
    <div className="flex items-center gap-3 mb-7">
      <div
        className="flex items-center justify-center rounded-lg shrink-0"
        style={{
          width: 42,
          height: 42,
          background: 'linear-gradient(155deg, #C41E3A 0%, #8E1529 100%)',
        }}
      >
        <BookMarked size={20} color="#F5F1E8" strokeWidth={2} />
      </div>
      <div className="flex-1">
        <h1
          style={{ fontFamily: FONT_DISPLAY, color: '#F5F1E8', fontSize: '1.5rem', lineHeight: 1.1 }}
        >
          речи <span style={{ color: '#C41E3A', fontStyle: 'italic' }}>&amp;</span> слова
        </h1>
        <p style={{ color: '#8892AE', fontSize: '0.8rem', marginTop: 2 }}>
          српски&nbsp;⇄&nbsp;руски речник
        </p>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {onOpenGroups && (
          <button
            type="button"
            onClick={onOpenGroups}
            className="p-2 rounded-lg"
            style={{
              color: groupsActive ? '#12192E' : '#8892AE',
              background: groupsActive ? '#D4A54A' : 'transparent',
            }}
            title="Групе"
            aria-label="Групе"
          >
            <Users size={18} />
          </button>
        )}
        {onLogout && (
          <button
            type="button"
            onClick={onLogout}
            className="p-2 rounded-lg"
            style={{ color: '#8892AE' }}
            title="Одјава"
          >
            <LogOut size={18} />
          </button>
        )}
      </div>
    </div>
  );
}

function TabBar({ tab, setTab, count }) {
  const tabs = [
    { id: 'practice', label: 'Вежбање' },
    { id: 'words', label: `Речи${count ? ` · ${count}` : ''}` },
    { id: 'add', label: 'Додај' },
  ];
  return (
    <div
      className="flex gap-1 mb-7 p-1 rounded-xl"
      style={{ background: '#1B2440', border: '1px solid #2A3355' }}
    >
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => setTab(t.id)}
          className="flex-1 py-2 rounded-lg text-sm font-medium transition-colors"
          style={{
            fontFamily: FONT_BODY,
            background: tab === t.id ? '#F5F1E8' : 'transparent',
            color: tab === t.id ? '#12192E' : '#8892AE',
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
