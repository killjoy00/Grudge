/** Fixed chronological evaluation. Held-out years never train their benchmark. */
import { readFileSync, writeFileSync } from 'node:fs';
import { draftProduction, gradeDrafts, DRAFT_MODEL_VERSION, type DraftPerformanceSeason } from '../pipeline/draft-model.ts';
const seasons: DraftPerformanceSeason[] = JSON.parse(readFileSync(new URL('../data/derived/draft-performance.json', import.meta.url), 'utf8')).seasons;
const production = draftProduction(seasons);
const graded = gradeDrafts(seasons, true);
const round = (n:number)=>Math.round(n*10000)/10000;
const metrics = (predictions: { actual:number; expected:number }[]) => ({
  n:predictions.length,
  mae:round(predictions.reduce((s,p)=>s+Math.abs(p.actual-p.expected),0)/predictions.length),
  rmse:round(Math.sqrt(predictions.reduce((s,p)=>s+(p.actual-p.expected)**2,0)/predictions.length)),
});
const model=graded.map(p=>({actual:p.production_score,expected:p.draft_capital_score}));
const baseline=graded.map(p=>{
  const train=production.filter(q=>q.season<p.season);
  return {actual:p.production_score,expected:train.reduce((s,q)=>s+q.production_score,0)/train.length};
});
const report={model_version:DRAFT_MODEL_VERSION,
  target:'Regular-season production above replacement, normalized by average league starter production.',
  evaluation:'Expanding chronological holdouts; at least three prior seasons. Fixed log-pick kernel bandwidth 0.35.',
  held_out_seasons:[...new Set(graded.map(p=>p.season))],
  pick_expectation:metrics(model),constant_prior_seasons_baseline:metrics(baseline),
  position_residuals:[1,2,3,4].map(position=>{
    const picks=graded.filter(p=>p.position===position);
    return {position,n:picks.length,mean_value:round(picks.reduce((s,p)=>s+p.value_delta,0)/picks.length)};
  }),
  limits:['Historical draft return is highly variable; these are descriptive grades, not preseason projections.',
    'Published all-time grades use other completed seasons, including later ones; only this validation uses strictly prior seasons.',
    'The comparison evaluates expected return, not causal draft skill or championship prediction.'],
};
if(!Number.isFinite(report.pick_expectation.rmse))throw new Error('Invalid validation result');
writeFileSync(new URL('../data/derived/draft-model-validation.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
