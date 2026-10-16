#!/usr/bin/env node
/** Offline synthetic rehearsal; never extraction or authenticated human review. */
import assert from 'node:assert/strict';
import {readFile,mkdir,readdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {validateCurrentInput} from '../../src/current-admission.mjs';
import {createReviewStore,replayBundle} from '../../src/recorded-review.mjs';
import {createComputationRunner} from '../../src/computation-runner.mjs';
import {verifyCurrentRecheckResult} from '../../src/current-specification.mjs';

const revision=s=>({sessionId:s.sessionId,expectedRevision:s.revision});
const permit=s=>({...revision(s),approvalHash:s.approval.approvalHash});
const json=value=>JSON.stringify(value,null,2)+'\n';
const sha=text=>createHash('sha256').update(text).digest('hex');
export async function readExample(){
  const read=name=>readFile(new URL(name,import.meta.url),'utf8');
  const [policyText,driverText,formText,correctedFormText,draftText,provenance]=await Promise.all(
    ['policy.txt','drivers.txt','form-defective.json','form-corrected.json','manual-rules.json','provenance.json'].map(read));
  return {rawInput:{policyText,driverText,formText},correctedFormText,draftText,provenance:JSON.parse(provenance)};
}

export async function buildArtifacts(){
  const example=await readExample(),input=validateCurrentInput(example.rawInput);
  const runner=createComputationRunner();
  // Deliberate fixed simulation clock: not a real review timestamp.
  const reviews=createReviewStore([],[],{simulation:true,now:()=>Date.UTC(2026,9,10),computationRunner:runner});
  try{
    let s=reviews.startManual({inputId:input.inputId,actorKind:'agent-simulation',humanAttestation:false},input);
    s=reviews.draft({...revision(s),draftText:example.draftText});
    assert.equal(s.parsed.status,'valid');
    assert.deepEqual(s.reviewCoverage,{present:8,unchecked:[],unresolved:[]});
    s=reviews.approve({...revision(s),rulesSha256:s.rulesSha256,reviewedInterpretation:true,reviewedCoverage:true});
    const specification=reviews['export-specification'](permit(s));
    assert.equal(specification.version,2);
    assert.equal(specification.reviewBasis.manualProvenance.actor.kind,'agent-simulation');
    assert.equal(specification.reviewBasis.priorRecording,null);
    s=await reviews.analyzeAsync(permit(s));
    assert.equal(s.report.statesChecked,2);assert.equal(s.report.findings.length,2);
    assert.deepEqual(s.report.findings.map(f=>({answers:f.minimalAnswers,expected:f.expected,observed:f.observed})),[
      {answers:{delivery:false},expected:false,observed:true},
      {answers:{delivery:true},expected:true,observed:false},
    ]);
    assert.equal(s.report.provenance.modelInference,'not-run');
    assert.deepEqual(reviews['export-specification'](permit(s)),specification);
    // Durations are operational measurements, excluded from deterministic files.
    const {durationMs,...originalReport}=s.report;
    const artifacts={'approved-specification.json':specification,'original-analysis.json':originalReport};
    const replays=[];
    for(let index=0;index<s.report.findings.length;index++){
      const replayed=await reviews.replayAsync({...permit(s),finding:index});s=replayed.snapshot;
      assert.equal(replayed.replay.reproduced,true);
      const witness=reviews.export({...permit(s),finding:index});
      assert.equal(witness.version,5);assert.equal(witness.manualProvenance.actor.kind,'agent-simulation');
      const verification=replayBundle([],witness,[]);assert.equal(verification.reproduced,true);
      artifacts[`witness-${index+1}.json`]=witness;
      artifacts[`witness-${index+1}-verification.json`]=verification;
      replays.push({answers:witness.finding.minimalAnswers,reproduced:verification.reproduced});
    }
    const originalApproval=structuredClone(s.approval);
    s=await reviews.recheckAsync({...permit(s),formText:example.correctedFormText});
    assert.equal(s.computation.status,'complete');
    const candidate=s.computation.recheckResult;
    const result=reviews['export-recheck']({...permit(s),jobId:s.computation.jobId,
      resultSha256:candidate.resultSha256,formText:example.correctedFormText});
    assert.equal(result.version,2);assert.equal(result.computation.analysisExitCode,0);
    assert.equal(result.computation.statesChecked,2);assert.deepEqual(result.computation.findings,[]);
    assert.equal(result.computation.coverage.present,8);assert.deepEqual(result.computation.coverage.unchecked,[]);
    assert.equal(result.computation.attestation,'not-user-attested');
    assert.deepEqual(s.approval,originalApproval);
    assert.equal(result.specification.reviewBasis.suppliedInput.rawInputs.formText,example.rawInput.formText);
    assert.notEqual(result.computation.inputId,input.inputId);
    const verification=verifyCurrentRecheckResult(result);assert.equal(verification.verified,true);
    artifacts['revised-form-result.json']=result;artifacts['revised-form-verification.json']=verification;
    artifacts['summary.json']={kind:'synthetic-delivery-software-rehearsal',version:1,
      actor:'agent-simulation',modelInference:'not-run',browserExecution:'not-run-by-this-script',humanReviewPerformed:false,
      original:{statesChecked:2,discrepancies:2,coveredSlots:8,uncheckedSlots:0,inputId:input.inputId},
      replays,revised:{statesChecked:2,discrepancies:0,coveredSlots:8,uncheckedSlots:0,
        analysisExitCode:0,attestation:'not-user-attested',inputId:result.computation.inputId,verified:verification.verified},
      provenance:example.provenance,
      claim:'Local isolated-worker and full verifier reproduction against agent-authored predicates. No model-quality, human-review, browser, usability, whole-form correctness or video claim.'};
    return artifacts;
  }finally{await runner.close();}
}

export async function writeArtifacts(directory,artifacts){
  await mkdir(directory,{recursive:true});
  if((await readdir(directory)).length)throw new Error('Choose an empty or new output directory; existing files will not be overwritten');
  const manifest=[];
  for(const [name,value]of Object.entries(artifacts)){
    const text=json(value);await writeFile(resolve(directory,name),text,{flag:'wx'});
    manifest.push({path:name,bytes:Buffer.byteLength(text),sha256:sha(text)});
  }
  await writeFile(resolve(directory,'SHA256SUMS.json'),json(manifest),{flag:'wx'});
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  try{
    if(process.argv.length!==3||process.argv[2].startsWith('-'))throw new Error('Usage: node examples/delivery-review/reproduce.mjs OUTPUT_DIRECTORY');
    const directory=resolve(process.argv[2]),artifacts=await buildArtifacts();
    await writeArtifacts(directory,artifacts);
    console.log(json({outputDirectory:directory,...artifacts['summary.json']}));
  }catch(error){console.error(`Delivery rehearsal failed: ${error.message}`);process.exitCode=1;}
}
