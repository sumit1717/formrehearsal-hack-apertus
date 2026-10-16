import {fork} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {digest,domain} from './core.mjs';
import {parseFormJson} from './new-input.mjs';
import {coverageSummary} from './review-provenance.mjs';
import {SPECIFICATION_FILE_LIMIT,RECHECK_RESULT_FILE_LIMIT} from './specification-io.mjs';
import {currentReviewExecutionDescriptor} from './current-review-execution-v1.mjs';
import {COMPUTATION_DEADLINE_MS,COMPUTATION_INPUT_BYTES,COMPUTATION_OUTPUT_BYTES,COMPUTATION_EXEC_ARGV,COMPUTATION_OPERATIONS,computationError} from './computation-settings.mjs';

const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const exact=(value,keys)=>object(value)&&Object.keys(value).sort().join('\0')===[...keys].sort().join('\0');
const check=value=>{if(!value)throw computationError('invalid-result');};
const integer=(value,min,max)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
const copy=value=>JSON.parse(JSON.stringify(value));

function assertFindings({family,survey,rules,findings}){
  const drivers=family.fields.filter(f=>f.role==='driver'),targets=family.fields.filter(f=>f.role==='target');
  const count=drivers.reduce((n,f)=>n*domain(f).length,1),surveyHash=digest(survey),rulesHash=digest(rules);
  const states=value=>object(value)&&Object.keys(value).length===targets.length&&targets.every(f=>exact(value[f.name],['visible','required','emptyValueValid'])&&typeof value[f.name].visible==='boolean'&&typeof value[f.name].required==='boolean'&&(value[f.name].emptyValueValid===null||typeof value[f.name].emptyValueValid==='boolean'));
  const steps=value=>Array.isArray(value)&&value.length===drivers.length&&drivers.every((f,i)=>exact(value[i],['field','value'])&&value[i].field===f.name&&domain(f).includes(value[i].value));
  check(Array.isArray(findings)&&findings.length<=rules.length*2);
    const totals=new Map(rules.map(rule=>[rule.id,0])),seen=new Set();
    for(const finding of findings){
      const rule=rules.find(rule=>rule.id===finding?.ruleId),signature=`${finding?.ruleId}/${finding?.expected}`;
      check(rule&&!seen.has(signature));seen.add(signature);
      check(exact(finding,['ruleId','field','property','expected','observed','source','condition','minimalAnswers','guaranteedCompletions','answers','states','steps','violatingStates','certificate'])
        &&['field','property','source','condition'].every(k=>digest(finding[k])===digest(rule[k]))
        &&typeof finding.expected==='boolean'&&typeof finding.observed==='boolean'&&finding.expected!==finding.observed
        &&integer(finding.violatingStates,1,count)&&integer(finding.guaranteedCompletions,1,count)&&steps(finding.steps)&&states(finding.states)
        &&object(finding.answers)&&Object.keys(finding.answers).length===drivers.length&&drivers.every(f=>domain(f).includes(finding.answers[f.name]))
        &&object(finding.minimalAnswers)&&Object.entries(finding.minimalAnswers).every(([name,value])=>drivers.some(f=>f.name===name)&&finding.answers[name]===value)
        &&drivers.every((field,i)=>finding.steps[i].value===finding.answers[field.name])
        &&finding.guaranteedCompletions<=finding.violatingStates&&finding.guaranteedCompletions===drivers.filter(field=>!Object.hasOwn(finding.minimalAnswers,field.name)).reduce((n,field)=>n*domain(field).length,1)
        &&finding.states[finding.field]?.[finding.property]===finding.observed&&(finding.property!=='required'||finding.states[finding.field].visible)
        &&exact(finding.certificate,['familyId','familySha256','surveySha256','rulesSha256','answers'])&&finding.certificate.familyId===family.id
        &&finding.certificate.familySha256===digest({id:family.id,policy:family.policy,fields:family.fields})&&finding.certificate.surveySha256===surveyHash&&finding.certificate.rulesSha256===rulesHash&&digest(finding.certificate.answers)===digest(finding.answers));
      totals.set(rule.id,totals.get(rule.id)+finding.violatingStates);check(totals.get(rule.id)<=count);
    }
  return totals;
}

/** Checks transport completeness/bindings. The fixed trusted checker remains
 * the semantic authority; this is not a second prover or a replay format. */
