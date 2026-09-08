/** Apply a reviewed correction file atomically; existing IDs and ballots survive. */
import { readFileSync } from 'node:fs';
import { connect, runTransaction } from '../pipeline/db.ts';
import { correctionStatements, type TradeCorrection } from '../pipeline/trade-corrections.ts';
const file=process.argv.find(a=>a.startsWith('--file='))?.slice(7);
if(!file)throw new Error('Usage: npm run trade:correct -- --file=correction.json [--dry-run]');
const correction=JSON.parse(readFileSync(file,'utf8')) as TradeCorrection;
const statements=correctionStatements(correction);
if(process.argv.includes('--dry-run'))console.log(JSON.stringify(correction,null,2));
else {
  await runTransaction(connect(),statements);
  console.log(`Saved correction ${correction.correction_id}; run npm run models:refresh to publish its grade.`);
}
