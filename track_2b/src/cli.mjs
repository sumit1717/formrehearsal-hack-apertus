import { writeFile,mkdir } from 'node:fs/promises';
import {loadCorpus,evaluateCorpus,root} from './benchmark.mjs';
import {analyze} from './core.mjs';
import {replayBundle,loadRecordings,REPLAY_BUNDLE_LIMIT} from './recorded-review.mjs';
import {readBoundedLocalText} from './specification-io.mjs';
import {parseReplayJson} from './replay-input.mjs';
const [cmd='demo',...args]=process.argv.slice(2);
async function readReplayFile(path) {
  // Reuse the frozen regular-file boundary without changing replay semantics.
  // Check before opening, refuse final symlinks/FIFOs and decode strict UTF-8.
  return parseReplayJson(await readBoundedLocalText(path,REPLAY_BUNDLE_LIMIT));
}
try {
  if(cmd==='evaluate'){const r=await evaluateCorpus();console.log(JSON.stringify({stage:r.stage,warning:r.warning,summary:r.summary,splits:r.splits,model:r.model},null,2));if(r.summary.referenceExecutor.falseNegatives||r.summary.referenceExecutor.falsePositives||r.summary.referenceExecutor.replayed!==r.summary.referenceExecutor.witnesses)process.exitCode=1;}
  else if(cmd==='demo') {const corpus=await loadCorpus();const f=args[0]?corpus.find(f=>f.id===args[0]):corpus[0];if(!f)throw new Error('Unknown family');const variant=args[1]??'mutant';if(!['clean','mutant'].includes(variant))throw new Error('Expected clean or mutant');const r=analyze(f,f.forms[variant]);console.log(JSON.stringify(r,null,2));}
  else if(cmd==='replay'){if(!args[0])throw new Error('Provide a witness JSON path');const record=await readReplayFile(args[0]);const result=replayBundle(await loadCorpus(),record,await loadRecordings({includeSynthetic:true}));console.log(JSON.stringify(result,null,2));if(!result.reproduced)process.exitCode=1;}
  else if(cmd==='prepare-model'){const {buildExtractionRequest,buildDirectRequest}=await import('./apertus.mjs');const corpus=await loadCorpus();const f=corpus.find(f=>f.id===args[0]);if(!f)throw new Error('Unknown family');const model=args[1];const mode=args[2];if(!model||!mode)throw new Error('Usage: npm run prepare-model -- FAMILY VERIFIED_MODEL_ID ordinary|thinking (prepares only, never sends)');const out={extraction:buildExtractionRequest({family:f,model,mode}),direct:buildDirectRequest({family:f,survey:f.forms.mutant,model,mode})};await mkdir(`${root}artifacts`,{recursive:true});await writeFile(`${root}artifacts/prepared-requests.json`,JSON.stringify(out,null,2));console.log('Prepared seeded-demo requests locally; no model call made. artifacts/prepared-requests.json');}
  else throw new Error('Commands: demo [FAMILY] [clean|mutant], evaluate, replay FILE, prepare-model FAMILY MODEL MODE');
} catch(e){console.error(e.message);process.exitCode=1;}
