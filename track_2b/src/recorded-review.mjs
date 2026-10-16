/** Recorded and optional live response review. No transport, credential or author-rule dependency. */
import {readFile} from 'node:fs/promises';
import {createHash, randomUUID} from 'node:crypto';
import {analyze, digest, replay, validateFields, validateSurvey} from './core.mjs';
import {reviewBehavior, authoredBehavior} from './rule-behavior.mjs';
import {ruleApplicability} from './rule-applicability.mjs';
import {inputHashes, assertV4Approval} from './review-approval.mjs';
import {assertComputationResult} from './computation-runner.mjs';
import {computationError} from './computation-settings.mjs';
import {createCurrentApprovedSpecification} from './extraction-specification-r5.mjs';
export {inputHashes} from './review-approval.mjs';
import {HISTORICAL_R5_KIND, validateHistoricalR5Source} from './historical-recording-r5.mjs';
import {prepareHistoricalR5Recheck, assembleHistoricalR5Recheck} from './historical-specification-r5.mjs';
import {currentReviewExecutionDescriptor} from './current-review-execution-v1.mjs';
import {emptyManualDraft, parseManualDraft, validateManualPrior, manualProvenance, validateManualProvenance, manualHashes, assertManualApproval, MANUAL_REVIEW_CLAIM, MANUAL_BUNDLE_CLAIM} from './manual-prior-v5.mjs';
import {parseQuoteExtraction} from './quote-extraction.mjs';
import {currentWireValidationDiagnostic} from './current-wire-diagnostics.mjs';
import {validateJudgeSource} from './judge-contract-v5.mjs';
import {validateNewInput,validateLegacyReplayInput} from './new-input.mjs';
import {validateCurrentInput} from './current-admission.mjs';
import {REVIEW_DEMO_FAMILY, REVIEW_DEMO_RECORDING} from './review-demo.mjs';
import {actorContext, selectEvidence, dispositionFromResolution, validateDispositions, finalReviewSnapshot, validateFinalSnapshot,
  coverageSummary, slotKey, V4_REVIEW_CLAIM, V4_BUNDLE_CLAIM} from './review-provenance.mjs';

export const RECORDING_IDS = ['garden-tool-shed-v3-recorded','audio-cart-v3-recorded','pottery-cart-v3-recorded'];
export const REVIEW_BODY_LIMIT = 131072;
export const REPLAY_BUNDLE_LIMIT = 1048576;
const MAX_DRAFT_BYTES = 65536;
const MAX_SESSIONS = 64, SESSION_TTL_MS = 30 * 60 * 1000;
const sha = text => createHash('sha256').update(text).digest('hex');
const copy = value => structuredClone(value);
const fail = (message, status=400) => {const error=new Error(message);error.status=status;throw error;};
const exact = (value, names) => {
  if(!value||typeof value!=='object'||Array.isArray(value))fail('Malformed review request');
  const descriptors=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(descriptors);
  if(keys.length!==names.length||keys.some(key=>typeof key!=='string'||!names.includes(key)||!descriptors[key].enumerable||!Object.hasOwn(descriptors[key],'value')))fail('Malformed review request');
};
const variantCheck = value => {if(!['clean','mutant'].includes(value))fail('Unknown variant');};
const publicFamily = ({id,title,policy,fields}) => copy({id,title,policy,fields});
export function ruleCoverage(family,rules=[]) {
  return family.fields.filter(f=>f.role==='target').flatMap(f=>['visible','required'].map(property=>({field:f.name,property,present:rules.some(r=>r.field===f.name&&r.property===property)})));
}
export async function loadRecordings({includeSynthetic=false}={}) {
  const recordings=await Promise.all(RECORDING_IDS.map(async id=>JSON.parse(await readFile(new URL(`../data/recordings/${id}.json`,import.meta.url),'utf8'))));
  return includeSynthetic?[...recordings,copy(REVIEW_DEMO_RECORDING)]:recordings;
}
function validateRecording(recording,family) {
  exact(recording,['id','familyId','rawFinalText','provenance']);
  if(recording.id===REVIEW_DEMO_RECORDING.id){
    if(digest(recording)!==digest(REVIEW_DEMO_RECORDING)||digest(publicFamily(family))!==digest(publicFamily(REVIEW_DEMO_FAMILY)))fail('Synthetic demo binding mismatch');
    return parseQuoteExtraction(recording.rawFinalText,{family});
  }
  if(!RECORDING_IDS.includes(recording.id)||recording.familyId!==family.id||typeof recording.rawFinalText!=='string'||Buffer.byteLength(recording.rawFinalText)>MAX_DRAFT_BYTES)fail('Invalid bundled recording');
  if(recording.provenance?.kind!=='recorded-live-provider-response'||recording.provenance.contractVersion!=='quote-extraction-v3'||recording.provenance.rawFinalTextSha256!==sha(recording.rawFinalText))fail('Bundled recording provenance mismatch');
  validateFields(family);
  return parseQuoteExtraction(recording.rawFinalText,{family});
}
function changes(original,current) {
  if(original.status!=='valid'||current.status!=='valid')return [];
  const entries=parsed=>(Array.isArray(parsed.rawResult?.rules)?parsed.rawResult.rules:[]).filter(r=>r&&typeof r==='object'&&typeof r.field==='string'&&typeof r.property==='string').map(r=>[`${r.field}/${r.property}`,r]);
  const before=new Map(entries(original)),after=new Map(entries(current));
  return [...new Set([...before.keys(),...after.keys()])].flatMap(target=>{
    const original=before.get(target)??null,current=after.get(target)??null;
    return digest(original)===digest(current)?[]:[{target,original,current}];
  });
}
const sourceOrigin=(source,edited=false)=>`${edited?'human-edited-':''}${source.provenance.kind==='recorded-live-provider-response'?'recorded-apertus':source.provenance.kind==='local-mock-transport'?'mock-apertus':'live-apertus'}`;
const reviewClaim='Local user attestation of interpretation and coverage; identity unverified, not independent human gold. Hashes bind inputs, not semantic correctness or authenticity.';
function assertApproval(approval,hashes) {
  if(!approval)fail('Explicit review approval required',409);
  exact(approval,['kind','approvedAt','draftRevision',...Object.keys(hashes),'reviewedInterpretation','reviewedCoverage','edited','claim','approvalHash']);
  if(!Number.isSafeInteger(approval.draftRevision)||approval.draftRevision<0||typeof approval.edited!=='boolean')fail('Invalid review record');
  if(!approval||approval.kind!=='local-user-attestation'||approval.reviewedInterpretation!==true||approval.reviewedCoverage!==true||approval.claim!==reviewClaim)fail('Explicit review approval required',409);
  const {approvalHash,...record}=approval;
  if(approvalHash!==digest(record)||Object.entries(hashes).some(([key,value])=>approval[key]!==value))fail('Stale or mismatched approval hashes',409);
  if(typeof approval.approvedAt!=='string'||!Number.isFinite(Date.parse(approval.approvedAt)))fail('Invalid approval timestamp');
}


