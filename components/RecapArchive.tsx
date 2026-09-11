import { getRecapWeeks } from '../lib/weekly-recaps.ts';

export async function RecapArchive({ season }: { season: number }) {
  const weeks = await getRecapWeeks(season);

  return (
    <>
      <h2>Weekly recaps</h2>
      <div className="card">
        {weeks.length === 0 ? (
          <p className="note" style={{ margin: 0 }}>
            No weekly recap is available yet. Recaps appear here after each completed week is settled.
          </p>
        ) : (
          <>
            <p className="note" style={{ marginTop: 0 }}>
              The newest settled week stays on the front page. Earlier weeks remain here as the season book fills in.
              {season < 2018 && <>
                {' '}For 2005–2017, recaps use the recovered team-level scoreboards; weekly player ownership,
                starts, optimal lineups and bench decisions begin in 2018.
              </>}
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {weeks.map(({ week }, index) => (
                <a
                  key={week}
                  href={`/standings/recaps/${season}/${week}`}
                  className={`btn ${index === 0 ? '' : 'btn-quiet'}`}
                >
                  Week {week}{index === 0 ? ' · latest' : ''}
                </a>
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}
