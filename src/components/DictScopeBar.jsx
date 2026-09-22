import { TagFilterPill } from './Pills';

// Which dictionary to show/practice: 'all' (everything visible — own words
// plus anything shared with the caller), 'mine' (only words the caller
// themselves added), or a specific group id. Unlike TagScopeBar (which has
// real capping/ranking logic), this list is always short and plain, so one
// component covers both WordsList and Practice without needing per-screen
// state beyond which `scope` is currently selected.
export function DictScopeBar({ groups, scope, onChange }) {
  if (!groups || groups.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <TagFilterPill active={scope === 'all' || !scope} label="Све" onClick={() => onChange('all')} />
      <TagFilterPill active={scope === 'mine'} label="Моје" onClick={() => onChange('mine')} />
      {groups.map((g) => (
        <TagFilterPill key={g.id} active={scope === g.id} label={g.name} onClick={() => onChange(g.id)} />
      ))}
    </div>
  );
}