export function assertComputationResult(payload,result){
  try{
    if(payload.operation==='specification-recheck'){assertRecheckTransport(payload,result);return;}
    const {family,survey,operation}=payload,rules=operation==='reference-analysis'?family.intendedRules?.rules:payload.rules;
    const drivers=family.fields.filter(f=>f.role==='driver'),targets=family.fields.filter(f=>f.role==='target');
    const count=drivers.reduce((n,f)=>n*domain(f).length,1),surveyHash=digest(survey),rulesHash=digest(rules);
    const states=value=>object(value)&&Object.keys(value).length===targets.length&&targets.every(f=>exact(value[f.name],['visible','required','emptyValueValid'])&&typeof value[f.name].visible==='boolean'&&typeof value[f.name].required==='boolean'&&(value[f.name].emptyValueValid===null||typeof value[f.name].emptyValueValid==='boolean'));
    const steps=value=>Array.isArray(value)&&value.length===drivers.length&&drivers.every((f,i)=>exact(value[i],['field','value'])&&value[i].field===f.name&&domain(f).includes(value[i].value));
    check(Buffer.byteLength(JSON.stringify(result))<=COMPUTATION_OUTPUT_BYTES);
    if(operation==='replay'){
      check(exact(result,['replay'])&&exact(result.replay,['reproduced','steps','states'])&&typeof result.replay.reproduced==='boolean'&&steps(result.replay.steps)&&states(result.replay.states)
        &&digest(result.replay.steps)===digest(payload.finding.steps)&&(!result.replay.reproduced||digest(result.replay.states)===digest(payload.finding.states)));return;
    }
    check(exact(result,operation==='review-analysis'?['report','operationalCoverage','executionDescriptor']:['report']));
    const report=result.report;
    check(exact(report,['familyId','provenance','engine','native','statesChecked','findings','durationMs','surveySha256','rulesSha256'])
      &&report.familyId===family.id&&report.surveySha256===surveyHash&&report.rulesSha256===rulesHash&&report.statesChecked===count
      &&exact(report.engine,['name','version'])&&report.engine.name==='survey-core'&&report.engine.version==='3.1.2'
      &&Number.isFinite(report.durationMs)&&report.durationMs>=0&&object(report.native)&&Array.isArray(report.findings)&&report.findings.length<=rules.length*2);
    const native=report.native;
    check(exact(native,['findings','errorCount','warningCount','infoCount','suppressedCount'])&&Array.isArray(native.findings)&&native.suppressedCount===0
      &&['errorCount','warningCount','infoCount'].every(k=>integer(native[k],0,100_000))
      &&native.findings.every(row=>object(row)&&['ruleId','message','path'].every(k=>typeof row[k]==='string')&&object(row.messageData)&&['error','warning','info'].includes(row.severity))
      &&['error','warning','info'].every(severity=>native[severity+'Count']===native.findings.filter(row=>row.severity===severity).length));
    const options=payload.options??family.intendedRules??{};
    check(exact(report.provenance,['origin','reviewStatus','modelInference','claim'])&&report.provenance.origin===(options.origin??'unverified')
      &&report.provenance.reviewStatus===(options.reviewStatus??'pending-human-review')&&report.provenance.modelInference==='not-run'
      &&report.provenance.claim==='Finite execution against supplied rules; not evidence of prose interpretation accuracy.');
    const totals=assertFindings({family,survey,rules,findings:report.findings});
    if(operation==='reference-analysis')return;
    check(digest(result.executionDescriptor)===digest(currentReviewExecutionDescriptor()));
    const coverage=result.operationalCoverage;
    check(exact(coverage,['kind','version','familyId','familySha256','surveySha256','rulesSha256','engine','totalStates','rules','uncheckedSlots','domainScope','claim'])
      &&coverage.kind==='finite-rule-applicability'&&coverage.version===1&&coverage.familyId===family.id&&coverage.familySha256===digest({id:family.id,policy:family.policy,fields:family.fields})
      &&coverage.surveySha256===surveyHash&&coverage.rulesSha256===rulesHash&&digest(coverage.engine)===digest(report.engine)&&coverage.totalStates===count
      &&Array.isArray(coverage.rules)&&coverage.rules.length===rules.length&&Array.isArray(coverage.uncheckedSlots)&&object(coverage.domainScope)&&typeof coverage.claim==='string');
    const unchecked=targets.flatMap(field=>['visible','required'].filter(property=>!rules.some(rule=>rule.field===field.name&&rule.property===property)).map(property=>({field:field.name,property})));
    check(digest(coverage.uncheckedSlots)===digest(unchecked)&&digest(coverage.domainScope)===digest({kind:'declared-finite-domains',integerDrivers:drivers.filter(field=>field.kind==='integer').map(field=>field.name),
      claim:'Only complete answers in the declared finite driver domains are counted. Declared integer domains exclude fractions. Missing, null, out-of-domain and target-answer combinations are not covered.'})
      &&coverage.claim==='Counts describe predicate truth and comparisons actually made. Requiredness is compared only while the form actually shows the target. A never-true predicate can be intentional; these counts do not establish policy truth or whole-form correctness.');
    coverage.rules.forEach((row,i)=>{
      const rule=rules[i];check(exact(row,['ruleId','field','property','totalStates','conditionTrueStates','comparedStates','skippedHiddenStates','conditionTrueComparedStates','mismatchStates'])
        &&row.ruleId===rule.id&&row.field===rule.field&&row.property===rule.property&&row.totalStates===count
        &&['conditionTrueStates','comparedStates','skippedHiddenStates','conditionTrueComparedStates','mismatchStates'].every(k=>integer(row[k],0,count))
        &&row.comparedStates+row.skippedHiddenStates===count&&row.conditionTrueComparedStates<=row.comparedStates&&row.conditionTrueComparedStates<=row.conditionTrueStates
        &&row.conditionTrueStates-row.conditionTrueComparedStates<=row.skippedHiddenStates
        &&(row.property!=='visible'||row.comparedStates===count&&row.skippedHiddenStates===0&&row.conditionTrueComparedStates===row.conditionTrueStates)
        &&row.mismatchStates<=row.comparedStates&&row.mismatchStates===totals.get(rule.id));
    });
  }catch{throw computationError('invalid-result');}
}

