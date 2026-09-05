export function mergeTransactions(payloads) {
  const byId = new Map();

  for (const payload of payloads) {
    const transactions = payload?.transactions ?? [];
    for (const transaction of transactions) {
      if (!transaction || transaction.id === undefined || transaction.id === null) continue;
      byId.set(String(transaction.id), transaction);
    }
  }

  return [...byId.values()].sort((a, b) => {
    const weekA = Number(a.scoringPeriodId ?? 0);
    const weekB = Number(b.scoringPeriodId ?? 0);
    if (weekA !== weekB) return weekA - weekB;

    const dateA = Number(a.proposedDate ?? a.processDate ?? a.date ?? 0);
    const dateB = Number(b.proposedDate ?? b.processDate ?? b.date ?? 0);
    if (dateA !== dateB) return dateA - dateB;

    return String(a.id).localeCompare(String(b.id));
  });
}
