'use client';

import { LeagueSettings, ScoringFormat, DEFAULT_SETTINGS, keeperBar, replacementWar } from '@/lib/value-model';

const SLOT_KEYS: { key: string; label: string }[] = [
  { key: 'C', label: 'C' }, { key: '1B', label: '1B' }, { key: '2B', label: '2B' },
  { key: '3B', label: '3B' }, { key: 'SS', label: 'SS' }, { key: 'OF', label: 'OF' },
  { key: 'UTIL', label: 'UTIL' }, { key: 'P', label: 'P' },
];
const FORMATS: { key: ScoringFormat; label: string }[] = [
  { key: 'obp', label: 'OBP' }, { key: 'avg', label: 'AVG' }, { key: 'points', label: 'Points' },
];

function Stepper({ value, onChange, min, max }: { value: number; onChange: (v: number) => void; min: number; max: number }) {
  const set = (v: number) => onChange(Math.max(min, Math.min(max, v)));
  return (
    <span className="inline-flex items-center gap-1">
      <button onClick={() => set(value - 1)} className="w-5 h-5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs cursor-pointer leading-none">−</button>
      <span className="w-6 text-center text-xs font-semibold text-zinc-100 tabular-nums">{value}</span>
      <button onClick={() => set(value + 1)} className="w-5 h-5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs cursor-pointer leading-none">+</button>
    </span>
  );
}

export default function LeagueSettingsPanel({ settings, onChange }: { settings: LeagueSettings; onChange: (s: LeagueSettings) => void }) {
  const set = (patch: Partial<LeagueSettings>) => onChange({ ...settings, ...patch });
  const setSlot = (key: string, v: number) => onChange({ ...settings, slots: { ...settings.slots, [key]: v } });
  const total = Math.round(settings.teams * settings.keepers);

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 mb-4 text-sm">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <label className="flex items-center gap-2 text-zinc-400">Teams <Stepper value={settings.teams} onChange={(v) => set({ teams: v })} min={4} max={30} /></label>
        <label className="flex items-center gap-2 text-zinc-400">Keepers/team <Stepper value={settings.keepers} onChange={(v) => set({ keepers: v })} min={0} max={40} /></label>
        <div className="flex items-center gap-1.5 text-zinc-400">
          Format
          <div className="inline-flex rounded-md overflow-hidden border border-zinc-700">
            {FORMATS.map((f) => (
              <button key={f.key} onClick={() => set({ format: f.key })}
                className={`px-2 py-0.5 text-xs cursor-pointer ${settings.format === f.key ? 'bg-orange-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'}`}>
                {f.label}
              </button>
            ))}
          </div>
        </div>
        <button onClick={() => onChange({ ...DEFAULT_SETTINGS, slots: { ...DEFAULT_SETTINGS.slots } })}
          className="text-[11px] text-zinc-500 hover:text-zinc-300 underline cursor-pointer ml-auto">Reset</button>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-3 pt-3 border-t border-zinc-800">
        <span className="text-[11px] text-zinc-500 mr-1">Starting slots</span>
        {SLOT_KEYS.map((s) => (
          <label key={s.key} className="flex items-center gap-1.5 text-zinc-400 text-xs">
            {s.label} <Stepper value={settings.slots[s.key] ?? 0} onChange={(v) => setSlot(s.key, v)} min={0} max={12} />
          </label>
        ))}
      </div>

      <p className="text-[11px] text-zinc-500 mt-3 pt-2 border-t border-zinc-800">
        {total.toLocaleString()} total keepers · keeper bar <span className="text-fuchsia-300 font-semibold">{keeperBar(settings).toFixed(1)} WAR</span> · replacement <span className="text-blue-300 font-semibold">{replacementWar(settings).toFixed(1)} WAR</span>
        {settings.format !== 'obp' && <> · {settings.format === 'points' ? 'points: playing time weighted up, SB down' : 'AVG: walk-driven value down'}</>}
      </p>
    </div>
  );
}
