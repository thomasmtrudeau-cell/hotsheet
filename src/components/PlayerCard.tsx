'use client';

import { useState } from 'react';
import { DailyPlayerStats, SeasonPlayerStats, LeagueAverages, LEVEL_LABELS, isMLBSystem, Group, RecentForm, Matchup } from '@/lib/types';
import GradeBadge from './GradeBadge';
import GroupTag from './GroupTag';
import GameLog from './GameLog';
import LevelBreakdown from './LevelBreakdown';

// Chevron toggle for expanding a card's recent game log (MLB/MiLB only).
function LogToggle({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`transition-colors p-1 cursor-pointer ${open ? 'text-blue-400' : 'text-zinc-600 hover:text-zinc-400'}`}
      title="Recent games"
    >
      <svg className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
      </svg>
    </button>
  );
}

// Optional per-card group-assignment controls (omitted in pre-auth states).
interface GroupControl {
  groups: Group[];
  memberOf: string[];
  onAssignGroups: (playerId: number, groupIds: string[]) => void;
}

interface DailyCardProps {
  type: 'daily';
  stats: DailyPlayerStats;
  onUnfollow: (playerId: number) => void;
  leagueAvg?: LeagueAverages;
  groupControl?: GroupControl;
  war?: number; // peak WAR (premium only)
}

interface SeasonCardProps {
  type: 'season';
  stats: SeasonPlayerStats;
  onUnfollow: (playerId: number) => void;
  leagueAvg?: LeagueAverages;
  groupControl?: GroupControl;
  war?: number; // peak WAR (premium only)
}

type PlayerCardProps = DailyCardProps | SeasonCardProps;

// A rehab assignment is a specific MLB roster status ("RA"): an IL player
// (usually from the majors) temporarily playing for a minor-league affiliate.
// This is distinct from a minor-leaguer who is simply on the minor-league IL —
// so we rely on the roster-derived flag, NOT "injured + has a game today".
function isOnRehab(stats: DailyPlayerStats): boolean {
  return Boolean(stats.onRehab);
}

function CallUpBadge({ date }: { date: string }) {
  const label = (() => {
    const [, m, d] = date.split('-');
    return m && d ? `${parseInt(m, 10)}/${parseInt(d, 10)}` : date;
  })();
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-sky-500/20 text-sky-300"
      title={`Recently called up (${label})`}
    >
      CALL-UP
    </span>
  );
}

function WarBadge({ war }: { war: number }) {
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300"
      title="Peak WAR"
    >
      {war.toFixed(1)} WAR
    </span>
  );
}

function TwoStartBadge({ dates }: { dates: string[] }) {
  // "2026-07-06" -> "7/6"
  const fmt = (d: string) => {
    const [, m, day] = d.split('-');
    return `${parseInt(m, 10)}/${parseInt(day, 10)}`;
  };
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-500/20 text-indigo-300"
      title={`Two starts this week: ${dates.map(fmt).join(' & ')}`}
    >
      2-START WK
    </span>
  );
}

function RehabBadge() {
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-400">
      REHAB
    </span>
  );
}

function ILBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-500/20 text-red-400">
      {label}
    </span>
  );
}

