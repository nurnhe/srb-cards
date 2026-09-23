// Moved out of App.jsx unchanged (part of the file split).

import React, { useRef, useState } from 'react';
import { Download, Loader2, Upload, Tag, Percent, Table2, Link2, Pencil, Trash2, Users } from 'lucide-react';
import { FONT_MONO, FONT_DISPLAY, FONT_BODY } from './theme';
import { fetchInflectionTables } from './wiktionary';
import {
  computeTagAccuracy,
  buildExportData,
  parseImportData,
  filterWordsByQuery,
  parseVariants,
  normalize,
  findLikelyTypoOf,
  otherScript,
  partOfSpeechTagIds,
  posAbbreviation,
  rankTagsByUsage,
  scopeWords,
} from './logic';
import { SortPill, TagFilterPill, PosBadge, ShowMoreTagsButton } from './components/Pills';
import { DictScopeBar } from './components/DictScopeBar';
import { VariantsEditor } from './components/VariantsEditor';
import { PronounceButton } from './components/PronounceButton';
import { IpaText } from './components/IpaText';
import { WordStats } from './components/WordStats';
import { InflectionTables } from './components/InflectionTables';

/* ---------------- WORDS LIST ---------------- */

const srCollator = new Intl.Collator('sr', { sensitivity: 'base' });