const isManual=s=>s.kind==='independent-manual';
const isHistoricalR5=s=>s.recording?.provenance?.kind===HISTORICAL_R5_KIND;
const currentOrigin=s=>isManual(s)?'independent-authored':isHistoricalR5(s)?`${s.draftText!==s.recording.rawFinalText?'locally-reviewed-':''}historical-recorded-apertus`:`${s.draftText!==s.recording.rawFinalText?'locally-reviewed-':''}${s.recording.provenance.kind==='synthetic-omission-demonstration'?'authored-synthetic-demo':s.recording.provenance.kind==='recorded-live-provider-response'?'recorded-apertus':s.recording.provenance.kind==='local-mock-transport'?'mock-apertus':'live-apertus'}`;

/** Sessions are bounded and volatile; refreshing creates a new, unapproved draft. */
export function createReviewStore(corpus,recordings,{now=()=>Date.now(),simulation=false,computationRunner=null,historicalR5Source=null}={}) {
  if(typeof simulation!=='boolean')fail('Invalid simulation setup');
  const sources=new Map(recordings.map(recording=>{
    const family=recording.id===REVIEW_DEMO_RECORDING.id?REVIEW_DEMO_FAMILY:corpus.find(f=>f.id===recording.familyId);if(!family)fail('Recording family missing');
    const input=publicFamily(family),originalParsed=validateRecording(recording,input);
    return [recording.id,{family:input,forms:copy(family.forms),recording:copy(recording),originalParsed}];
  }));
  if(historicalR5Source){
    const source=copy(historicalR5Source),input=validateCurrentInput(source.suppliedInput?.rawInputs);
    if(digest(input)!==digest(source.suppliedInput)||digest(source.family)!==digest(input.family)||digest(source.forms)!==digest({supplied:input.survey}))fail('Historical r5 supplied source mismatch');
    source.originalParsed=validateHistoricalR5Source(source.recording,input);
    if(sources.has(source.recording.id))fail('Duplicate historical recording');
    sources.set(source.recording.id,source);
  }
  const sessions=new Map(),reservations=new Set();
  function invalidateComputation(s){
    const task=s.computationTask;s.computationTask=null;s.computation=null;
    if(task)task.job.cancel('stale').catch(()=>{});
  }
  function expireSession(id,s){if(s)invalidateComputation(s);sessions.delete(id);}
  function pruneSessions(){for(const [id,s] of sessions)if(now()-s.touchedAt>SESSION_TTL_MS)expireSession(id,s);}
  function availableSlot(){pruneSessions();if(sessions.size+reservations.size>=MAX_SESSIONS)fail('Review session limit reached; release a review in Local session capacity or wait for expiry. No live request was sent',429);}
  const provenanceFor=s=>isManual(s)?(['valid','empty'].includes(s.parsed.status)?manualProvenance(s.family,s.parsed,s.actor,s.priorExtraction,s.dispositions):null):s.originalParsed.status==='valid'&&s.parsed.status==='valid'?finalReviewSnapshot(s.family,s.originalParsed,s.parsed,s.recording,s.actor,s.dispositions):null;
  const hashesFor=s=>isManual(s)?manualHashes(s.suppliedInput,s.parsed.normalizedResult.rules,s.draftText,s.priorExtraction,provenanceFor(s)):({...inputHashes(s.family,s.survey,s.parsed.normalizedResult.rules,s.draftText,s.recording,s.suppliedInput),reviewProvenanceSha256:digest(provenanceFor(s))});
  function snapshot(s) {
    const provenance=provenanceFor(s);
    const validationDiagnostic=currentWireValidationDiagnostic(s);
    return copy({reviewVersion:isManual(s)?5:4,...(isHistoricalR5(s)?{historicalContext:{kind:'current-local-review-of-historical-r5',historicalSourceId:s.recording.id,currentReviewExecution:currentReviewExecutionDescriptor(),claim:'This is a current local review and computation. It is not an exact rerun of the historical experiment runtime or a change to historical adjudication.'}}:{}),...(isManual(s)?{kind:'independent-manual',manualProvenance:provenance,manualProvenanceSha256:provenance?digest(provenance):null,priorExtraction:s.priorExtraction}:{}),actor:s.actor,policySha256:sha(s.family.policy),dispositions:s.dispositions,
      reviewProvenance:isManual(s)?null:provenance,reviewProvenanceSha256:!isManual(s)&&provenance?digest(provenance):null,reviewCoverage:provenance?coverageSummary(provenance):null,
      sessionId:s.sessionId,revision:s.revision,state:s.state,family:s.family,variant:s.variant,survey:s.survey,recording:s.recording,
      originalParsed:s.originalParsed,draftText:s.draftText,parsed:s.parsed,...(validationDiagnostic?{validationDiagnostic}:{}),rulesSha256:s.parsed.status==='valid'?digest(s.parsed.normalizedResult.rules):null,
      coverage:ruleCoverage(s.family,s.parsed.normalizedResult?.rules),changes:isManual(s)?[]:changes(s.originalParsed,s.parsed),
      behavior:isManual(s)?(s.parsed.status==='valid'?authoredBehavior(s.family,s.parsed.normalizedResult.rules):null):provenance?reviewBehavior(s.family,s.originalParsed.normalizedResult.rules,s.parsed.normalizedResult.rules):null,
      edited:isManual(s)?s.revision>0:s.draftText!==s.recording.rawFinalText,approval:s.approval,report:s.report,...(s.computation?{computation:s.computation}:{}),
      operationalCoverage:s.report?copy(s.operationalCoverage??null):null,...(s.suppliedInput?{suppliedInput:s.suppliedInput}:{})});
  }

  function get(body,names) {
    exact(body,['sessionId','expectedRevision',...names]);
    const s=sessions.get(body.sessionId);
    if(!s||now()-s.touchedAt>SESSION_TTL_MS){expireSession(body.sessionId,s);fail('Review session expired; load the recording again',410);}
    if(body.expectedRevision!==s.revision)fail('Stale review revision; load the recording again',409);
    s.touchedAt=now();return s;
  }
  function approved(body,names=[]) {
    const s=get(body,['approvalHash',...names]);
    if(s.computation?.status==='pending')fail('A computation is already pending for this review; recover or cancel it first',409);
    if(s.parsed.status!=='valid')fail('Valid reviewed rules required',409);
    (isManual(s)?assertManualApproval:assertV4Approval)(s.approval,hashesFor(s),provenanceFor(s));
    if(body.approvalHash!==s.approval.approvalHash)fail('Stale approval hash',409);
    return s;
  }
  function finding(s,index) {
    if(!s.report||!Number.isInteger(index)||!s.report.findings[index])fail('Analyze first and select an existing finding',409);
    return s.report.findings[index];
  }
  const computationBinding=(s,operation,index)=>digest({family:s.family,survey:s.survey,rules:s.parsed.normalizedResult.rules,
    hashes:hashesFor(s),approval:s.approval,origin:currentOrigin(s),actor:s.actor,coverage:coverageSummary(provenanceFor(s)),
    ...(operation==='replay'?{finding:finding(s,index)}:{})});
  function approvedSpecification(s){
    if(!s.suppliedInput)fail('Reusable specifications require strictly validated supplied inputs',409);
      const basis={kind:isManual(s)?'independent-authored-input-v5':'reviewed-input-v4',suppliedInput:copy(s.suppliedInput),
        draftText:s.draftText,rules:copy(s.parsed.normalizedResult.rules),review:copy(s.approval),
        ...(isManual(s)?{manualProvenance:provenanceFor(s),priorRecording:copy(s.priorExtraction?.recording??null)}:
          {recording:copy(s.recording),extraction:{contractVersion:s.parsed.contractVersion,normalization:copy(s.parsed.normalization)},reviewProvenance:provenanceFor(s)})};
      return createCurrentApprovedSpecification(basis);
  }
  async function runComputation(body,operation){
    const s=approved(body,operation==='replay'?['finding']:operation==='recheck'?['formText']:[]);
    if(operation==='recheck'&&(typeof body.formText!=='string'||Buffer.byteLength(body.formText)>32768))fail('Replacement form must be text of at most 32768 UTF-8 bytes');
    if(!computationRunner)throw computationError('worker-failed');
    // A new historical source never enters the frozen live-source dispatcher.
    // It uses the unchanged fixed analysis worker; its additive artifact adapter
    // binds the result to the exact historical source and current local approval.
    const specification=operation==='recheck'?approvedSpecification(s):null;
    const historicalRecheck=operation==='recheck'&&isHistoricalR5(s)?prepareHistoricalR5Recheck(specification,body.formText):null;
    const payload=historicalRecheck?historicalRecheck.payload:operation==='recheck'?{operation:'specification-recheck',specification,formText:body.formText}
      :operation==='replay'?{operation:'replay',family:copy(s.family),survey:copy(s.survey),rules:copy(s.parsed.normalizedResult.rules),finding:copy(finding(s,body.finding))}
      :{operation:'review-analysis',family:copy(s.family),survey:copy(s.survey),rules:copy(s.parsed.normalizedResult.rules),options:{origin:currentOrigin(s),reviewStatus:s.actor.kind}};
    const binding=computationBinding(s,operation,body.finding),startingRevision=s.revision,reviewCoverage=copy(coverageSummary(provenanceFor(s))),actor=copy(s.actor);
    const job=computationRunner.start(payload); // Capacity rejection leaves the session unchanged.
    const task={job,binding,revision:startingRevision+1};
    s.computationTask=task;s.computation={kind:'bounded-review-computation',version:1,jobId:job.id,operation,status:'pending',startingRevision,
      approvalHash:s.approval.approvalHash,startedAt:new Date(now()).toISOString(),deadlineAt:new Date(now()+job.timeoutMs).toISOString(),reason:null,
      ...(operation==='replay'?{findingIndex:body.finding}:operation==='recheck'?{specificationSha256:specification.specificationSha256,replacementFormTextSha256:sha(body.formText),replacementFormText:body.formText,sourceExpiresAt:s.touchedAt+SESSION_TTL_MS}:{})};
    if(operation==='analysis'){s.report=null;s.operationalCoverage=null;}
    s.revision++;s.state=operation==='analysis'?'analyzing':operation==='recheck'?'rechecking':'replaying';
    const current=()=>sessions.get(s.sessionId)===s&&s.computationTask===task&&s.revision===task.revision;
    try{
      let result=await job.promise;
      if(!current()||now()-s.touchedAt>SESSION_TTL_MS){if(sessions.get(s.sessionId)===s&&now()-s.touchedAt>SESSION_TTL_MS)expireSession(s.sessionId,s);throw computationError('stale');}
      try{
        (isManual(s)?assertManualApproval:assertV4Approval)(s.approval,hashesFor(s),provenanceFor(s));
        if(computationBinding(s,operation,body.finding)!==binding)throw computationError('stale');
      }catch{throw computationError('stale');}
      assertComputationResult(payload,result);
      if(historicalRecheck)result={status:'complete',result:assembleHistoricalR5Recheck(specification,body.formText,result)};
      // Prepare clone and snapshot before mutating the live session. Snapshot
      // failure cannot leave a partially committed report/coverage pair.
      const next={...s,computationTask:null,revision:s.revision+1,computation:{...s.computation,status:'complete',reason:null},state:operation==='analysis'?'analyzed':operation==='recheck'?(result.status==='invalid'?'recheck-invalid':'rechecked'):'replayed'};
      if(operation==='analysis'){
        next.report={...copy(result.report),reviewCoverage,actor};next.operationalCoverage=copy(result.operationalCoverage);next.computation.executionDescriptor=copy(result.executionDescriptor);
      }else if(operation==='recheck'){
        if(result.status==='invalid'){next.computation.status='invalid';next.computation.validationError=result.error;}
        else next.computation.recheckResult=copy(result.result);
      }else next.computation.replayResult=copy(result.replay);
      const output=snapshot(next);Object.assign(s,next);
      return operation==='replay'?{snapshot:output,replay:copy(result.replay)}:output;
    }catch(error){
      if(current()){
        if(now()-s.touchedAt>SESSION_TTL_MS)expireSession(s.sessionId,s);
        else {s.computationTask=null;s.computation={...s.computation,status:'incomplete',reason:error.computationReason??'worker-failed'};s.revision++;s.state=operation==='analysis'?'analysis-incomplete':operation==='recheck'?'recheck-incomplete':'replay-incomplete';}
      }
      throw error.computationReason?error:Object.assign(computationError('worker-failed'),{cause:error});
    }
  }
  function newSession(source,variant,actor=actorContext(),reservation=null) {
    if(simulation||source.recording.provenance.kind==='local-mock-transport')actor=actorContext('agent-simulation','server-simulation');
    if(source.suppliedInput){if(variant!=='supplied')fail('Supplied input requires its exact form');}else variantCheck(variant);
    if(reservation!==null){if(!reservations.has(reservation))fail('Invalid live review reservation',409);pruneSessions();}
    else availableSlot();
    const s={...copy(source),actor:Object.freeze(copy(actor)),dispositions:[],sessionId:randomUUID(),revision:0,variant,survey:copy(source.forms[variant]),draftText:source.recording.rawFinalText,parsed:copy(source.originalParsed),approval:null,report:null,touchedAt:now()};
    delete s.forms;validateSurvey(s.family,s.survey);
    s.state=s.parsed.status==='valid'?'review-needed':s.parsed.status==='abstain'?'abstained':'invalid';
    const result=snapshot(s); // A failed snapshot must not consume a session slot.
    if(reservation!==null)reservations.delete(reservation);
    sessions.set(s.sessionId,s);return result;
  }
  return {
    // Server-internal tokens are never exposed through the HTTP action allowlist.
    // Reservations do not expire while transport is pending; its bounded finally
    // or explicit cancellation releases them, so other starts cannot steal a slot.
    lifecycle(){
      pruneSessions();const timestamp=now();
      return {serverNow:timestamp,limit:MAX_SESSIONS,used:sessions.size,reserved:reservations.size,entries:[...sessions.values()].map(s=>({
        sessionId:s.sessionId,revision:s.revision,state:s.state,expiresAt:s.touchedAt+SESSION_TTL_MS,
        remainingMs:Math.max(0,s.touchedAt+SESSION_TTL_MS-timestamp),pendingComputation:s.computation?.status==='pending'}))};
    },
    release(body){
      const s=get(body,[]);expireSession(s.sessionId,s);return {released:true,sessionId:s.sessionId};
    },
    reserveLiveSession(){availableSlot();const token=Object.freeze({});reservations.add(token);return token;},
    releaseLiveSession:token=>reservations.delete(token),
    // Server-internal only: the browser can never submit a live source or provenance.
    startLive(recording,variant,suppliedInput=null,reservation=null) {
      if(suppliedInput){
        const input=validateCurrentInput(suppliedInput.rawInputs);
        if(digest(input)!==digest(suppliedInput)||recording.familyId!==input.inputId)fail('Supplied input binding mismatch');
        const originalParsed=validateJudgeSource(recording,input.family);
        return newSession({family:input.family,forms:{supplied:input.survey},suppliedInput:input,recording:copy(recording),originalParsed},variant,actorContext(),reservation);
      }
      const family=corpus.find(f=>f.id===recording.familyId);if(!family)fail('Unknown live family');
      const input=publicFamily(family),originalParsed=validateJudgeSource(recording,input);
      return newSession({family:input,forms:copy(family.forms),recording:copy(recording),originalParsed},variant,actorContext(),reservation);
    },
    startManual(body,suppliedInput) {
      const linked=Object.hasOwn(body??{},'parentSessionId')||Object.hasOwn(body??{},'parentExpectedRevision');
      exact(body,['inputId','actorKind','humanAttestation',...(linked?['parentSessionId','parentExpectedRevision']:[])]);
      const input=validateCurrentInput(suppliedInput?.rawInputs);
      if(digest(input)!==digest(suppliedInput)||body.inputId!==input.inputId)fail('Independent authoring input mismatch');
      if(typeof body.humanAttestation!=='boolean'||body.humanAttestation!==(body.actorKind==='self-reported-human'))fail('Human attribution requires explicit self-attestation');
      let actor=actorContext(body.actorKind,'session-declaration'),priorExtraction=null;
      if(simulation&&body.actorKind==='self-reported-human')fail('An agent-simulation setup cannot become human',409);
      availableSlot();
      if(linked){
        const parent=get({sessionId:body.parentSessionId,expectedRevision:body.parentExpectedRevision},[]);
        if(isManual(parent)||!parent.suppliedInput||digest(parent.suppliedInput)!==digest(input))fail('Choose the failed extraction for these exact supplied inputs',409);
        priorExtraction=validateManualPrior(input.family,{recording:parent.recording,originalParsed:parent.originalParsed});
        if(priorExtraction.recording.provenance.kind==='local-mock-transport'&&body.actorKind==='self-reported-human')fail('Mock ancestry cannot become human',409);
      }
      if(simulation||priorExtraction?.recording.provenance.kind==='local-mock-transport')actor=actorContext('agent-simulation','server-simulation');
      const draftText=emptyManualDraft(),s={kind:'independent-manual',family:copy(input.family),survey:copy(input.survey),suppliedInput:copy(input),variant:'supplied',
        recording:null,originalParsed:null,priorExtraction:copy(priorExtraction),actor:Object.freeze(copy(actor)),dispositions:[],sessionId:randomUUID(),revision:0,
        draftText,parsed:parseManualDraft(draftText,{family:input.family}),approval:null,report:null,touchedAt:now(),state:'authoring'};
      const result=snapshot(s);sessions.set(s.sessionId,s);return result;
    },
    list:()=>[...sources.values()].map(s=>({id:s.recording.id,familyId:s.family.id,title:isHistoricalR5(s)?'Genuine Apertus r5 · sparse review and revised form':s.family.title,provenance:copy(s.recording.provenance),...(isHistoricalR5(s)?{variant:'supplied'}:{})})),
    state(body) {
      exact(body,['sessionId']);const s=sessions.get(body.sessionId);
      if(!s||now()-s.touchedAt>SESSION_TTL_MS){expireSession(body.sessionId,s);fail('Review session expired; load the recording again',410);}
      s.touchedAt=now();return snapshot(s);
    },
    start(body) {
      const declared=Object.hasOwn(body??{},'actorKind')||Object.hasOwn(body??{},'humanAttestation');
      exact(body,['recordingId','variant',...(declared?['actorKind','humanAttestation']:[])]);
      const source=sources.get(body.recordingId);if(!source)fail('Unknown recording');
      if(isHistoricalR5(source)){if(body.variant!=='supplied')fail('Historical r5 requires its exact original form');}else variantCheck(body.variant);
      let actor=actorContext();
      if(declared){
        if(typeof body.humanAttestation!=='boolean'||body.humanAttestation!==(body.actorKind==='self-reported-human'))fail('Human attribution requires explicit self-attestation');
        actor=actorContext(body.actorKind,'session-declaration');
        if(simulation&&body.actorKind==='self-reported-human')fail('An agent-simulation setup cannot become human',409);
      }
      return newSession(source,body.variant,actor);
    },
    draft(body) {
      const resolving=Object.hasOwn(body??{},'resolution');
      const s=get(body,resolving?['resolution','policySha256']:['draftText']);
      if(!isManual(s)&&s.originalParsed.status!=='valid')fail('Invalid or abstained original response is blocked; no repair or fallback is available',409);
      let draftText=body.draftText,dispositions=copy(s.dispositions);
      if(resolving){
        if(s.parsed.status!=='valid'&&!(isManual(s)&&s.parsed.status==='empty'))fail('Apply a valid draft before resolving missing slots',409);
        if(body.policySha256!==sha(s.family.policy))fail('Stale policy selection',409);
        const r=body.resolution;
        if(!r||typeof r!=='object'||!ruleCoverage(s.family,s.parsed.normalizedResult.rules).some(slot=>slot.field===r.field&&slot.property===r.property&&!slot.present))fail('Choose an unoccupied declared target/property slot',409);
        if(isHistoricalR5(s)&&r.classification==='rule')fail('The closed historical r5 journey retains its one proposed rule; explicitly dispose omitted slots without adding authored rules');
        if(r.classification==='rule'){
          exact(r,['field','property','classification','condition','selection']);
          const source=selectEvidence(s.family,r.selection),wire=copy(s.parsed.rawResult);
          wire.rules.push({field:r.field,property:r.property,condition:copy(r.condition),quote:source.quote});
          draftText=JSON.stringify(wire,null,2);dispositions=dispositions.filter(value=>slotKey(value)!==slotKey(r));
        }else{
          const disposition=dispositionFromResolution(s.family,r);
          // Current admission must be portable through the frozen artifact parser.
          // Keep historical provenance validation unchanged; never sanitize evidence.
          if(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(disposition.reason))fail('Unchecked-slot reason contains unsupported control characters. Remove them and apply the reason again; tabs and line breaks are allowed.');
          dispositions=dispositions.filter(value=>slotKey(value)!==slotKey(r));dispositions.push(disposition);draftText=s.draftText;
        }
      }
      if(typeof draftText!=='string'||Buffer.byteLength(draftText)>MAX_DRAFT_BYTES)fail('Draft must be bounded JSON text');
      if(isHistoricalR5(s)&&draftText!==s.recording.rawFinalText)fail('The closed historical r5 journey retains the exact proposed rule; use a separate new-input review for authored changes');
      const parsed=(isManual(s)?parseManualDraft:parseQuoteExtraction)(draftText,{family:s.family});
      if(resolving&&parsed.status!=='valid'&&!(isManual(s)&&parsed.status==='empty'))fail(`Resolution rejected: ${parsed.error??parsed.status}`);
      if(parsed.status==='valid'||isManual(s)&&parsed.status==='empty')dispositions=validateDispositions(s.family,parsed.rawResult.rules,dispositions.filter(value=>!parsed.rawResult.rules.some(rule=>slotKey(rule)===slotKey(value))));
      invalidateComputation(s);
      s.draftText=draftText;s.parsed=parsed;s.dispositions=dispositions;s.approval=null;s.report=null;s.operationalCoverage=null;s.revision++;
      s.state=parsed.status==='valid'?'review-needed':parsed.status==='empty'?'authoring':parsed.status==='abstain'?'abstained':'invalid';return snapshot(s);
    },
    approve(body) {
      const s=get(body,['rulesSha256','reviewedInterpretation','reviewedCoverage']);
      if((!isManual(s)&&s.originalParsed.status!=='valid')||s.parsed.status!=='valid')fail(isManual(s)?'A nonempty valid independently authored rule set is required':'Invalid or abstained output cannot be approved',409);
      if(body.reviewedInterpretation!==true||body.reviewedCoverage!==true)fail('Review interpretation and coverage explicitly',409);
      const provenance=provenanceFor(s),coverage=coverageSummary(provenance),hashes=hashesFor(s);
      if(coverage.unresolved.length)fail('Resolve every unchecked slot with a rule or explicit unsupported/ambiguous disposition',409);
      if(body.rulesSha256!==hashes.rulesSha256)fail('Stale rules hash',409);
      const record={kind:isManual(s)?'local-independent-review-v1':'local-review-v4',approvedAt:new Date(now()).toISOString(),draftRevision:s.revision,...hashes,reviewedInterpretation:true,reviewedCoverage:true,...(!isManual(s)?{edited:s.draftText!==s.recording.rawFinalText}:{}),scope:coverage.unchecked.length?'partial':'covered-slots',uncheckedSlots:coverage.unchecked,claim:isManual(s)?MANUAL_REVIEW_CLAIM:V4_REVIEW_CLAIM};
      invalidateComputation(s);
      s.approval={...record,approvalHash:digest(record)};s.report=null;s.operationalCoverage=null;s.revision++;s.state='approved';return snapshot(s);
    },
    // HTTP uses only these isolated variants. The synchronous methods below
    // retain offline/historical callers' exact result and revision behavior.
    analyzeAsync:body=>runComputation(body,'analysis'),
    replayAsync:body=>runComputation(body,'replay'),
    recheckAsync:body=>runComputation(body,'recheck'),
    ['export-recheck'](body){
      const s=approved(body,['jobId','resultSha256','formText']),c=s.computation;
      if(c?.operation!=='recheck'||c.status!=='complete'||c.jobId!==body.jobId||!c.recheckResult
        ||c.recheckResult.resultSha256!==body.resultSha256||c.recheckResult.formText!==body.formText
        ||c.approvalHash!==s.approval.approvalHash)fail('No matching current revised-form result; recheck these exact bytes first',409);
      return copy(c.recheckResult);
    },
    async ['cancel-computation'](body){
      const s=get(body,['jobId']),task=s.computationTask;
      if(!task||s.computation?.status!=='pending'||s.computation.jobId!==body.jobId)fail('No matching pending computation; recover current review state',409);
      try{await task.job.cancel('cancelled');}catch{/* Original waiter publishes the fixed incomplete status. */}
      if(sessions.get(s.sessionId)!==s||now()-s.touchedAt>SESSION_TTL_MS){expireSession(s.sessionId,s);throw computationError('stale');}
      if(s.computation?.jobId!==body.jobId)throw computationError('stale');
      return snapshot(s);
    },
    analyze(body) {
      const s=approved(body),rules=s.parsed.normalizedResult.rules;
      const report=analyze(s.family,s.survey,{rules,origin:currentOrigin(s),reviewStatus:s.actor.kind});
      const operationalCoverage=ruleApplicability(s.family,s.survey,rules,report);
      report.reviewCoverage=coverageSummary(provenanceFor(s));report.actor=copy(s.actor);
      // Publish only a complete, mutually consistent report/diagnostic pair.
      s.report=report;s.operationalCoverage=operationalCoverage;
      s.revision++;s.state='analyzed';return snapshot(s);
    },
    replay(body) {
      const s=approved(body,['finding']),result=replay(s.family,s.survey,s.parsed.normalizedResult.rules,finding(s,body.finding));
      s.revision++;s.state='replayed';return {snapshot:snapshot(s),replay:result};
    },
    ['export-specification'](body) {
      const s=approved(body);
      if(!s.suppliedInput)fail('Reusable specifications require strictly validated supplied inputs',409);
      return approvedSpecification(s);
    },
    export(body) {
      const s=approved(body,['finding']);
      if(isHistoricalR5(s))fail('Historical r5 uses its approved specification and revised-form result formats; legacy replay-case export is unsupported',409);
      if(isManual(s)){
        const bundle={version:5,mode:'independent-authored-input',familyId:s.family.id,variant:'supplied',inputs:{family:copy(s.family),survey:copy(s.survey)},
          suppliedInput:copy(s.suppliedInput),rules:copy(s.parsed.normalizedResult.rules),draftText:s.draftText,hashes:hashesFor(s),
          manualProvenance:provenanceFor(s),priorExtraction:copy(s.priorExtraction),review:copy(s.approval),finding:copy(finding(s,body.finding)),claim:MANUAL_BUNDLE_CLAIM};
        const result={...bundle,bundleSha256:digest(bundle)};
        if(Buffer.byteLength(JSON.stringify(result))>REPLAY_BUNDLE_LIMIT)fail('Replay bundle exceeds the existing byte limit',413);
        return result;
      }
      const bundle={version:4,reviewProvenance:provenanceFor(s),...(s.suppliedInput?{suppliedInput:copy(s.suppliedInput)}:{}),mode:s.suppliedInput?'reviewed-input':s.recording.provenance.kind==='synthetic-omission-demonstration'?'reviewed-synthetic':s.recording.provenance.kind==='recorded-live-provider-response'?'reviewed-recorded':'reviewed-live',familyId:s.family.id,variant:s.variant,inputs:{family:copy(s.family),survey:copy(s.survey)},rules:copy(s.parsed.normalizedResult.rules),draftText:s.draftText,hashes:hashesFor(s),recording:copy(s.recording),extraction:{contractVersion:s.parsed.contractVersion,normalization:copy(s.parsed.normalization)},review:copy(s.approval),finding:copy(finding(s,body.finding)),claim:V4_BUNDLE_CLAIM};
      const result={...bundle,bundleSha256:digest(bundle)};
      if(Buffer.byteLength(JSON.stringify(result))>REPLAY_BUNDLE_LIMIT)fail('Replay bundle exceeds the existing byte limit',413);
      return result;
    },
  };
}

