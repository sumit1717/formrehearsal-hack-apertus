/** Local derivative view only. Never promotes original review to replacement approval. */
import {createHash,randomUUID} from 'node:crypto';
import {open,link,unlink} from 'node:fs/promises';
import {basename,dirname,join,resolve} from 'node:path';
import {readBoundedLocalText,parseArtifactJson,RECHECK_RESULT_FILE_LIMIT} from './specification-io.mjs';
import {verifyCurrentRecheckResult,isHistoricalR5Specification} from './extraction-specification-r5.mjs';

export const HANDOFF_HTML_LIMIT=32*1024*1024;
export const VERIFICATION_COMMAND='node src/spec-cli.mjs verify-result ./RESULT_FILE.json';
export const V5_VERIFICATION_COMMAND='node src/spec-cli-v5.mjs verify-result ./RESULT_FILE.json';
export const R5_VERIFICATION_COMMAND='node src/spec-cli-r5.mjs verify-result ./RESULT_FILE.json';
const sha=text=>createHash('sha256').update(text,'utf8').digest('hex');
const escape=text=>String(text).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const json=value=>escape(JSON.stringify(value,null,2));
const code=value=>`<code>${escape(value)}</code>`;
const entry=(label,value)=>`<dt>${escape(label)}</dt><dd>${escape(value)}</dd>`;
const pre=(title,value)=>`<details><summary>${escape(title)}</summary><pre>${typeof value==='string'?escape(value):json(value)}</pre></details>`;
const fail=message=>{throw new Error(message);};
const headings=Object.freeze({
  discrepancies:'Form differs from reviewed rules',
  'no-discrepancies-covered-slots':'No discrepancy in declared covered slots',
  'no-discrepancies-partial':'No discrepancy in a partial check',
});
const style=`
:root{color-scheme:light;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#172334;background:#edf1f5}
*{box-sizing:border-box}body{margin:0;font-size:16px;line-height:1.55;overflow-wrap:anywhere}main{max-width:1080px;margin:auto;padding:32px 24px 60px}
header,section{background:white;border:1px solid #cdd6e0;border-radius:12px;padding:24px;margin:0 0 20px}header{border-top:6px solid #234b71}
h1{font-size:clamp(1.6rem,4vw,2.35rem);line-height:1.2;margin:10px 0 18px}h2{font-size:1.3rem;margin:0 0 14px}h3{font-size:1.1rem;margin:20px 0 10px}
p{margin:10px 0}small,.muted{color:#455569}.eyebrow{font-weight:700;text-transform:uppercase;letter-spacing:.08em;font-size:.78rem;color:#40536d}
.badge{display:inline-block;border:1px solid #8e9bac;border-radius:5px;padding:3px 8px;margin:0 6px 7px 0;font-weight:650;font-size:.88rem}
.warning{background:#fff7e3;border:1px solid #d7b55d;border-radius:6px;padding:14px}.metrics{display:flex;flex-wrap:wrap;gap:12px;margin:18px 0}.metric{background:#f2f5f8;padding:10px 15px;border-radius:6px;flex:1;min-width:130px}.metric strong{display:block;font-size:1.4rem}
blockquote{border-left:4px solid #607b96;padding:9px 16px;margin:12px 0;background:#f3f6f9;white-space:pre-wrap;overflow-wrap:anywhere}
code,pre{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:.86em}code{overflow-wrap:anywhere}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f3f6f9;padding:14px;border-radius:5px;max-width:100%}
.table-wrap{overflow-x:auto}table{border-collapse:collapse;width:100%;margin:12px 0}caption{text-align:left;font-weight:650;margin-bottom:6px}th,td{padding:9px 12px;border:1px solid #cdd6e0;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#f3f6f9}
dl{display:grid;grid-template-columns:minmax(140px,1fr) minmax(0,3fr);gap:7px 16px}dt{font-weight:650}dd{margin:0;overflow-wrap:anywhere}li{margin:5px 0}details{margin:12px 0;border-top:1px solid #d8dfe7;padding-top:12px}summary{cursor:pointer;font-weight:650}.finding{border-left:5px solid #a64228}.hashes dd{font-family:ui-monospace,monospace;font-size:.8rem}footer{padding:0 6px;color:#455569;font-size:.88rem}
@media(max-width:560px){main{padding:14px 10px 32px}header,section{padding:18px}dl{grid-template-columns:1fr}dd{margin-bottom:8px}th,td{padding:7px}.metric{min-width:110px}}
@media print{body{background:white;font-size:10pt}main{max-width:none;padding:0}header,section{break-inside:avoid;border-radius:0}details{display:block}details>summary{display:block}details::details-content{display:block}pre{font-size:8pt}.table-wrap{overflow:visible}}
`;