/** One isolated computation, no queue. Internal constructor seams are for
 * deterministic failure tests; HTTP callers cannot choose limits or processes. */
export function createComputationRunner({timeoutMs=COMPUTATION_DEADLINE_MS,forkImpl=fork}={}){
  if(!integer(timeoutMs,1,COMPUTATION_DEADLINE_MS)||typeof forkImpl!=='function')throw new Error('Invalid computation runner setup');
  let active=null,closed=false;
  return {
    start(input){
      if(closed)throw computationError('shutdown');
      if(active)throw Object.assign(new Error('Another computation is running; no new computation was started'),{status:429});
      const payload=copy(input);
      if(!COMPUTATION_OPERATIONS.includes(payload?.operation)||Buffer.byteLength(JSON.stringify(payload))>COMPUTATION_INPUT_BYTES-1024)throw computationError('worker-failed');
      if(!exact(payload,payload.operation==='specification-recheck'?['operation','specification','formText']:payload.operation==='review-analysis'?['operation','family','survey','rules','options']:payload.operation==='replay'?['operation','family','survey','rules','finding']:['operation','family','survey'])
        ||payload.operation==='review-analysis'&&!exact(payload.options,['origin','reviewStatus']))throw computationError('worker-failed');
      if(payload.operation==='specification-recheck'&&(typeof payload.formText!=='string'||Buffer.byteLength(payload.formText)>32768||!exact(payload.specification,['kind','version','profile','currentProfile','reviewBasis','specificationSha256'])||payload.specification.kind!=='formrehearsal-approved-specification'||payload.specification.version!==2||Buffer.byteLength(JSON.stringify(payload.specification,null,2))>SPECIFICATION_FILE_LIMIT))throw computationError('worker-failed');
      const job={id:randomUUID(),started:performance.now(),reason:null,child:null,result:null,messages:0,exited:false};
      let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
      // A caller can cancel synchronously before attaching its await handler.
      promise.catch(()=>{});active=job;
      const stop=reason=>{
        if(job.exited)return promise;
        job.reason??=reason;
        try{job.child?.kill('SIGKILL');}catch{/* A signal error does not prove termination. Keep capacity until close. */}
        return promise;
      };
      job.cancel=stop;
      const finish=(code,signal)=>{
        if(job.exited)return;job.exited=true;clearTimeout(job.timer);
        if(active===job)active=null;
        if(performance.now()-job.started>=timeoutMs)job.reason??='timeout';
        if(code===124)job.reason??='timeout';
        if(job.reason)return reject(computationError(job.reason));
        if(code!==0||signal!==null||job.messages!==1||!job.result)return reject(computationError('worker-failed'));
        resolve(job.result);
      };
      try{
        job.child=forkImpl(fileURLToPath(new URL('./computation-supervisor.mjs',import.meta.url)),[],{
          env:{},execArgv:[...COMPUTATION_EXEC_ARGV],stdio:['ignore','ignore','ignore','ipc'],serialization:'json',windowsHide:true,
        });
        job.child.on('message',message=>{
          if(job.exited||job.reason)return;
          if(performance.now()-job.started>=timeoutMs){stop('timeout');return;}
          try{
            check(++job.messages===1&&exact(message,['version','operation','result'])&&message.version===1&&message.operation===payload.operation);
            assertComputationResult(payload,message.result);job.result=copy(message.result);
          }catch{stop('invalid-result');}
        });
        job.child.on('error',()=>stop('worker-failed'));
        job.child.on('disconnect',()=>{if(!job.exited&&job.messages!==1)stop('worker-failed');});
        job.child.once('close',finish);
        job.timer=setTimeout(()=>stop('timeout'),Math.max(1,timeoutMs-(performance.now()-job.started)));
        job.child.send({version:1,remainingMs:Math.max(1,timeoutMs-(performance.now()-job.started)),payload},error=>{if(error)stop('worker-failed');});
      }catch{
        if(job.child)stop('worker-failed');
        else {job.exited=true;active=null;reject(computationError('worker-failed'));}
      }
      return Object.freeze({id:job.id,promise,timeoutMs,cancel:(reason='cancelled')=>stop(reason)});
    },
    close(){closed=true;return active?active.cancel('shutdown').catch(()=>{}):Promise.resolve();},
    get busy(){return active!==null;},
  };
}

