import type { LeagueWireEvent, LeagueWireKind } from '../lib/league-wire.ts';

const LABELS: Record<LeagueWireKind, string> = {
  trade: 'Trade',
  pickup: 'Roster move',
  award: 'Award',
  prediction: 'Predictions',
  ranking: 'Power move',
  record: 'Record',
  recap: 'Recap',
};

function EventTitle({ event }: { event: LeagueWireEvent }) {
  if (!event.href) return <strong>{event.title}</strong>;
  return <a href={event.href} className="tname">{event.title}</a>;
}

export function LeagueWire({ events }: { events: LeagueWireEvent[] }) {
  return (
    <section aria-labelledby="league-wire-heading" style={{ marginTop: 30 }}>
      <div className="page-hero compact-hero" style={{ marginBottom: 12 }}>
        <div className="eyebrow">Around the league</div>
        <h2 id="league-wire-heading" style={{ marginBottom: 4 }}>League Wire</h2>
        <p>Trades, pickups, awards, prediction results, records and the biggest ranking moves.</p>
      </div>

      <div className="card">
        {events.length === 0 ? (
          <p className="empty" style={{ margin: 0 }}>
            Nothing has hit the wire yet this season.
          </p>
        ) : events.map((event, index) => (
          <article
            key={event.id}
            style={{
              padding: '12px 0',
              borderBottom: index === events.length - 1 ? undefined : '1px solid var(--line)',
            }}
          >
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 5 }}>
              <span className="tag era">{LABELS[event.kind]}</span>
              <span className="note">Week {event.week}</span>
            </div>
            <div style={{ lineHeight: 1.35 }}>
              <EventTitle event={event} />
            </div>
            {event.detail && (
              <p className="note" style={{ margin: '4px 0 0', lineHeight: 1.45 }}>
                {event.detail}
              </p>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
