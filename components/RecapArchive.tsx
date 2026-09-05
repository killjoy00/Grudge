import { getRecapWeeks } from '../lib/weekly-recaps.ts';

export async function RecapArchive({ season }: { season: number }) {
  const weeks = await getRecapWeeks(season);

  return (
    <>
      <h2>Weekly recaps</h2>
      <div className="card">
        {weeks.length === 0 ? (
          <p className="note" style={{ margin: 0 }}>
            {season < 2018
              ? 'Weekly recaps begin with the ESPN week-by-week archive in 2018. Earlier seasons have season totals, playoff results and championships, but not enough weekly data to reconstruct a recap faithfully.'
              : 'No weekly recap is available yet. Recaps appear here after each completed week is settled.'}
          </p>
        ) : (
          <>
            <p className="note" style={{ marginTop: 0 }}>
              The newest settled week stays on the front page. Earlier weeks remain here as the season book fills in.
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