/** Explicit compatibility branch only: v1 uses author references; v2 never reads them. */
export function replayBundle(corpus,bundle,recordings=[]) {
  return {...replayHistoricalBundle(corpus,bundle,recordings),verificationScope:'historical-computation',currentAdmission:'not-checked'};
}
function replayHistoricalBundle(corpus,bundle,recordings=[]) {
  if(!bundle||typeof bundle!=='object')fail('Invalid replay bundle');
  if(['profile','reviewBasis','specificationSha256','specification','computation','resultSha256'].some(key=>Object.hasOwn(bundle,key))
    ||['formrehearsal-approved-specification','formrehearsal-recheck-result'].includes(bundle.kind))fail('Specification and recheck formats cannot masquerade as legacy witnesses');
  if(bundle.version===5)return replayV5(bundle);
  if(['manualProvenance','manualProvenanceSha256','priorExtraction'].some(key=>Object.hasOwn(bundle,key))||bundle.kind==='independent-manual')fail('Independent authoring metadata cannot downgrade to a legacy version');
  if(bundle.version===4)return replayV4(corpus,bundle,recordings);
  if(Object.hasOwn(bundle,'reviewProvenance'))fail('A v4 bundle cannot downgrade to a legacy version');
  const supplied=bundle.version===3;
  let validated=null;
  if(supplied){
    exact(bundle,['version','mode','familyId','variant','inputs','suppliedInput','rules','draftText','hashes','recording','extraction','review','finding','claim','bundleSha256']);
    if(bundle.mode!=='reviewed-input'||bundle.variant!=='supplied')fail('Invalid supplied-input replay mode');
    if(bundle.claim!=='Replay against these exact locally reviewed rules only. Not proof of policy correctness or reviewer identity.')fail('Invalid supplied-input replay claim');
    validated=validateLegacyReplayInput(bundle.suppliedInput?.rawInputs);
    if(digest(validated)!==digest(bundle.suppliedInput)||bundle.familyId!==validated.inputId)fail('Replay supplied input mismatch');
  }
  const family=supplied?validated.family:corpus.find(f=>f.id===bundle.familyId);if(!family)fail('Unknown family');if(!supplied)variantCheck(bundle.variant);
  if(bundle.version===undefined||bundle.version===1) {
    // Reject disguised v2 payloads: absence of a version never permits a downgrade.
    const allowed=['version','familyId','variant','finding'];
    if(Object.keys(bundle).some(k=>!allowed.includes(k)))fail('Invalid legacy v1 bundle');
    return {...replay(family,family.forms[bundle.variant],family.intendedRules.rules,bundle.finding),domainScope:replayDomainScope(family),bundleVersion:1,ruleSource:'legacy-author-reference',claim:'Legacy fixture replay against bundled author references, pending independent human review.'};
  }
  if(!supplied&&(bundle.version!==2||!['reviewed-recorded','reviewed-live'].includes(bundle.mode)))fail('Unsupported replay bundle version');
  const {bundleSha256,...payload}=bundle;
  if(bundleSha256!==digest(payload))fail('Replay bundle hash mismatch');
  const input=publicFamily(family),survey=supplied?validated.survey:family.forms[bundle.variant];
  if(digest(bundle.inputs)!==digest({family:input,survey}))fail('Replay policy, schema or form mismatch');
  let recording,original;
  if(bundle.mode==='reviewed-recorded') {
    recording=recordings.find(r=>r.id===bundle.recording?.id);
    if(!recording||digest(recording)!==digest(bundle.recording)||recording.familyId!==family.id)fail('Replay recording provenance mismatch');
    if(recording.id===REVIEW_DEMO_RECORDING.id)fail('Synthetic demonstrations require v4 replay');
    original=validateRecording(recording,input);
  } else {
    recording=bundle.recording;original=validateJudgeSource(recording,input);
  }
  if(original.status!=='valid')fail('Invalid original response is blocked');
  if(typeof bundle.draftText!=='string'||Buffer.byteLength(bundle.draftText)>MAX_DRAFT_BYTES)fail('Invalid replay draft');
  const parsed=parseQuoteExtraction(bundle.draftText,{family:input});
  if(parsed.status!=='valid'||digest(bundle.rules)!==digest(parsed.normalizedResult.rules))fail('Replay rules differ from reviewed draft');
  if(digest(bundle.extraction)!==digest({contractVersion:parsed.contractVersion,normalization:parsed.normalization}))fail('Replay extraction provenance mismatch');
  const hashes=inputHashes(input,survey,bundle.rules,bundle.draftText,recording,validated);
  if(digest(bundle.hashes)!==digest(hashes))fail('Replay input hash mismatch');
  assertApproval(bundle.review,hashes);
  if(bundle.review.edited!==(bundle.draftText!==recording.rawFinalText))fail('Replay review edit attribution mismatch');
  return {...replay(input,survey,bundle.rules,bundle.finding),domainScope:replayDomainScope(input),bundleVersion:bundle.version,ruleSource:sourceOrigin(recording,bundle.review.edited),approvalHash:bundle.review.approvalHash,claim:'Reproduced against exact reviewed rules; not proof of policy correctness or independent human review.'};
}