function LevelBadge({ sportId }: { sportId: number }) {
  let colorClass = 'bg-amber-500/20 text-amber-400'; // MiLB default
  if (sportId === 1) colorClass = 'bg-blue-500/20 text-blue-400'; // MLB
  else if (sportId === 100) colorClass = 'bg-red-500/20 text-red-400'; // NPB
  else if (sportId === 101) colorClass = 'bg-purple-500/20 text-purple-400'; // KBO

  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${colorClass}`}>
      {LEVEL_LABELS[sportId] || '?'}
    </span>
  );
}

function GameStatusDot({ status }: { status: DailyPlayerStats['gameStatus'] }) {
  const colors: Record<string, string> = {
    Live: 'bg-green-500 animate-pulse',
    Final: 'bg-zinc-500',
    Scheduled: 'bg-blue-500',
    'No Game': 'bg-zinc-700',
    Postponed: 'bg-yellow-500',
  };
  return <span className={`inline-block w-2 h-2 rounded-full ${colors[status] || 'bg-zinc-700'}`} />;
}

function LineupBadge({ status, startingPosition, battingOrder }: {
  status: 'starting' | 'not_starting' | 'probable_pitcher' | 'tbd';
  startingPosition?: string;
  battingOrder?: number;
}) {
  if (status === 'starting' || status === 'probable_pitcher') {
    let label = status === 'probable_pitcher' ? 'SP' : 'STARTING';
    if (status === 'starting' && startingPosition && battingOrder) {
      label = `${startingPosition} / ${battingOrder}`;
    }
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-green-500/20 text-green-400">
        {label}
      </span>
    );
  }
  if (status === 'tbd') {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-zinc-700/50 text-zinc-400">
        LINEUP TBD
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-zinc-600/30 text-zinc-500">
      NOT STARTING
    </span>
  );
}

function TeamLine({ team, sportId, parentOrgAbbrev }: { team: string; sportId: number; parentOrgAbbrev?: string }) {
  if (sportId === 1 || !parentOrgAbbrev) return <>{team}</>;
  return <>{team} <span className="text-zinc-600">({parentOrgAbbrev})</span></>;
}

function stripParen(name: string): string {
  const i = name.indexOf(' (');
  return i >= 0 ? name.slice(0, i) : name;
}

function XSearchLink({ playerName }: { playerName: string }) {
  const url = `https://x.com/search?q=%22${encodeURIComponent(playerName)}%22&f=live`;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="text-zinc-600 hover:text-zinc-400 transition-colors p-1"
      title="Search on X"
    >
      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
    </a>
  );
}

function FGSearchLink({ playerName }: { playerName: string }) {
  const url = `https://www.fangraphs.com/search?q=${encodeURIComponent(stripParen(playerName))}`;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="text-zinc-600 hover:text-emerald-400 transition-colors px-1 py-1 text-[10px] font-bold tracking-wider"
      title="Search on FanGraphs"
    >
      FG
    </a>
  );
}

function LeagueContext({ leagueAvg, isPitcher }: { leagueAvg: LeagueAverages; isPitcher: boolean }) {
  return (
    <div className="mt-2 pt-2 border-t border-zinc-700/30 flex items-center gap-3 text-[10px] text-zinc-600">
      <span className="font-semibold text-zinc-500">{leagueAvg.level} avg</span>
      <span>Age {leagueAvg.avgAge}</span>
      {isPitcher ? (
        <span>ERA {leagueAvg.lgERA}</span>
      ) : (
        <>
          <span>OPS {leagueAvg.lgOPS}</span>
        </>
      )}
    </div>
  );
}

// Rolling last-15-day line; green when hot, red when cold, numbers stay primary.
function RecentFormRow({ form }: { form: RecentForm }) {
  if (!form.gamesPlayed) return null;
  const color = form.trend === 'hot' ? 'text-emerald-400' : form.trend === 'cold' ? 'text-red-400' : 'text-zinc-300';
  return (
    <div className="mt-2 flex items-center gap-1.5 text-[11px]" title={`Last 15 days (${form.gamesPlayed} G)${form.isPitcher ? '' : ' · wRC+ estimated'}`}>
      <span className="text-zinc-500 font-medium">L15</span>
      <span className={`font-mono ${color}`}>{form.line}</span>
      {form.trend === 'hot' && <span aria-label="hot">🔥</span>}
      {form.trend === 'cold' && <span aria-label="cold">🧊</span>}
    </div>
  );
}

