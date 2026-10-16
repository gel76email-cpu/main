export function mergeCommentRows(previous = [], updates = []) {
  if (!Array.isArray(previous) || !Array.isArray(updates)) throw new Error('Dati dei commenti non validi.');
  const rows = new Map();
  for (const row of [...previous, ...updates]) {
    if (!row || ['key', 'username', 'text', 'timestamp'].some((key) => typeof row[key] !== 'string') || !row.key) {
      throw new Error('Dati dei commenti non validi.');
    }
    rows.set(row.key, row);
  }
  return [...rows.values()];
}