function replayDomainScope(family){return {kind:'declared-finite-domains',integerDrivers:family.fields.filter(f=>f.role==='driver'&&f.kind==='integer').map(f=>f.name),claim:'Only complete answers in the declared finite domains are checked. Integer driver domains exclude fractions, even fractions accepted by SurveyJS. Replay does not admit a form for a new review or establish whole-form coverage.'};}

function replayV4(corpus,bundle,recordings) {
  const supplied=bundle.mode==='reviewed-input';
  exact(bundle,['version','mode','familyId','variant','inputs',...(supplied?['suppliedInput']:[]),'rules','draftText','hashes','recording','extraction','review','reviewProvenance','finding','claim','bundleSha256']);
  if(bundle.claim!==V4_BUNDLE_CLAIM||!['reviewed-input','reviewed-recorded','reviewed-live','reviewed-synthetic'].includes(bundle.mode))fail('Invalid v4 replay mode or claim');
  const {bundleSha256,...payload}=bundle;if(bundleSha256!==digest(payload))fail('Replay bundle hash mismatch');
  let input,validated=null,family,survey;
  if(supplied){
    if(bundle.variant!=='supplied')fail('Invalid supplied replay variant');
    validated=validateLegacyReplayInput(bundle.suppliedInput?.rawInputs);
    if(digest(validated)!==digest(bundle.suppliedInput)||bundle.familyId!==validated.inputId)fail('Replay supplied input mismatch');
    family=validated.family;survey=validated.survey;
  }else{
    variantCheck(bundle.variant);
    family=bundle.mode==='reviewed-synthetic'?REVIEW_DEMO_FAMILY:corpus.find(value=>value.id===bundle.familyId);
    if(!family||family.id!==bundle.familyId)fail('Unknown replay family');survey=family.forms[bundle.variant];
  }
  input=publicFamily(family);
  if(digest(bundle.inputs)!==digest({family:input,survey}))fail('Replay policy, schema or form mismatch');
  let recording,original;
  if(['reviewed-recorded','reviewed-synthetic'].includes(bundle.mode)){
    recording=bundle.mode==='reviewed-synthetic'?REVIEW_DEMO_RECORDING:recordings.find(value=>value.id===bundle.recording?.id);
    if(!recording||digest(recording)!==digest(bundle.recording)||recording.familyId!==family.id)fail('Replay recording provenance mismatch');
    if(bundle.mode==='reviewed-recorded'&&recording.provenance.kind!=='recorded-live-provider-response')fail('Replay source kind does not match recorded mode');
    original=validateRecording(recording,input);
  }else{recording=bundle.recording;original=validateJudgeSource(recording,input);}
  if(original.status!=='valid')fail('Invalid original response is blocked');
  if(typeof bundle.draftText!=='string'||Buffer.byteLength(bundle.draftText)>MAX_DRAFT_BYTES)fail('Invalid replay draft');
  const parsed=parseQuoteExtraction(bundle.draftText,{family:input});
  if(parsed.status!=='valid'||digest(parsed.normalizedResult.rules)!==digest(bundle.rules))fail('Replay rules differ from reviewed draft');
  if(digest(bundle.extraction)!==digest({contractVersion:parsed.contractVersion,normalization:parsed.normalization}))fail('Replay extraction provenance mismatch');
  const provenance=validateFinalSnapshot(input,original,parsed,recording,bundle.reviewProvenance);
  if(recording.provenance.kind==='local-mock-transport'&&provenance.actor.kind!=='agent-simulation')fail('Mock transport review must remain an agent simulation');
  const hashes={...inputHashes(input,survey,bundle.rules,bundle.draftText,recording,validated),reviewProvenanceSha256:digest(provenance)};
  if(digest(bundle.hashes)!==digest(hashes))fail('Replay input or provenance hash mismatch');
  assertV4Approval(bundle.review,hashes,provenance);
  if(bundle.review.edited!==(bundle.draftText!==recording.rawFinalText))fail('Replay edit attribution mismatch');
  return {...replay(input,survey,bundle.rules,bundle.finding),domainScope:replayDomainScope(input),bundleVersion:4,actor:provenance.actor,reviewCoverage:coverageSummary(provenance),
    ruleSource:currentOrigin({recording,draftText:bundle.draftText}),approvalHash:bundle.review.approvalHash,claim:V4_BUNDLE_CLAIM};
}