// Today's opposing starter + park, colored by favorability to the hitter
// (weak pitcher / hitter-friendly park = green; tough / pitcher-friendly = red).
function MatchupRow({ m }: { m: Matchup }) {
  const hand = m.oppStarterHand ? `${m.oppStarterHand}HP ` : '';
  const eraColor = m.oppStarterEra === undefined ? 'text-zinc-300'
    : m.oppStarterEra >= 4.5 ? 'text-emerald-400'
    : m.oppStarterEra <= 3.25 ? 'text-red-400' : 'text-zinc-300';
  const pfColor = m.parkFactor === undefined ? 'text-zinc-300'
    : m.parkFactor >= 103 ? 'text-emerald-400'
    : m.parkFactor <= 97 ? 'text-red-400' : 'text-zinc-300';
  return (
    <div className="flex items-center gap-1.5 mb-2 text-[11px] text-zinc-500 flex-wrap">
      {m.oppStarterName && (
        <span>
          vs {hand}<span className="text-zinc-300">{m.oppStarterName}</span>
          {m.oppStarterEra !== undefined && <> · <span className={eraColor}>{m.oppStarterEra.toFixed(2)} ERA</span></>}
        </span>
      )}
      {m.parkFactor !== undefined && (
        <span title="Park factor (100 = neutral, higher = more offense)">
          {m.oppStarterName ? '· ' : ''}<span className={pfColor}>Park {m.parkFactor}</span>
        </span>
      )}
    </div>
  );
}