function answersTable(answers,caption){
  const entries=Object.entries(answers);
  if(!entries.length)return '<p>No driver answer is constrained. Every complete declared driver assignment reproduces this finding.</p>';
  return `<div class="table-wrap"><table><caption>${escape(caption)}</caption><thead><tr><th scope="col">Driver</th><th scope="col">Exact typed answer</th></tr></thead><tbody>${entries.map(([field,value])=>`<tr><th scope="row">${code(field)}</th><td>${code(JSON.stringify(value))}</td></tr>`).join('')}</tbody></table></div>`;
}
function findingCard(finding,index,states){
  const count=Object.keys(finding.minimalAnswers).length;
  return `<section class="finding" aria-labelledby="finding-${index}">
<h2 id="finding-${index}">${index+1}. ${escape(finding.field)} · ${escape(finding.property)}</h2>
<dl>${entry('Rule',finding.ruleId)}${entry('Expected from reviewed predicate',`${finding.property} = ${finding.expected}`)}${entry('Observed in revised form',`${finding.property} = ${finding.observed}`)}</dl>
<h3>Exact policy excerpt attached to this rule</h3><blockquote>${escape(finding.source.quote)}</blockquote>
<p class="muted">Policy offsets ${escape(finding.source.start)}–${escape(finding.source.end)} (UTF-16; end exclusive). The excerpt and predicate were locally reviewed; this tool does not establish that the predicate correctly interprets the prose.</p>
<h3>Minimum constrained answers</h3>${answersTable(finding.minimalAnswers,'Smallest sufficient driver constraint')}
<p>${count} constrained driver answer${count===1?'':'s'}; all ${escape(finding.guaranteedCompletions)} complete declared completion${finding.guaranteedCompletions===1?'':'s'} matching these constraints reproduce this exact expected/observed direction. ${escape(finding.violatingStates)} of ${escape(states)} declared complete states have this direction. Counts from different findings can overlap.</p>
<p class="muted">Minimum means fewest constrained drivers under this finite profile. Other equally small constraints may exist. Unconstrained drivers still need in-domain answers for execution.</p>
<h3>One complete reproduction</h3><p>Start a fresh SurveyJS 3.1.2 form using the exact replacement form in the appendix. Set every driver in this order, leave target answers unset, then inspect ${code(finding.field)}.${code(finding.property)}.</p>
<ol>${finding.steps.map(step=>`<li>Set ${code(step.field)} to ${code(JSON.stringify(step.value))}.</li>`).join('')}</ol>
${answersTable(finding.answers,'Complete driver assignment')}
${pre('Reviewed predicate',finding.condition)}
${pre('Observed target flags for this reproduction',Object.fromEntries(Object.entries(finding.states).map(([field,state])=>[field,{visible:state.visible,required:state.required}])))}
${pre('Exact finding certificate',finding.certificate)}
</section>`;
}