/** Read-only v5 replay preserves its frozen input contract; new starts use the current gate. */
function replayV5(bundle) {
  exact(bundle,['version','mode','familyId','variant','inputs','suppliedInput','rules','draftText','hashes','manualProvenance','priorExtraction','review','finding','claim','bundleSha256']);
  if(bundle.mode!=='independent-authored-input'||bundle.variant!=='supplied'||bundle.claim!==MANUAL_BUNDLE_CLAIM)fail('Invalid independent v5 mode or claim');
  const {bundleSha256,...payload}=bundle;if(bundleSha256!==digest(payload))fail('Independent replay bundle hash mismatch');
  const input=validateNewInput(bundle.suppliedInput?.rawInputs);
  if(digest(input)!==digest(bundle.suppliedInput)||bundle.familyId!==input.inputId||digest(bundle.inputs)!==digest({family:input.family,survey:input.survey}))fail('Independent replay input mismatch');
  const parsed=parseManualDraft(bundle.draftText,{family:input.family});
  if(parsed.status!=='valid'||digest(parsed.normalizedResult.rules)!==digest(bundle.rules))fail('Independent replay rules differ from the authored draft');
  const prior=validateManualPrior(input.family,bundle.priorExtraction),provenance=validateManualProvenance(input.family,parsed,prior,bundle.manualProvenance);
  const hashes=manualHashes(input,bundle.rules,bundle.draftText,prior,provenance);
  if(digest(hashes)!==digest(bundle.hashes))fail('Independent replay provenance or input hash mismatch');
  assertManualApproval(bundle.review,hashes,provenance);
  return {...replay(input.family,input.survey,bundle.rules,bundle.finding),domainScope:replayDomainScope(input.family),bundleVersion:5,
    actor:provenance.actor,reviewCoverage:coverageSummary(provenance),ruleSource:'independent-authored',
    priorExtractionStatus:prior?.originalParsed.status??null,approvalHash:bundle.review.approvalHash,claim:MANUAL_BUNDLE_CLAIM};
}