const sha=text=>createHash('sha256').update(text).digest('hex');
function assertRecheckTransport(payload,envelope){
  const {specification:spec,formText}=payload;
  check(Buffer.byteLength(JSON.stringify(envelope))<=COMPUTATION_OUTPUT_BYTES);
  if(envelope?.status==='invalid'){
    check(exact(envelope,['status','specificationSha256','formTextSha256','error'])
      &&envelope.specificationSha256===spec.specificationSha256&&envelope.formTextSha256===sha(formText)
      &&typeof envelope.error==='string'&&envelope.error.length>0&&envelope.error.length<=1000
      &&!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(envelope.error));return;
  }
  check(exact(envelope,['status','result'])&&envelope.status==='complete');
  const result=envelope.result;
  check(exact(result,['kind','version','currentProfile','specification','formText','computation','resultSha256'])
    &&result.kind==='formrehearsal-recheck-result'&&result.version===2&&result.formText===formText
    &&digest(result.specification)===digest(spec)&&digest(result.currentProfile)===digest(spec.currentProfile)
    &&Buffer.byteLength(JSON.stringify(result,null,2))<=RECHECK_RESULT_FILE_LIMIT);
  const {resultSha256,...contents}=result;check(resultSha256===digest(contents));
  const original=spec.reviewBasis.suppliedInput,rawInputs={...original.rawInputs,formText},survey=parseFormJson(formText);
  const inputId='input-'+digest(rawInputs),family={...original.family,id:inputId};
  const context=value=>{
    const form=copy(value),questions=form.pages?.[0]?.elements??form.elements;
    for(const question of questions)if(family.fields.some(field=>field.name===question.name&&field.role==='target'))
      for(const key of ['visibleIf','requiredIf','visible','isRequired'])delete question[key];
    return form;
  };
  check(digest(context(survey))===digest(context(original.survey)));
  const c=result.computation,rules=spec.reviewBasis.rules,coverage=coverageSummary(spec.reviewBasis.manualProvenance??spec.reviewBasis.reviewProvenance);
  const hashes={policyTextSha256:sha(rawInputs.policyText),formTextSha256:sha(formText),driverTextSha256:sha(rawInputs.driverText),
    rawInputsSha256:digest(rawInputs),familySha256:digest(family),schemaSha256:digest(family.fields),formSha256:digest(survey)};
  check(exact(c,['origin','attestation','claim','specificationSha256','originalInputId','inputId','hashes','rulesSha256','profile','coverage','statesChecked','findings','status','analysisExitCode'])
    &&c.origin==='approved-specification-recheck'&&c.attestation==='not-user-attested'
    &&c.claim==='Fresh finite computation against the original approved predicates. Original approval does not attest this replacement form or establish policy truth. Unchecked slots remain unknown.'
    &&c.specificationSha256===spec.specificationSha256&&c.originalInputId===original.inputId&&c.inputId===inputId
    &&digest(c.hashes)===digest(hashes)&&c.rulesSha256===digest(rules)&&digest(c.profile)===digest(spec.profile)
    &&digest(c.coverage)===digest(coverage)&&c.statesChecked===original.states);
  assertFindings({family,survey,rules,findings:c.findings});
  check(c.status===(c.findings.length?'discrepancies':coverage.unchecked.length?'no-discrepancies-partial':'no-discrepancies-covered-slots')
    &&c.analysisExitCode===(c.findings.length?1:coverage.unchecked.length?3:0));
}