/** Text-only external boundary: strict bounded parse and full recomputation precede rendering. */
export function renderRecheckHandoff(raw,{resultFilename='RESULT_FILE.json'}={}){
  if(typeof resultFilename!=='string'||Buffer.byteLength(resultFilename)>4096)fail('Invalid result filename');
  const result=parseArtifactJson(raw,{limit:RECHECK_RESULT_FILE_LIMIT});
  // The shared verifier also accepts historical v1; this view deliberately does not.
  if(result?.kind!=='formrehearsal-recheck-result'||result.version!==2)fail('Readable handoff requires current recheck-result version 2');
  const verified=verifyCurrentRecheckResult(result);
  const {specification:spec,computation:c}=result,basis=spec.reviewBasis,input=basis.suppliedInput;
  const provenance=basis.manualProvenance??basis.reviewProvenance,actor=provenance.actor;
  // The complete closed-profile verifier above runs before this display-only dispatch.
  const historicalR5=isHistoricalR5Specification(spec);
  const title=headings[c.status];if(!title)fail('Unsupported recheck status');
  const cssHash=createHash('sha256').update(style).digest('base64');
  const hashes={
    'Authoritative JSON exact UTF-8 file SHA-256':sha(raw),
    'Result content digest (resultSha256)':result.resultSha256,
    'Embedded specification digest':spec.specificationSha256,
    'Original declared approval hash':basis.review.approvalHash,
    'Reviewed rules digest':c.rulesSha256,
    'Policy exact text SHA-256':input.hashes.policyTextSha256,
    'Driver declaration exact text SHA-256':input.hashes.driverTextSha256,
    'Original form exact text SHA-256':input.hashes.formTextSha256,
    'Replacement form exact text SHA-256':c.hashes.formTextSha256,
    'Original form parsed-content digest':input.hashes.formSha256,
    'Replacement form parsed-content digest':c.hashes.formSha256,
    'Original input ID':c.originalInputId,
    'Replacement input ID':c.inputId,
  };
  const html=`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'sha256-${cssHash}'; base-uri 'none'; form-action 'none'; object-src 'none'">
<meta name="referrer" content="no-referrer"><title>${escape(title)} · FormRehearsal</title><style>${style}</style></head>
<body><main><header>
<div class="eyebrow">FormRehearsal · local recheck handoff</div><h1>${escape(title)}</h1>
<span class="badge">${escape(actor.kind)}</span><span class="badge">Replacement: not-user-attested</span>
<p>${escape(input.family.title)}</p><p>${escape(c.claim)}</p>
<div class="metrics"><div class="metric"><strong>${c.findings.length}</strong>discrepancy groups</div><div class="metric"><strong>${c.statesChecked}</strong>complete declared states</div><div class="metric"><strong>${c.coverage.present}</strong>declared covered slots</div><div class="metric"><strong>${c.coverage.unchecked.length}</strong>unchecked slots</div></div>
<p>Artifact validation and full local recomputation succeeded before this HTML was created. This is a readable derivative of ${code(resultFilename)}; the unchanged JSON is authoritative.</p>
<p class="warning">${escape(actor.claim)} Original approval belongs to the original form. It does not approve the revised form. Hashes and local recomputation do not authenticate a reviewer or establish policy truth.</p>
</header>
<section aria-labelledby="scope"><h2 id="scope">What was checked</h2>
<div class="table-wrap"><table><caption>Declared complete driver domains</caption><thead><tr><th scope="col">Driver</th><th scope="col">Every in-domain value</th></tr></thead><tbody>${input.family.fields.filter(field=>field.role==='driver').map(field=>`<tr><th scope="row">${code(field.name)}</th><td>${code(JSON.stringify(field.kind==='boolean'?[false,true]:field.values))}</td></tr>`).join('')}</tbody></table></div><ul>
<li>Exact expected/observed Boolean equality for the reviewed visibility and requiredness predicates over every complete in-domain driver assignment.</li>
<li>Requiredness is compared only when the target is actually visible. Hidden-target requiredness is skipped.</li>
<li>Missing or partial driver answers, target-answer combinations, transitions and successful submission are outside this check.</li>
<li>Unchecked slots remain unknown. A clean result is not whole-form correctness or policy compliance.</li>
</ul><p class="muted">Per-rule skipped-comparison and applicability counts are not serialized in this portable result. No such counts, or zero-applicability conclusions, are inferred here.</p>
<dl>${entry('Current result status',c.status)}${entry('Analysis exit code',c.analysisExitCode)}${entry('Verification scope',verified.verificationScope)}${entry('Replacement admission',verified.currentAdmission)}${entry('Original admission',verified.originalAdmission)}${entry('Native engine',`${c.profile.engine.name} ${c.profile.engine.version}`)}</dl></section>
${c.findings.length?c.findings.map((finding,index)=>findingCard(finding,index,c.statesChecked)).join('\n'):'<section><h2>No discrepancy found within this scope</h2><p>There is no counterexample to reproduce for the declared covered slots. Consult the scope and unchecked slots before using this result.</p></section>'}
<section aria-labelledby="unchecked"><h2 id="unchecked">Unchecked slots</h2>
${c.coverage.unchecked.length?`<p>These ${c.coverage.unchecked.length} slots were explicitly left unchecked in the original review; they have not passed this recheck.</p><ul>${provenance.dispositions.map(slot=>`<li>${code(`${slot.field}/${slot.property}`)}: ${escape(slot.kind)} (${escape(slot.reasonCode)}). ${escape(slot.reason)}${slot.evidence?`<blockquote>${escape(input.rawInputs.policyText.slice(slot.evidence.start,slot.evidence.end))}</blockquote>`:''}</li>`).join('')}</ul>`:'<p>No declared target slot was left unchecked. Hidden-requiredness and the other exclusions above still apply.</p>'}</section>
<section aria-labelledby="approval"><h2 id="approval">Original approval and replacement status</h2>
<dl>${entry('Original review basis',basis.kind)}${entry('Original approval kind',basis.review.kind)}${entry('Declared approval time (not authenticated)',basis.review.approvedAt)}${entry('Original approval scope',basis.review.scope)}${entry('Actor declaration',actor.kind)}${entry('Actor identity verified',actor.identityVerified)}${entry('Replacement attestation',c.attestation)}</dl>
<p>${escape(basis.review.claim)}</p><p>${escape(actor.claim)}</p>
${basis.priorRecording?'<p>Prior extraction evidence is retained unchanged in the JSON. Independent authorship and this recheck do not turn a failed or abstained extraction into a success.</p>':''}
${basis.recording?`<p>Original extraction source declaration: ${code(basis.recording.provenance.kind)}. This handoff makes no new model call.</p>`:''}
${historicalR5?`<h3>Historical capture and current local review are separate</h3><p>The retained Apertus response belongs to the historical original input. This brief makes no new provider call. The historical original already agrees with its single reviewed visibility rule; three omitted slots remain unchecked. A later seeded revision is newly authored, not a historical model input.</p><p class="warning">${escape(basis.recording.provenance.claim)} ${escape(basis.recording.provenance.historicalComparison)}</p>${pre('Exact historical capture provenance',basis.recording.provenance)}`:''}${pre('Original approval record',basis.review)}${pre('Original final-review provenance and unchecked dispositions',provenance)}</section>
<section aria-labelledby="verification"><h2 id="verification">Verify the authoritative JSON</h2>
<p>From the matching release’s ${code('track_2b/')} directory with its locked dependencies installed, run:</p><pre>${escape(historicalR5?R5_VERIFICATION_COMMAND:spec.profile.kind==='strict-sparse-extraction-v5-predicates-v1'?V5_VERIFICATION_COMMAND:VERIFICATION_COMMAND)}</pre>
<p>Replace the fixed ${code('./RESULT_FILE.json')} placeholder with your local JSON path, using your shell’s safe path quoting. The command above never interpolates artifact content or the displayed filename. Prefer a simple local filename prefixed with ${code('./')}.</p>
<p>The verifier checks the whole artifact and recomputes the bounded result, including zero-finding results. Its successful exit code is 0; the JSON summary separately reports analysis code 1 for discrepancies or 3 for a partial clean check.</p>
<p>HTML itself is editable and is not a signed verification receipt. Verify the JSON again in the matching implementation before relying on it; a newly selected, coherently regenerated artifact does not prove continuity with a previously trusted review.</p>
<dl class="hashes">${Object.entries(hashes).map(([label,value])=>entry(label,value)).join('')}</dl>
${pre('All original input hashes',input.hashes)}${pre('All replacement input hashes',c.hashes)}${pre('Current admission profile and implementation hashes',result.currentProfile)}${pre('Frozen computation profile and implementation hashes',c.profile)}</section>
<section aria-labelledby="appendix"><h2 id="appendix">Exact source appendix</h2><p>The policy, form JSON and driver text below are displayed as inert text. No source links are activated, fetched or executed. Browser display or copying may normalize line endings; extract from the unchanged JSON when exact bytes matter.</p>
${pre('Original policy text',input.rawInputs.policyText)}${pre('Original driver declaration',input.rawInputs.driverText)}${pre('Declared finite field schema',input.family.fields)}${pre('Original form JSON text',input.rawInputs.formText)}${pre('Replacement form JSON text for reproduction',result.formText)}${pre('All reviewed normalized predicates',basis.rules)}</section>
<footer>Local-only derivative. Contains policy, form and review details; review the contents before sharing. No provider call, inference, fix, new approval or artifact migration is performed.</footer>
</main></body></html>\n`;
  if(Buffer.byteLength(html)>HANDOFF_HTML_LIMIT)fail('Readable handoff exceeds its output byte limit');
  return {html,verification:verified,resultFileSha256:sha(raw)};
}

/** Create an exclusive sibling, publishing only a fully written HTML file. Never overwrite. */
export async function writeRecheckHandoff(resultPath){
  const raw=await readBoundedLocalText(resultPath,RECHECK_RESULT_FILE_LIMIT);
  const rendered=renderRecheckHandoff(raw,{resultFilename:basename(resultPath)});
  const outputPath=`${resolve(resultPath)}.html`;
  const temporary=join(dirname(outputPath),`.formrehearsal-handoff-${randomUUID()}.tmp`);
  let file,created=false;
  try{
    file=await open(temporary,'wx',0o600);created=true;
    await file.writeFile(rendered.html,'utf8');await file.sync();await file.close();file=null;
    // link is atomic and fails if the destination already exists, including a symlink.
    await link(temporary,outputPath);
  }catch(error){
    if(error?.code==='EEXIST')fail('Handoff output already exists; choose a fresh JSON filename or move the previous HTML');
    fail('Unable to create the local handoff HTML');
  }finally{
    await file?.close();
    if(created)await unlink(temporary);
  }
  return {outputPath,...rendered.verification,resultFileSha256:rendered.resultFileSha256};
}