function DailyCard({ stats, onUnfollow, groupControl, war }: { stats: DailyPlayerStats; onUnfollow: (id: number) => void; groupControl?: GroupControl; war?: number }) {
  const [logOpen, setLogOpen] = useState(false);
  const canLog = isMLBSystem(stats.sportId);
  const onRehab = isOnRehab(stats);
  // Rehab players read as "active" — don't paint the whole card red.
  const borderClass = stats.injury && !onRehab
    ? 'border-red-500/60 hover:border-red-500/80'
    : 'border-zinc-700/50 hover:border-zinc-600/50';
  return (
    <div className={`bg-zinc-800/60 border ${borderClass} rounded-xl p-4 transition-colors`} title={stats.injury?.note}>
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
            <h3 className="text-sm font-semibold text-zinc-100 truncate">{stats.playerName}</h3>
            <LevelBadge sportId={stats.sportId} />
            {stats.injury && <ILBadge label={stats.injury.label} />}
            {onRehab && <RehabBadge />}
            {stats.twoStartDates && stats.twoStartDates.length >= 2 && <TwoStartBadge dates={stats.twoStartDates} />}
            {stats.calledUpDate && <CallUpBadge date={stats.calledUpDate} />}
            {war !== undefined && <WarBadge war={war} />}
          </div>
          <div className="text-xs text-zinc-500">
            {stats.position} &middot; <TeamLine team={stats.team} sportId={stats.sportId} parentOrgAbbrev={stats.parentOrgAbbrev} />
          </div>
        </div>
        <div className="flex items-center gap-0.5">
          {canLog && <LogToggle open={logOpen} onClick={() => setLogOpen((o) => !o)} />}
          {groupControl && (
            <GroupTag
              playerId={stats.playerId}
              groups={groupControl.groups}
              memberOf={groupControl.memberOf}
              onChange={groupControl.onAssignGroups}
            />
          )}
          <FGSearchLink playerName={stats.playerName} />
          <XSearchLink playerName={stats.playerName} />
          <button
            onClick={() => onUnfollow(stats.playerId)}
            className="ml-1 pl-1.5 border-l border-zinc-700/60 text-zinc-600 hover:text-red-400 transition-colors p-1 cursor-pointer"
            title="Unfollow"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </div>

      {/* Game context */}
      <div className="flex items-center gap-2 mb-2">
        <GameStatusDot status={stats.gameStatus} />
        {stats.gameStatus === 'No Game' ? (
          <span className="text-xs text-zinc-400">No game</span>
        ) : stats.gamePk ? (
          <a
            href={`https://www.mlb.com/gameday/${stats.gamePk}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-zinc-400 hover:text-blue-400 hover:underline transition-colors"
            onClick={(e) => e.stopPropagation()}
          >
            {stats.gameContext}
          </a>
        ) : (
          <span className="text-xs text-zinc-400">{stats.gameContext}</span>
        )}
        {stats.gameTime && stats.gameStatus === 'Scheduled' && (
          <span className="text-xs text-zinc-500">{stats.gameTime}</span>
        )}
      </div>

      {/* Matchup (hitters, upcoming/live game) */}
      {stats.matchup && (stats.gameStatus === 'Scheduled' || stats.gameStatus === 'Live') && (
        <MatchupRow m={stats.matchup} />
      )}

      {/* Stat line */}
      {stats.statLine && stats.gameStatus !== 'Scheduled' && stats.gameStatus !== 'No Game' && (
        <div className="mb-2 px-3 py-2 bg-zinc-900/50 rounded-lg">
          <div className="text-sm font-mono text-zinc-200">{stats.statLine}</div>
        </div>
      )}

      {/* Lineup status + Grade */}
      <div className="flex items-center gap-2">
        <GradeBadge grade={stats.performanceGrade} reason={stats.gradeReason} />
        {stats.gameStatus === 'Scheduled' && isMLBSystem(stats.sportId) && (
          <LineupBadge
            status={stats.lineupStatus ?? 'tbd'}
            startingPosition={stats.startingPosition}
            battingOrder={stats.battingOrder}
          />
        )}
      </div>

      {/* Recent form (rolling last 15 days) */}
      {stats.recentForm && <RecentFormRow form={stats.recentForm} />}

      {logOpen && canLog && (
        <GameLog playerId={stats.playerId} sportId={stats.sportId} isPitcher={stats.position === 'P'} />
      )}
    </div>
  );
}

function SeasonCard({ stats, onUnfollow, leagueAvg, groupControl, war }: { stats: SeasonPlayerStats; onUnfollow: (id: number) => void; leagueAvg?: LeagueAverages; groupControl?: GroupControl; war?: number }) {
  const [logOpen, setLogOpen] = useState(false);
  const [levelOpen, setLevelOpen] = useState(false);
  const canLog = isMLBSystem(stats.sportId);
  const multiLevel = (stats.levelLines?.length ?? 0) > 1;
  // Prefer real wRC+ (MLB), then estimated wRC+ (MiLB), then legacy OPS+ (NPB/KBO).
  const plus = stats.wrcPlus ?? stats.wrcPlusEst ?? stats.opsPlus;
  const plusIsEst = stats.wrcPlus === undefined && stats.wrcPlusEst !== undefined;
  const adjustedPlusLabel = stats.wrcPlus !== undefined ? 'wRC+'
    : plusIsEst ? 'wRC+*'
    : stats.opsPlus !== undefined ? 'OPS+' : 'wRC+';
  const borderClass = stats.injury
    ? 'border-red-500/60 hover:border-red-500/80'
    : 'border-zinc-700/50 hover:border-zinc-600/50';

  return (
    <div className={`bg-zinc-800/60 border ${borderClass} rounded-xl p-4 transition-colors`} title={stats.injury?.note}>
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
            <h3 className="text-sm font-semibold text-zinc-100 truncate">{stats.playerName}</h3>
            <LevelBadge sportId={stats.sportId} />
            {stats.injury && <ILBadge label={stats.injury.label} />}
            {war !== undefined && <WarBadge war={war} />}
          </div>
          <div className="text-xs text-zinc-500">
            {stats.position} &middot; <TeamLine team={stats.team} sportId={stats.sportId} parentOrgAbbrev={stats.parentOrgAbbrev} /> &middot; {stats.gamesPlayed} G
            {multiLevel && (
              <>
                {' '}&middot;{' '}
                <button
                  onClick={() => setLevelOpen((o) => !o)}
                  className="text-blue-400 hover:text-blue-300 transition-colors cursor-pointer"
                >
                  {stats.levelLines!.length} levels {levelOpen ? '▴' : '▾'}
                </button>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-0.5">
          {canLog && <LogToggle open={logOpen} onClick={() => setLogOpen((o) => !o)} />}
          {groupControl && (
            <GroupTag
              playerId={stats.playerId}
              groups={groupControl.groups}
              memberOf={groupControl.memberOf}
              onChange={groupControl.onAssignGroups}
            />
          )}
          <FGSearchLink playerName={stats.playerName} />
          <XSearchLink playerName={stats.playerName} />
          <button
            onClick={() => onUnfollow(stats.playerId)}
            className="ml-1 pl-1.5 border-l border-zinc-700/60 text-zinc-600 hover:text-red-400 transition-colors p-1 cursor-pointer"
            title="Unfollow"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </div>

      {/* Season stats */}
      <div className="px-3 py-2 bg-zinc-900/50 rounded-lg">
        {stats.isPitcher ? (
          <div className="grid grid-cols-3 gap-x-4 gap-y-1.5">
            <StatCell label="ERA" value={stats.era || '—'} />
            <StatCell label="WHIP" value={stats.whip || '—'} />
            <StatCell label="IP" value={stats.inningsPitched || '—'} />
            <StatCell label="K" value={stats.pitchingStrikeouts?.toString() || '—'} />
            <StatCell label="BB" value={stats.walksAllowed?.toString() || '—'} />
            <StatCell label="W-L" value={`${stats.wins || 0}-${stats.losses || 0}`} />
            <StatCell label="SV" value={stats.saves?.toString() || '—'} />
            <StatCell label="K/9" value={stats.kPer9 || '—'} />
            <StatCell label="BB/9" value={stats.bbPer9 || '—'} />
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-x-4 gap-y-1.5">
            <StatCell label="AVG" value={stats.avg || '—'} highlight={parseFloat(stats.avg || '0') >= 0.3} />
            <StatCell label="OBP" value={stats.obp || '—'} />
            <StatCell label="SLG" value={stats.slg || '—'} />
            <StatCell label="ISO" value={isoValue(stats.avg, stats.slg)} highlight={isoFloat(stats.avg, stats.slg) >= 0.2} />
            <StatCell label="OPS" value={stats.ops || '—'} highlight={parseFloat(stats.ops || '0') >= 0.9} />
            <StatCell label="wOBA" value={stats.woba || '—'} highlight={parseFloat(stats.woba || '0') >= 0.36} />
            <StatCell label={adjustedPlusLabel} value={plus !== undefined ? Math.round(plus).toString() : '—'} highlight={(plus || 0) >= 130} />
            <StatCell label="HR" value={stats.homeRuns?.toString() || '—'} />
            <StatCell label="SB" value={stats.stolenBases?.toString() || '—'} />
            <StatCell label="BB" value={stats.walks?.toString() || '—'} />
            <StatCell label="K" value={stats.strikeouts?.toString() || '—'} />
            <StatCell label="PA" value={stats.plateAppearances?.toString() || '—'} />
          </div>
        )}
        {leagueAvg && (
          <LeagueContext leagueAvg={leagueAvg} isPitcher={stats.isPitcher} />
        )}
        {plusIsEst && (
          <div className="mt-1.5 text-[9px] text-zinc-600">* wRC+ estimated (no minor-league park factor)</div>
        )}
      </div>

      {levelOpen && multiLevel && <LevelBreakdown lines={stats.levelLines!} />}

      {logOpen && canLog && (
        <GameLog playerId={stats.playerId} sportId={stats.sportId} isPitcher={stats.isPitcher} />
      )}
    </div>
  );
}

function isoFloat(avg?: string, slg?: string): number {
  const a = parseFloat(avg || '');
  const s = parseFloat(slg || '');
  if (!isFinite(a) || !isFinite(s)) return 0;
  return s - a;
}

function isoValue(avg?: string, slg?: string): string {
  const a = parseFloat(avg || '');
  const s = parseFloat(slg || '');
  if (!isFinite(a) || !isFinite(s)) return '—';
  const iso = s - a;
  return iso.toFixed(3).replace(/^0/, '');
}

function StatCell({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] text-zinc-500 uppercase tracking-wider">{label}</span>
      <span className={`text-sm font-mono ${highlight ? 'text-green-400 font-semibold' : 'text-zinc-200'}`}>
        {value}
      </span>
    </div>
  );
}

export default function PlayerCard(props: PlayerCardProps) {
  if (props.type === 'daily') {
    return <DailyCard stats={props.stats} onUnfollow={props.onUnfollow} groupControl={props.groupControl} war={props.war} />;
  }
  return <SeasonCard stats={props.stats} onUnfollow={props.onUnfollow} leagueAvg={props.leagueAvg} groupControl={props.groupControl} war={props.war} />;
}
