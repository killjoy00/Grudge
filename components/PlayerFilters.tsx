'use client';
import { useState } from 'react';
import { PLAYER_POSITIONS, SORT_OPTIONS, type PlayerFilters as Filters } from '../lib/player-data.ts';

export function PlayerFilters({ filters, seasons, profile = false }: {
  filters: Filters; seasons: number[]; profile?: boolean;
}) {
  const [season, setSeason] = useState(filters.season);
  const [period, setPeriod] = useState(filters.period);
  const [from, setFrom] = useState(filters.from);
  const [to, setTo] = useState(filters.to);
  const max = season >= 2021 ? 18 : 17;
  const first = period === 'REG' ? 1 : max + 1;
  const last = period === 'REG' ? max : max + 4;
  const weeks = Array.from({length: last - first + 1}, (_, i) => first + i);
  function resetRange(year: number, type: 'REG' | 'POST') {
    const end = year >= 2021 ? 18 : 17;
    setFrom(type === 'REG' ? 1 : end + 1); setTo(type === 'REG' ? end : end + 4);
  }
  return <form className={`card player-filters ${profile ? 'profile-filters' : ''}`}>
    {!profile && <label className="player-search"><span>Find a player</span>
      <input type="text" name="q" defaultValue={filters.q} placeholder="Search any player…" maxLength={80} autoComplete="off" />
    </label>}
    <label><span>Season</span><select name="season" value={season} onChange={e => {
      const year = Number(e.target.value); setSeason(year); resetRange(year, period);
    }}>{seasons.map(year => <option key={year} value={year}>{year}</option>)}</select></label>
    {!profile && <label><span>Position</span><select name="position" defaultValue={filters.position}>
      <option value="">All positions</option>{PLAYER_POSITIONS.map(p => <option key={p}>{p}</option>)}
    </select></label>}
    <label className="player-period"><span>Schedule</span><select name="period" value={period} onChange={e => {
      const type = e.target.value as 'REG' | 'POST'; setPeriod(type); resetRange(season, type);
    }}><option value="REG">NFL regular season</option><option value="POST">NFL playoffs</option></select></label>
    <label><span>From week</span><select name="from" value={from} onChange={e => {
      const week = Number(e.target.value); setFrom(week); if (week > to) setTo(week);
    }}>{weeks.map(w => <option key={w} value={w}>Week {w}</option>)}</select></label>
    <label><span>Through week</span><select name="to" value={to} onChange={e => {
      const week = Number(e.target.value); setTo(week); if (week < from) setFrom(week);
    }}>{weeks.map(w => <option key={w} value={w}>Week {w}</option>)}</select></label>
    {!profile && <><label className="player-sort"><span>Sort by</span><select name="sort" defaultValue={filters.sort}>
      {SORT_OPTIONS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
    </select></label><label><span>Order</span><select name="direction" defaultValue={filters.direction}>
      <option value="desc">Highest first</option><option value="asc">Lowest / A–Z</option>
    </select></label></>}
    <button type="submit">Show {profile ? 'season' : 'players'}</button>
    {!profile && <a className="btn btn-quiet" href="/players">Reset</a>}
  </form>;
}
