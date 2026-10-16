import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {analyze,replay,digest} from './core.mjs';
export const root=fileURLToPath(new URL('../',import.meta.url));
export async function loadCorpus(){return JSON.parse(await readFile(`${root}data/fixtures/corpus.json`,'utf8'));}
export async function evaluateCorpus(){
  const corpus=await loadCorpus(),cases=[];
  for(const family of corpus)for(const variant of ['clean','mutant']){
    const report=analyze(family,family.forms[variant]);
    const replayed=report.findings.map(f=>replay(family,family.forms[variant],family.intendedRules.rules,f).reproduced);
    cases.push({id:`${family.id}/${variant}`,familyId:family.id,split:family.split,variant,expectedDefect:variant==='mutant',nativeFlag:report.native.errorCount+report.native.warningCount>0,semanticFlag:report.findings.length>0,replays:replayed,report});
  }
  const slice=list=>({cases:list.length,clean:list.filter(x=>!x.expectedDefect).length,defective:list.filter(x=>x.expectedDefect).length,native:{truePositives:list.filter(x=>x.expectedDefect&&x.nativeFlag).length,falsePositives:list.filter(x=>!x.expectedDefect&&x.nativeFlag).length},referenceExecutor:{truePositives:list.filter(x=>x.expectedDefect&&x.semanticFlag).length,falsePositives:list.filter(x=>!x.expectedDefect&&x.semanticFlag).length,falseNegatives:list.filter(x=>x.expectedDefect&&!x.semanticFlag).length,witnesses:list.reduce((a,x)=>a+x.replays.length,0),replayed:list.reduce((a,x)=>a+x.replays.filter(Boolean).length,0),statesChecked:list.reduce((a,x)=>a+x.report.statesChecked,0)}});
  const report={version:1,generatedAt:new Date().toISOString(),corpusSha256:digest(corpus),stage:'offline-fixture-engineering-test',warning:'Synthetic author-reference rules, pending independent human review. This is not Apertus accuracy and not a blind held-out model evaluation.',model:{status:'not-run',extractionAccuracy:null,directPromptAccuracy:null,tokens:null,latencyMs:null,cost:null},humanReview:{status:'pending',reviewerTime:null},scope:'Single-page forms, finite complete driver assignments, two dependent targets; no dynamic navigation or live submissions.',summary:slice(cases),splits:{dev:slice(cases.filter(x=>x.split==='dev')),holdout:slice(cases.filter(x=>x.split==='holdout'))},cases};
  await mkdir(`${root}artifacts`,{recursive:true});await writeFile(`${root}artifacts/engineering-results.json`,JSON.stringify(report,null,2)+'\n');return report;
}