// Accuracy broken down by tag, using each word's own correct_count/
// wrong_count aggregated across every tag it carries — see
// computeTagAccuracy. Surfaces categories that need more practice, not
// just individual hard words.
function TagAccuracyPanel({ words, tags }) {
  const rows = computeTagAccuracy(words, tags);
  return (
    <div className="rounded-lg p-3 mb-1" style={{ background: '#12192E', border: '1px solid #3A4570' }}>
      {rows.length === 0 ? (
        <p style={{ color: '#8892AE', fontSize: '0.78rem' }}>
          Још нема довољно вежбања по таговима.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {rows.map((r) => (
            <div key={r.tagId} className="flex items-center justify-between gap-3">
              <span style={{ fontFamily: FONT_MONO, fontSize: '0.78rem', color: '#D4A54A' }}>{r.name}</span>
              <span style={{ fontFamily: FONT_MONO, fontSize: '0.78rem', color: '#8892AE' }}>
                {Math.round(r.accuracy * 100)}% ({r.correct}/{r.total})
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function WordsList({
  words,
  tags,
  groups,
  onDelete,
  onUpdate,
  onLink,
  onUnlink,
  onTag,
  onUntag,
  onImport,
  onDetectPartsOfSpeech,
  onShareToGroup,
  onUnshareFromGroup,
}) {
  const [scope, setScope] = useState('all'); // 'all' | 'mine' | a group id
  const [editingId, setEditingId] = useState(null);
  const [editSr, setEditSr] = useState('');
  const [editRuVariants, setEditRuVariants] = useState([]);
  const [editExample, setEditExample] = useState('');
  const [linkingId, setLinkingId] = useState(null); // word currently picking a related word
  const [linkQuery, setLinkQuery] = useState('');
  const [taggingId, setTaggingId] = useState(null); // word currently picking/creating a tag
  const [tagQuery, setTagQuery] = useState('');
  const [sharingId, setSharingId] = useState(null); // word currently picking a group to share with
  const [inflectionId, setInflectionId] = useState(null); // word currently showing its declension/conjugation table
  const [inflectionTables, setInflectionTables] = useState(null);
  const [inflectionState, setInflectionState] = useState('idle'); // idle | loading | notfound | error
  const [deletingId, setDeletingId] = useState(null); // word currently showing its delete confirmation
  const [activeTagFilter, setActiveTagFilter] = useState(new Set()); // Set of tag ids; empty = all
  // The tag filter bar and each word's own tag list are capped by default —
  // almost every word carries a part-of-speech tag now, which used to mean
  // every tag, everywhere, all the time. These track which ones the user has
  // asked to see in full.
  const [tagFilterExpanded, setTagFilterExpanded] = useState(false);
  const [expandedCardTags, setExpandedCardTags] = useState(new Set()); // word ids
  const [sortMode, setSortMode] = useState('alpha'); // alpha | hardest
  const [searchQuery, setSearchQuery] = useState('');
  const [importState, setImportState] = useState('idle'); // idle | loading | error | done
  const [importMessage, setImportMessage] = useState('');
  const [showTagAccuracy, setShowTagAccuracy] = useState(false);
  const [posState, setPosState] = useState('idle'); // idle | running | done | error
  const [posProgress, setPosProgress] = useState({ done: 0, total: 0 });
  const [posMessage, setPosMessage] = useState('');
  const importFileRef = useRef(null);

  const runPartOfSpeechDetection = async () => {
    if (posState === 'running') return;
    setPosState('running');
    setPosMessage('');
    setPosProgress({ done: 0, total: 0 });
    const result = await onDetectPartsOfSpeech((done, total) => setPosProgress({ done, total }));
    if (result.total === 0) {
      setPosState('done');
      setPosMessage('Све речи већ имају врсту.');
      return;
    }
    const parts = [`Означено: ${result.tagged} од ${result.total}.`];
    if (result.notFound.length > 0) {
      const shown = result.notFound.slice(0, 8).join(', ');
      parts.push(`Нема на Wiktionary-ју: ${result.notFound.length} (${shown}${result.notFound.length > 8 ? '…' : ''}).`);
    }
    if (result.stoppedEarly) parts.push('Прекинуто — Wiktionary није одговорио. Покушај поново касније, наставиће одакле је стало.');
    setPosState(result.stoppedEarly ? 'error' : 'done');
    setPosMessage(parts.join(' '));
  };

  const exportBackup = () => {
    const data = buildExportData(words, tags);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `srb-cards-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importBackup = async (file) => {
    setImportState('loading');
    setImportMessage('');
    try {
      const text = await file.text();
      const parsed = parseImportData(text);
      if (!parsed.valid) {
        setImportState('error');
        setImportMessage(parsed.error);
        return;
      }
      const stats = await onImport(parsed.words);
      setImportState(stats.failed > 0 || stats.failedWords > 0 ? 'error' : 'done');
      setImportMessage(
        `Додато: ${stats.added}. Прескочено (већ постоји): ${stats.skipped}. Тагова додато: ${stats.tagged}. Веза додато: ${stats.linked}.` +
          (stats.failedWords > 0
            ? ` Речи које нису сачуване: ${stats.failedWords} (њихови тагови и везе су прескочени). Покушај поново — речи које већ постоје се прескачу.`
            : '') +
          (stats.failed > 0 ? ` Није сачувано (грешка): ${stats.failed}.` : '')
      );
    } catch (e) {
      // A read/parse failure left this stuck at 'loading' forever before —
      // the import button stays disabled while loading, with no way out.
      setImportState('error');
      setImportMessage('Не могу да прочитам фајл.');
    }
  };

  if (words.length === 0) {
    return (
      <div
        className="text-center rounded-2xl py-16 px-6"
        style={{ background: '#1B2440', border: '1px solid #2A3355' }}
      >
        <p style={{ fontFamily: FONT_DISPLAY, color: '#F5F1E8', fontSize: '1.15rem' }}>
          Још нема речи
        </p>
        <p style={{ color: '#8892AE', fontSize: '0.9rem', marginTop: 8 }}>
          Овде ће се појавити све речи које додате.
        </p>
      </div>
    );
  }

  const errorRate = (w) => {
    const total = (w.correct_count || 0) + (w.wrong_count || 0);
    if (total === 0) return -1; // untested words sort after tested-but-perfect ones
    return (w.wrong_count || 0) / total;
  };

  // Narrows to the selected dictionary (everything / just mine / a specific
  // group) before anything else — sorting, tag filtering, search — applies.
  const scoped = scopeWords(words, scope);

  const sorted = [...scoped].sort((a, b) => {
    if (sortMode === 'hardest') {
      const diff = errorRate(b) - errorRate(a);
      if (diff !== 0) return diff;
      return (b.wrong_count || 0) - (a.wrong_count || 0);
    }
    return srCollator.compare(a.sr, b.sr);
  });
  // A word must have ALL selected tags (intersection), not just any one
  // of them — selecting more tags narrows the list.
  const filtered =
    activeTagFilter.size > 0
      ? sorted.filter((w) => Array.from(activeTagFilter).every((id) => w.tagIds.includes(id)))
      : sorted;
  const searched = filterWordsByQuery(filtered, searchQuery);
  const byId = Object.fromEntries(words.map((w) => [w.id, w]));
  const tagById = Object.fromEntries((tags || []).map((t) => [t.id, t]));
  const groupById = Object.fromEntries((groups || []).map((g) => [g.id, g]));

  // Part-of-speech tags (glagol, imenica...) are shown as small badges rather
  // than full tag pills — they land on almost every word now, so treating
  // them like any other tag was most of what made this screen crowded. Only
  // the custom tags are ranked/capped, since there are usually just a
  // handful of part-of-speech ones and hiding any of those would remove a
  // real filter, not just declutter the view.
  const posTagIds = partOfSpeechTagIds(tags);
  const posTags = (tags || []).filter((t) => posTagIds.has(t.id));
  const customTags = (tags || []).filter((t) => !posTagIds.has(t.id));
  const rankedCustomTags = rankTagsByUsage(customTags.map((t) => t.id), words).map((id) => tagById[id]);
  const CUSTOM_TAG_FILTER_CAP = 6;
  const CARD_TAG_CAP = 2;

  const toggleTagFilter = (id) => {
    setActiveTagFilter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const startEdit = (w) => {
    setEditingId(w.id);
    setEditSr(w.sr);
    setEditRuVariants(parseVariants(w.ru));
    setEditExample(w.example || '');
    setLinkingId(null);
    setTaggingId(null);
    setInflectionId(null);
    setDeletingId(null);
    setSharingId(null);
  };

  const saveEdit = async () => {
    if (!editSr.trim() || editRuVariants.length === 0) {
      setEditingId(null);
      return;
    }
    // Keep the panel open on failure — closing it unconditionally made a
    // failed save look identical to a successful one, silently discarding
    // the edit with only the generic storage-error banner as a clue.
    const saved = await onUpdate(editingId, editSr, editRuVariants.join(', '), editExample);
    if (saved) setEditingId(null);
  };

  const startLinking = (id) => {
    // Clicking the icon for the word whose link panel is already open closes
    // it, same as the inflection-table toggle — otherwise it looked like a
    // close action but actually reopened the panel and silently wiped
    // whatever search query was already typed.
    if (linkingId === id) {
      setLinkingId(null);
      return;
    }
    setLinkingId(id);
    setLinkQuery('');
    setEditingId(null);
    setTaggingId(null);
    setInflectionId(null);
    setDeletingId(null);
    setSharingId(null);
  };

  const startTagging = (id) => {
    if (taggingId === id) {
      setTaggingId(null);
      return;
    }
    setTaggingId(id);
    setTagQuery('');
    setEditingId(null);
    setLinkingId(null);
    setInflectionId(null);
    setDeletingId(null);
    setSharingId(null);
  };

  const startSharing = (id) => {
    if (sharingId === id) {
      setSharingId(null);
      return;
    }
    setSharingId(id);
    setEditingId(null);
    setLinkingId(null);
    setTaggingId(null);
    setInflectionId(null);
    setDeletingId(null);
  };

  // Toggles the declension/conjugation table for a word — reuses
  // fetchInflectionTables (same Wiktionary lookup as Add Word). Only one
  // word's table shows at a time, same pattern as edit/link/tag.
  const toggleInflection = async (id, sr) => {
    if (inflectionId === id) {
      setInflectionId(null);
      return;
    }
    setInflectionId(id);
    setEditingId(null);
    setLinkingId(null);
    setTaggingId(null);
    setDeletingId(null);
    setSharingId(null);
    setInflectionTables(null);
    setInflectionState('loading');
    try {
      const found = await fetchInflectionTables(sr);
      if (found) {
        setInflectionTables(found);
        setInflectionState('idle');
      } else {
        setInflectionTables(null);
        setInflectionState('notfound');
      }
    } catch (e) {
      setInflectionTables(null);
      setInflectionState('error');
    }
  };

  // Deleting is destructive and irreversible, unlike the other row actions —
  // clicking the trash icon opens an inline "are you sure?" instead of
  // deleting immediately, same toggle-to-close behavior as the other panels
  // if clicked again on the same word.
  const startDelete = (id) => {
    if (deletingId === id) {
      setDeletingId(null);
      return;
    }
    setDeletingId(id);
    setEditingId(null);
    setLinkingId(null);
    setTaggingId(null);
    setInflectionId(null);
    setSharingId(null);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between mb-1" style={{ paddingLeft: 4, paddingRight: 2 }}>
        <div
          style={{
            color: '#5C6690',
            fontSize: '0.72rem',
            fontFamily: FONT_MONO,
            letterSpacing: 1,
          }}
        >
          {scoped.length} {scoped.length === 1 ? 'РЕЧ' : 'РЕЧИ'}
        </div>
        <div className="flex gap-1">
          <SortPill active={sortMode === 'alpha'} label="А–Ш" onClick={() => setSortMode('alpha')} />
          <SortPill
            active={sortMode === 'hardest'}
            label="НАЈТЕЖЕ"
            onClick={() => setSortMode('hardest')}
          />
        </div>
      </div>

      <div className="flex items-center gap-3 mb-1" style={{ paddingLeft: 4 }}>
        <button
          type="button"
          onClick={exportBackup}
          className="flex items-center gap-1.5"
          style={{ fontFamily: FONT_MONO, fontSize: '0.72rem', color: '#8892AE' }}
        >
          <Download size={13} /> Извези резервну копију
        </button>
        <button
          type="button"
          onClick={() => importFileRef.current?.click()}
          disabled={importState === 'loading'}
          className="flex items-center gap-1.5"
          style={{ fontFamily: FONT_MONO, fontSize: '0.72rem', color: '#8892AE' }}
        >
          {importState === 'loading' ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} Увези
        </button>
        {onDetectPartsOfSpeech && (
          <button
            type="button"
            onClick={runPartOfSpeechDetection}
            disabled={posState === 'running'}
            className="flex items-center gap-1.5"
            style={{ fontFamily: FONT_MONO, fontSize: '0.72rem', color: '#8892AE' }}
            title="Потражи врсту речи (глагол, именица…) на Wiktionary-ју и додај таг свим речима које га немају"
          >
            {posState === 'running' ? <Loader2 size={13} className="animate-spin" /> : <Tag size={13} />}
            {posState === 'running' ? `${posProgress.done} / ${posProgress.total}` : 'Одреди врсте речи'}
          </button>
        )}
        <input
          ref={importFileRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) importBackup(file);
          }}
        />
        {tags && tags.length > 0 && (
          <button
            type="button"
            onClick={() => setShowTagAccuracy((v) => !v)}
            className="flex items-center gap-1.5"
            style={{ fontFamily: FONT_MONO, fontSize: '0.72rem', color: showTagAccuracy ? '#D4A54A' : '#8892AE' }}
          >
            <Percent size={13} /> Тачност по тагу
          </button>
        )}
      </div>
      {importMessage && (
        <p
          style={{
            color: importState === 'error' ? '#E28B95' : '#8892AE',
            fontSize: '0.78rem',
            paddingLeft: 4,
            marginBottom: 4,
          }}
        >
          {importMessage}
        </p>
      )}
      {posMessage && (
        <p
          style={{
            color: posState === 'error' ? '#E28B95' : '#8892AE',
            fontSize: '0.78rem',
            paddingLeft: 4,
            marginBottom: 4,
          }}
        >
          {posMessage}
        </p>
      )}
      {showTagAccuracy && <TagAccuracyPanel words={words} tags={tags} />}

      <input
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        placeholder="претражи по српском или руском…"
        className="w-full rounded-lg px-3.5 py-2.5 mb-1 outline-none"
        style={{
          fontFamily: FONT_DISPLAY,
          fontSize: '0.95rem',
          background: '#F5F1E8',
          color: '#1C2333',
          border: '1.5px solid transparent',
        }}
      />

      {groups && groups.length > 0 && (
        <div className="mb-1.5" style={{ paddingLeft: 4 }}>
          <DictScopeBar groups={groups} scope={scope} onChange={setScope} />
        </div>
      )}

      {tags && tags.length > 0 && (
        <div className="mb-1" style={{ paddingLeft: 4 }}>
          <div className="flex flex-wrap items-center gap-1.5">
            <TagFilterPill
              active={activeTagFilter.size === 0}
              label="Све"
              onClick={() => setActiveTagFilter(new Set())}
            />
            {posTags.map((t) => (
              <PosBadge
                key={t.id}
                label={posAbbreviation(t.name)}
                active={activeTagFilter.has(t.id)}
                onClick={() => toggleTagFilter(t.id)}
              />
            ))}
          </div>
          {customTags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
              {(tagFilterExpanded ? rankedCustomTags : rankedCustomTags.slice(0, CUSTOM_TAG_FILTER_CAP)).map((t) => (
                <TagFilterPill key={t.id} active={activeTagFilter.has(t.id)} label={t.name} onClick={() => toggleTagFilter(t.id)} />
              ))}
              {!tagFilterExpanded && rankedCustomTags.length > CUSTOM_TAG_FILTER_CAP && (
                <ShowMoreTagsButton
                  count={rankedCustomTags.length - CUSTOM_TAG_FILTER_CAP}
                  onClick={() => setTagFilterExpanded(true)}
                />
              )}
            </div>
          )}
        </div>
      )}

      {searched.length === 0 && (
        <div style={{ color: '#5C6690', fontSize: '0.85rem', padding: '20px 4px' }}>
          {searchQuery.trim() ? `Нема речи за „${searchQuery.trim()}“.` : 'Нема речи са овим тагом.'}
        </div>
      )}

      {searched.map((w) => {
        const related = w.relatedIds.map((rid) => byId[rid]).filter(Boolean);
        const wordTags = w.tagIds.map((tid) => tagById[tid]).filter(Boolean);
        const wordPosTags = wordTags.filter((t) => posTagIds.has(t.id));
        const wordCustomTags = wordTags.filter((t) => !posTagIds.has(t.id));
        const wordGroups = (w.groupIds || []).map((gid) => groupById[gid]).filter(Boolean);
        const cardTagsExpanded = expandedCardTags.has(w.id);
        return (
          <div
            key={w.id}
            className="rounded-xl px-4 py-3 flex flex-col gap-2.5"
            style={{ background: '#1B2440', border: '1px solid #2A3355' }}
          >
            {editingId === w.id ? (
              <div className="flex flex-col gap-2">
                <input
                  value={editSr}
                  onChange={(e) => setEditSr(e.target.value)}
                  className="rounded-md px-3 py-1.5 text-sm outline-none"
                  style={{ background: '#12192E', color: '#F5F1E8', border: '1px solid #3A4570' }}
                  placeholder="српски"
                />
                {(() => {
                  // Compare against the full word list, including this
                  // word's own original spelling — editing "bakar" into
                  // "bokar" should catch the typo against bakar itself,
                  // not just against other, unrelated words. Only skip
                  // when nothing has actually changed yet.
                  if (normalize(editSr) === normalize(w.sr)) return null;
                  const typoOf = findLikelyTypoOf(editSr, words);
                  return (
                    typoOf && (
                      <p style={{ color: '#C9A24B', fontSize: '0.75rem' }}>
                        Можда си мислио/ла на <span style={{ color: '#F5F1E8', fontWeight: 600 }}>{typoOf.sr}</span>?
                      </p>
                    )
                  );
                })()}
                <VariantsEditor variants={editRuVariants} onChange={setEditRuVariants} srWord={editSr} />
                <input
                  value={editExample}
                  onChange={(e) => setEditExample(e.target.value)}
                  className="rounded-md px-3 py-1.5 text-sm outline-none"
                  style={{ background: '#12192E', color: '#F5F1E8', border: '1px solid #3A4570' }}
                  placeholder="пример употребе (необавезно)"
                />
                <div className="flex gap-2 mt-1">
                  <button
                    onClick={saveEdit}
                    className="text-xs font-semibold rounded-md px-3 py-1.5"
                    style={{ background: '#3D8B5F', color: '#F5F1E8' }}
                  >
                    Сачувај
                  </button>
                  <button
                    onClick={() => setEditingId(null)}
                    className="text-xs font-semibold rounded-md px-3 py-1.5"
                    style={{ background: '#2A3355', color: '#8892AE' }}
                  >
                    Откажи
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5" style={{ fontFamily: FONT_DISPLAY, color: '#F5F1E8', fontSize: '1rem' }}>
                    {w.sr}
                    <PronounceButton text={w.sr} size={14} />
                    <IpaText text={w.sr} />
                    {wordPosTags.map((t) => (
                      <PosBadge key={t.id} label={posAbbreviation(t.name)} onRemove={() => onUntag(w.id, t.id)} />
                    ))}
                  </div>
                  {otherScript(w.sr) && (
                    <div style={{ color: '#5C6690', fontSize: '0.78rem', marginTop: 1 }}>
                      {otherScript(w.sr)}
                    </div>
                  )}
                  <div style={{ color: '#8892AE', fontSize: '0.85rem', marginTop: 3 }}>{w.ru}</div>
                  {w.example && (
                    <div
                      style={{
                        color: '#6B759C',
                        fontSize: '0.8rem',
                        marginTop: 4,
                        fontStyle: 'italic',
                      }}
                    >
                      «{w.example}»
                    </div>
                  )}
                  {related.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {related.map((r) => (
                        <span
                          key={r.id}
                          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5"
                          style={{
                            background: '#2A2140',
                            color: '#C9A8E8',
                            fontSize: '0.72rem',
                            fontFamily: FONT_MONO,
                          }}
                        >
                          {r.sr}
                          <button
                            onClick={() => onUnlink(w.id, r.id)}
                            aria-label={`Уклони везу са ${r.sr}`}
                            style={{ color: '#8A6FA8', lineHeight: 1 }}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  {wordCustomTags.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 mt-2">
                      {(cardTagsExpanded ? wordCustomTags : wordCustomTags.slice(0, CARD_TAG_CAP)).map((t) => (
                        <span
                          key={t.id}
                          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5"
                          style={{
                            background: '#2A2410',
                            color: '#D4A54A',
                            fontSize: '0.72rem',
                            fontFamily: FONT_MONO,
                          }}
                        >
                          {t.name}
                          <button
                            onClick={() => onUntag(w.id, t.id)}
                            aria-label={`Уклони таг ${t.name}`}
                            style={{ color: '#9C7E30', lineHeight: 1 }}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                      {!cardTagsExpanded && wordCustomTags.length > CARD_TAG_CAP && (
                        <ShowMoreTagsButton
                          count={wordCustomTags.length - CARD_TAG_CAP}
                          onClick={() => setExpandedCardTags((prev) => new Set(prev).add(w.id))}
                        />
                      )}
                    </div>
                  )}
                  {wordGroups.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 mt-2">
                      {wordGroups.map((g) => (
                        <span
                          key={g.id}
                          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5"
                          style={{
                            background: '#12293A',
                            color: '#6FB3D8',
                            fontSize: '0.72rem',
                            fontFamily: FONT_MONO,
                          }}
                        >
                          {g.name}
                          <button
                            onClick={() => onUnshareFromGroup(w.id, g.id)}
                            aria-label={`Уклони из групе ${g.name}`}
                            style={{ color: '#4A7E9C', lineHeight: 1 }}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1.5 shrink-0">
                  <WordStats correct={w.correct_count} wrong={w.wrong_count} />
                  <div className="flex gap-1">
                    <button
                      onClick={() => toggleInflection(w.id, w.sr)}
                      className="p-2 rounded-md"
                      style={{ color: inflectionId === w.id ? '#D4A54A' : '#8892AE' }}
                      aria-label="Прикажи промене по падежима/лицима"
                      title="Прикажи промене по падежима/лицима (Wiktionary, може не наћи ништа)"
                    >
                      <Table2 size={15} />
                    </button>
                    <button
                      onClick={() => startTagging(w.id)}
                      className="p-2 rounded-md"
                      style={{ color: '#8892AE' }}
                      aria-label="Додај таг"
                      title="Додај таг"
                    >
                      <Tag size={15} />
                    </button>
                    {groups && groups.length > 0 && (
                      <button
                        onClick={() => startSharing(w.id)}
                        className="p-2 rounded-md"
                        style={{ color: sharingId === w.id ? '#D4A54A' : '#8892AE' }}
                        aria-label="Подели са групом"
                        title="Подели са групом"
                      >
                        <Users size={15} />
                      </button>
                    )}
                    <button
                      onClick={() => startLinking(w.id)}
                      className="p-2 rounded-md"
                      style={{ color: '#8892AE' }}
                      aria-label="Повежи са другом речи"
                      title="Повежи са сродном речи"
                    >
                      <Link2 size={15} />
                    </button>
                    <button
                      onClick={() => startEdit(w)}
                      className="p-2 rounded-md"
                      style={{ color: '#8892AE' }}
                      aria-label="Уреди"
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      onClick={() => startDelete(w.id)}
                      className="p-2 rounded-md"
                      style={{ color: deletingId === w.id ? '#F5F1E8' : '#C41E3A', background: deletingId === w.id ? '#C41E3A' : 'transparent' }}
                      aria-label="Обриши"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              </div>
            )}

            {linkingId === w.id && (
              <RelatedWordPicker
                word={w}
                allWords={words}
                query={linkQuery}
                onQueryChange={setLinkQuery}
                onPick={(otherId) => {
                  onLink(w.id, otherId);
                  setLinkingId(null);
                }}
                onCancel={() => setLinkingId(null)}
              />
            )}

            {taggingId === w.id && (
              <TagPicker
                word={w}
                allTags={tags || []}
                tagById={tagById}
                query={tagQuery}
                onQueryChange={setTagQuery}
                onPick={(name) => {
                  onTag(w.id, name);
                  setTagQuery('');
                }}
                onCancel={() => setTaggingId(null)}
              />
            )}

            {sharingId === w.id && (
              <GroupSharePicker
                word={w}
                allGroups={groups || []}
                onPick={(groupId) => onShareToGroup(w.id, groupId)}
                onCancel={() => setSharingId(null)}
              />
            )}

            {inflectionId === w.id && (
              <div className="rounded-lg p-3" style={{ background: '#12192E', border: '1px solid #3A4570' }}>
                {inflectionState === 'loading' && (
                  <p className="flex items-center gap-1.5" style={{ color: '#8892AE', fontSize: '0.78rem' }}>
                    <Loader2 size={13} className="animate-spin" /> тражим…
                  </p>
                )}
                {inflectionState === 'notfound' && (
                  <p style={{ color: '#8892AE', fontSize: '0.78rem' }}>
                    Ништа нађено на Wiktionary-ју — реч можда тамо не постоји или нема наведену табелу.
                  </p>
                )}
                {inflectionState === 'error' && (
                  <p style={{ color: '#8892AE', fontSize: '0.78rem' }}>Претрага тренутно није доступна.</p>
                )}
                {inflectionState === 'idle' && inflectionTables && <InflectionTables tables={inflectionTables} />}
              </div>
            )}

            {deletingId === w.id && (
              // Stacked vertically rather than side-by-side with the buttons —
              // a horizontal layout squeezed the message into an awkwardly
              // narrow column on phone-width screens, wrapping one or two
              // words per line.
              <div className="flex flex-col gap-3 rounded-lg p-3" style={{ background: '#2A1218', border: '1px solid #C41E3A' }}>
                <p style={{ color: '#F5F1E8', fontSize: '0.85rem' }}>
                  Обрисати <strong>{w.sr}</strong>? Ово укључује њене тагове, везе и статистику, и не може се
                  опозвати.
                </p>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setDeletingId(null)}
                    className="rounded-lg px-3 py-1.5"
                    style={{ fontFamily: FONT_BODY, fontSize: '0.85rem', color: '#8892AE', background: '#12192E', border: '1px solid #2A3355' }}
                  >
                    Откажи
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onDelete(w.id);
                      setDeletingId(null);
                    }}
                    className="rounded-lg px-3 py-1.5"
                    style={{ fontFamily: FONT_BODY, fontSize: '0.85rem', color: '#F5F1E8', background: '#C41E3A' }}
                  >
                    Да, обриши
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function TagPicker({ word, allTags, tagById, query, onQueryChange, onPick, onCancel }) {
  const alreadyTagged = new Set(word.tagIds);
  const q = query.trim().toLowerCase();
  const candidates = allTags
    .filter((t) => !alreadyTagged.has(t.id))
    .filter((t) => !q || t.name.toLowerCase().includes(q))
    .slice(0, 6);

  // A tag matching exactly what's typed, whether or not it's already on
  // this word — distinct from "no such tag exists at all", which is what
  // decides whether to offer creating a new one.
  const matchingTag = q ? allTags.find((t) => t.name.toLowerCase() === q) : null;
  const alreadyAppliedExact = matchingTag && alreadyTagged.has(matchingTag.id);

  return (
    <div className="rounded-lg p-3" style={{ background: '#12192E', border: '1px solid #3A4570' }}>
      <div style={{ color: '#8892AE', fontSize: '0.78rem', marginBottom: 6 }}>
        Додај таг за <span style={{ color: '#F5F1E8', fontWeight: 600 }}>{word.sr}</span>:
      </div>
      <input
        autoFocus
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={(e) => {
          // Previously fired regardless of alreadyAppliedExact, sending a
          // pointless (if harmless) network request to re-apply a tag
          // that's already there.
          if (e.key === 'Enter' && query.trim() && !alreadyAppliedExact) {
            e.preventDefault();
            onPick(query.trim());
          }
        }}
        placeholder="нпр. храна, глаголи…"
        autoComplete="off"
        className="w-full rounded-md px-3 py-1.5 text-sm outline-none mb-2"
        style={{ background: '#1B2440', color: '#F5F1E8', border: '1px solid #3A4570' }}
      />
      <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
        {candidates.map((t) => (
          <button
            key={t.id}
            onClick={() => onPick(t.name)}
            className="text-left rounded-md px-2.5 py-1.5"
            style={{ background: '#1B2440', color: '#D4A54A', fontSize: '0.85rem' }}
          >
            {t.name}
          </button>
        ))}
        {alreadyAppliedExact && (
          // Previously a silent dead end: candidates excludes already-
          // applied tags and the old exactExists check (against ALL tags)
          // also hid the "create new" option here, leaving nothing shown.
          <div style={{ color: '#5C6690', fontSize: '0.8rem', padding: '4px 2px' }}>
            Тај таг је већ додат.
          </div>
        )}
        {query.trim() && !matchingTag && (
          <button
            onClick={() => onPick(query.trim())}
            className="text-left rounded-md px-2.5 py-1.5"
            style={{ background: '#1B2440', color: '#7DC79A', fontSize: '0.85rem' }}
          >
            + направи нови таг „{query.trim()}"
          </button>
        )}
        {candidates.length === 0 && !query.trim() && (
          <div style={{ color: '#5C6690', fontSize: '0.8rem', padding: '4px 2px' }}>
            Још нема тагова — упиши да направиш први.
          </div>
        )}
      </div>
      <button
        onClick={onCancel}
        className="text-xs font-semibold rounded-md px-3 py-1.5 mt-2"
        style={{ background: '#2A3355', color: '#8892AE' }}
      >
        Затвори
      </button>
    </div>
  );
}

// Groups a word isn't already shared to — no search box (a person's group
// count is small) and no "create new" affordance (creating a group is a
// bigger action, done from the Groups tab, not inline here).
function GroupSharePicker({ word, allGroups, onPick, onCancel }) {
  const alreadyShared = new Set(word.groupIds);
  const candidates = allGroups.filter((g) => !alreadyShared.has(g.id));

  return (
    <div className="rounded-lg p-3" style={{ background: '#12192E', border: '1px solid #3A4570' }}>
      <div style={{ color: '#8892AE', fontSize: '0.78rem', marginBottom: 6 }}>
        Подели <span style={{ color: '#F5F1E8', fontWeight: 600 }}>{word.sr}</span> са групом:
      </div>
      <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
        {candidates.map((g) => (
          <button
            key={g.id}
            onClick={() => onPick(g.id)}
            className="text-left rounded-md px-2.5 py-1.5"
            style={{ background: '#1B2440', color: '#6FB3D8', fontSize: '0.85rem' }}
          >
            {g.name}
          </button>
        ))}
        {candidates.length === 0 && (
          <div style={{ color: '#5C6690', fontSize: '0.8rem', padding: '4px 2px' }}>
            Већ подељено са свим твојим групама.
          </div>
        )}
      </div>
      <button
        onClick={onCancel}
        className="text-xs font-semibold rounded-md px-3 py-1.5 mt-2"
        style={{ background: '#2A3355', color: '#8892AE' }}
      >
        Затвори
      </button>
    </div>
  );
}

function RelatedWordPicker({ word, allWords, query, onQueryChange, onPick, onCancel }) {
  const candidates = allWords
    .filter((w) => w.id !== word.id && !word.relatedIds.includes(w.id))
    .filter((w) => {
      if (!query.trim()) return true;
      const q = normalize(query);
      return normalize(w.sr).includes(q) || normalize(w.ru).includes(q);
    })
    .slice(0, 6);

  return (
    <div
      className="rounded-lg p-3"
      style={{ background: '#12192E', border: '1px solid #3A4570' }}
    >
      <div style={{ color: '#8892AE', fontSize: '0.78rem', marginBottom: 6 }}>
        Повежи <span style={{ color: '#F5F1E8', fontWeight: 600 }}>{word.sr}</span> са сродном речи
        (нпр. исти корен):
      </div>
      <input
        autoFocus
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder="претражи речи…"
        className="w-full rounded-md px-3 py-1.5 text-sm outline-none mb-2"
        style={{ background: '#1B2440', color: '#F5F1E8', border: '1px solid #3A4570' }}
      />
      <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
        {candidates.length === 0 ? (
          <div style={{ color: '#5C6690', fontSize: '0.8rem', padding: '4px 2px' }}>
            Нема резултата.
          </div>
        ) : (
          candidates.map((w) => (
            <button
              key={w.id}
              onClick={() => onPick(w.id)}
              className="text-left rounded-md px-2.5 py-1.5 flex items-baseline gap-2"
              style={{ background: '#1B2440' }}
            >
              <span style={{ fontFamily: FONT_DISPLAY, color: '#F5F1E8', fontSize: '0.9rem' }}>
                {w.sr}
              </span>
              <span style={{ color: '#8892AE', fontSize: '0.78rem' }}>{w.ru}</span>
            </button>
          ))
        )}
      </div>
      <button
        onClick={onCancel}
        className="text-xs font-semibold rounded-md px-3 py-1.5 mt-2"
        style={{ background: '#2A3355', color: '#8892AE' }}
      >
        Откажи
      </button>
    </div>
  );
}
