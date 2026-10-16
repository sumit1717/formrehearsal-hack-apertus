import { Model } from 'survey-core';
import { lintSurvey } from 'survey-core/linter';
import { createHash } from 'node:crypto';

export const LIMITS = Object.freeze({fields:10,drivers:6,states:4096,depth:8,rules:20,policyLength:12000});
const fail = message => { throw new Error(message); };
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const keys = (x, allow, context) => { if (!object(x)) fail(`${context} must be an object`); for (const k of Object.keys(x)) if (!allow.includes(k)) fail(`Unsupported ${context} key: ${k}`); };
const boundedText = (x, name, max=2000) => { if(x[name]!==undefined&&(typeof x[name]!=='string'||x[name].length>max))fail(`${name} must be a bounded string`); };
const enumValue = (x, name, values) => { if(x[name]!==undefined&&!values.includes(x[name]))fail(`Unsupported ${name} value`); };
const canonical = x => Array.isArray(x) ? x.map(canonical) : object(x) ? Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])) : x;
export const digest = x => createHash('sha256').update(JSON.stringify(canonical(x))).digest('hex');
const familyDigest = f => digest({id:f.id,policy:f.policy,fields:f.fields});
export function domain(field) {
  if (field.kind === 'boolean') return [false,true];
  if (field.kind === 'choice' && Array.isArray(field.values) && field.values.length >= 2 && field.values.length <= 8 && field.values.every(x=>typeof x === 'string' && /^[a-zA-Z0-9 _-]{1,60}$/.test(x)) && new Set(field.values).size === field.values.length) return field.values;
  if (field.kind === 'integer' && Number.isSafeInteger(field.min) && Number.isSafeInteger(field.max) && field.min <= field.max && field.max-field.min <= 20) return Array.from({length:field.max-field.min+1},(_,i)=>field.min+i);
  fail(`Invalid finite domain for ${field.name}`);
}
export function validateFields(family) {
  if (!object(family) || typeof family.policy !== 'string' || family.policy.length > LIMITS.policyLength) fail('A bounded policy string is required');
  if (!Array.isArray(family.fields) || family.fields.length < 5 || family.fields.length > LIMITS.fields) fail('Scope supports 5–10 fields');
  const names=new Set();
  for (const f of family.fields) {
    keys(f,['name','label','role','kind','values','min','max'],'field');
    if (!/^[a-z][a-z0-9_]{0,50}$/.test(f.name) || ['constructor','prototype','__proto__'].includes(f.name) || names.has(f.name)) fail('Invalid or duplicate field name');
    names.add(f.name); if (!['driver','target'].includes(f.role)) fail(`Invalid role: ${f.name}`); domain(f);
  }
  const drivers=family.fields.filter(x=>x.role==='driver');
  if (!drivers.length || drivers.length>LIMITS.drivers || !family.fields.some(x=>x.role==='target')) fail('Unsupported driver/target count');
  if (drivers.reduce((a,f)=>a*domain(f).length,1)>LIMITS.states) fail('Finite state budget exceeded');
  return family;
}
export function validateCondition(node, family, depth=0) {
  if (depth>LIMITS.depth) fail('Condition nesting exceeds bound');
  if (typeof node==='boolean') return;
  if (!object(node)) fail('Invalid condition');
  if (node.op==='not') {keys(node,['op','arg'],'not');validateCondition(node.arg,family,depth+1);return;}
  if (['all','any'].includes(node.op)) {keys(node,['op','args'],node.op);if(!Array.isArray(node.args)||node.args.length<1||node.args.length>8)fail('Invalid logical operands');node.args.forEach(x=>validateCondition(x,family,depth+1));return;}
  keys(node,['op','field','value'],'comparison');
  if(!['eq','ne','gt','gte','lt','lte'].includes(node.op))fail('Unsupported operator');
  const f=family.fields.find(x=>x.name===node.field && x.role==='driver');
  if(!f)fail('Conditions may reference only independent driver fields');
  if(['gt','gte','lt','lte'].includes(node.op)) {if(f.kind!=='integer'||!Number.isSafeInteger(node.value))fail('Ordering requires integers');}
  else if(typeof node.value !== typeof domain(f)[0])fail('Condition value type mismatch');
  if(f.kind==='integer'&&!Number.isSafeInteger(node.value))fail('Integer condition requires a finite integer');
  if(['eq','ne'].includes(node.op)&&!domain(f).includes(node.value))fail('Equality value outside finite domain');
  if(!domain(f).includes(node.value))fail('Condition value outside declared domain');
}
export function evaluateCondition(n, answers) {
  if(typeof n==='boolean')return n;
  if(n.op==='not')return !evaluateCondition(n.arg,answers);
  if(n.op==='all')return n.args.every(x=>evaluateCondition(x,answers));
  if(n.op==='any')return n.args.some(x=>evaluateCondition(x,answers));
  const a=answers[n.field], b=n.value;
  return ({eq:()=>a===b,ne:()=>a!==b,gt:()=>a>b,gte:()=>a>=b,lt:()=>a<b,lte:()=>a<=b})[n.op]();
}
export function validateRules(family, rules) {
  if(!Array.isArray(rules)||rules.length<1||rules.length>LIMITS.rules)fail('Expected a bounded nonempty rule list');
  const ids=new Set(), assertions=new Set();
  for(const r of rules){
    keys(r,['id','field','property','condition','source'],'rule');
    if(typeof r.id!=='string'||ids.has(r.id))fail('Invalid/duplicate rule ID');ids.add(r.id);
    if(!family.fields.some(x=>x.name===r.field&&x.role==='target'))fail('Rule target must be a dependent field');
    if(!['visible','required'].includes(r.property))fail('Unsupported rule property');
    const a=`${r.field}/${r.property}`;if(assertions.has(a))fail('Duplicate target/property assertion');assertions.add(a);
    validateCondition(r.condition,family);
    keys(r.source,['start','end','quote'],'source');const s=r.source;
    if(!Number.isSafeInteger(s.start)||!Number.isSafeInteger(s.end)||s.start<0||s.end<=s.start||s.end>family.policy.length||family.policy.slice(s.start,s.end)!==s.quote)fail('Source passage does not exactly match policy offsets');
  }
}
// This parser only admits the supported expression grammar. SurveyJS evaluates it.
function validateSurveyExpression(text,family){
  if(typeof text!=='string'||text.length>2000)fail('Invalid survey expression');
  const tokens=[]; let pos=0;
  const re=/\s*(\{[a-z][a-z0-9_]*\}|'(?:[a-zA-Z0-9 _-])*'|-?\d+|>=|<=|!=|=|>|<|\(|\)|\band\b|\bor\b|\bnot\b|\btrue\b|\bfalse\b)/y;
  while(pos<text.length){if(!text.slice(pos).trim())break;re.lastIndex=pos;const m=re.exec(text);if(!m)fail('Unsupported survey expression syntax');tokens.push(m[1]);pos=re.lastIndex;}
  let at=0,depth=0;const peek=()=>tokens[at];const take=()=>tokens[at++];
  const expr=()=>{term();while(peek()==='or'){take();term();}};
  const term=()=>{atom();while(peek()==='and'){take();atom();}};
  const atom=()=>{
    if(++depth>LIMITS.depth)fail('Survey expression depth exceeded');
    if(peek()==='not'){take();atom();}
    else if(peek()==='('){take();expr();if(take()!==')')fail('Unbalanced survey expression');}
    else if(['true','false'].includes(peek()))take();
    else {const ref=take();if(!ref?.startsWith('{'))fail('Expected driver reference');const field=ref.slice(1,-1);const op=take(), literal=take();if(!['=','!=','>','>=','<','<='].includes(op)||literal===undefined)fail('Expected finite comparison');let value;if(literal[0]==="'")value=literal.slice(1,-1);else if(literal==='true'||literal==='false')value=literal==='true';else if(/^-?\d+$/.test(literal))value=Number(literal);else fail('Expected literal');validateCondition({op:({'=':'eq','!=':'ne','>':'gt','>=':'gte','<':'lt','<=':'lte'})[op],field,value},family);}
    depth--;
  };
  expr();if(at!==tokens.length)fail('Trailing survey expression syntax');
}
export function validateSurvey(family,survey){
  keys(survey,['title','description','elements','pages','showQuestionNumbers','showProgressBar','clearInvisibleValues','checkErrorsMode'],'survey');
  boundedText(survey,'title');boundedText(survey,'description');
  enumValue(survey,'showQuestionNumbers',['on','onPage','recursive','off',true,false]);
  enumValue(survey,'showProgressBar',[true,false]);
  enumValue(survey,'clearInvisibleValues',['none','onComplete','onHidden','onHiddenContainer']);
  enumValue(survey,'checkErrorsMode',['onNextPage','onValueChanged','onComplete']);
  if(survey.pages&&survey.elements)fail('Use elements or a single page');
  let elements=survey.elements;
  if(survey.pages){if(!Array.isArray(survey.pages)||survey.pages.length!==1)fail('Only a single page is supported');keys(survey.pages[0],['name','title','elements'],'page');boundedText(survey.pages[0],'name',100);boundedText(survey.pages[0],'title');elements=survey.pages[0].elements;}
  if(!Array.isArray(elements)||elements.length!==family.fields.length)fail('Survey fields must match declared finite schema');
  const seen=new Set();let targetStarted=false;
  for(const q of elements){
    keys(q,['type','name','title','description','choices','visibleIf','requiredIf','isRequired','visible','inputType','min','max','step','validators'],'question');
    boundedText(q,'title');boundedText(q,'description');
    const f=family.fields.find(x=>x.name===q.name);if(!f||seen.has(q.name))fail('Unknown or duplicate survey field');seen.add(q.name);
    if(f.kind!=='choice'&&q.choices!==undefined)fail('Choices are only supported for choice fields');
    if(f.kind!=='integer'&&['inputType','min','max','step','validators'].some(k=>q[k]!==undefined))fail('Numeric settings are only supported for integer fields');
    if(f.role==='target')targetStarted=true;else if(targetStarted)fail('Driver questions must precede targets');
    if(f.role==='driver'&&(q.visibleIf!==undefined||q.requiredIf!==undefined||q.visible===false))fail('Drivers must be independent and always visible');
    if(f.kind==='boolean'&&q.type!=='boolean')fail('Boolean question type mismatch');
    if(f.kind==='choice'&&(q.type!=='radiogroup'||JSON.stringify(q.choices)!==JSON.stringify(f.values)))fail('Choice domain must exactly match survey choices');
    if(f.kind==='integer'&&(q.type!=='text'||q.inputType!=='number'||q.min!==f.min||q.max!==f.max))fail('Integer bounds must exactly match survey min/max');
    if(q.step!==undefined&&q.step!==1)fail('Only integer steps are supported');
    if(q.validators!==undefined){if(f.kind!=='integer'||!Array.isArray(q.validators)||q.validators.length!==1)fail('Only a bounded numeric validator is supported');const v=q.validators[0];keys(v,['type','minValue','maxValue'],'validator');if(v.type!=='numeric'||v.minValue!==f.min||v.maxValue!==f.max)fail('Validator must match integer bounds');}
    for(const property of ['visibleIf','requiredIf'])if(q[property]!==undefined)validateSurveyExpression(q[property],family);
    for(const property of ['visible','isRequired'])if(q[property]!==undefined&&typeof q[property]!=='boolean')fail('Expected boolean property');
  }
  const model=new Model(survey);const modelErrors=model.jsonErrors;model.dispose();if(modelErrors?.length)fail(`SurveyJS rejected schema: ${modelErrors.map(e=>e.message??JSON.stringify(e)).join('; ')}`);
  const lint=lintSurvey(survey);if(lint.errorCount)fail(`SurveyJS linter rejected schema: ${lint.findings.filter(f=>f.severity==='error').map(f=>f.ruleId).join(', ')}`);
  return elements;
}
export function assignments(family){
  let rows=[{}];for(const f of family.fields.filter(x=>x.role==='driver'))rows=rows.flatMap(row=>domain(f).map(value=>({...row,[f.name]:value})));return rows;
}
export function executeSurvey(family,survey,answers){
  const drivers=family.fields.filter(f=>f.role==='driver');
  if(Object.keys(answers).length!==drivers.length||drivers.some(f=>!Object.hasOwn(answers,f.name)||!domain(f).includes(answers[f.name])))fail('Replay requires exactly one in-domain answer for every driver');
  const model=new Model(survey), steps=[];
  for(const f of drivers){const q=model.getQuestionByName(f.name);if(!q.isVisible)fail('Unreachable driver path');model.setValue(f.name,answers[f.name]);steps.push({field:f.name,value:answers[f.name]});}
  const states={};
  for(const f of family.fields.filter(f=>f.role==='target')){const q=model.getQuestionByName(f.name);states[f.name]={visible:q.isVisible,required:q.isRequired,emptyValueValid:q.isVisible?q.validate():null};}
  model.dispose();
  return {steps,states};
}
function differences(rules,answers,states){
  return rules.flatMap(r=>{const state=states[r.field];if(r.property==='required'&&!state.visible)return [];const expected=evaluateCondition(r.condition,answers), observed=state[r.property];return expected===observed?[]:[{ruleId:r.id,field:r.field,property:r.property,expected,observed,source:r.source,condition:r.condition}];});
}
function subsets(names,k,start=0,path=[],out=[]){if(!k){out.push(path);return out;}for(let i=start;i<=names.length-k;i++)subsets(names,k-1,i+1,[...path,names[i]],out);return out;}
const signature=d=>`${d.ruleId}:${d.expected}:${d.observed}`;
function minimize(group,rows,names){
  const sig=signature(group[0].difference);
  for(let size=0;size<=names.length;size++)for(const subset of subsets(names,size))for(const item of group){
    const cube=Object.fromEntries(subset.map(name=>[name,item.answers[name]]));
    const completions=rows.filter(r=>subset.every(name=>r.answers[name]===cube[name]));
    if(completions.every(r=>r.differences.some(d=>signature(d)===sig)))return {minimalAnswers:cube,guaranteedCompletions:completions.length,answers:item.answers,states:item.states,steps:item.steps};
  }
  fail('Witness minimization invariant failed');
}
export function analyze(family,survey,options={}){
  const supplied=Object.hasOwn(options,'rules');
  const rules=supplied?options.rules:family.intendedRules?.rules;
  const origin=options.origin??(supplied?'unverified':family.intendedRules?.origin??'unverified');
  const reviewStatus=options.reviewStatus??(supplied?'pending-human-review':family.intendedRules?.reviewStatus??'pending-human-review');
  validateFields(family);validateRules(family,rules);validateSurvey(family,survey);
  const start=performance.now();const native=lintSurvey(survey);
  const rows=assignments(family).map(answers=>{const run=executeSurvey(family,survey,answers);return {answers,...run,differences:differences(rules,answers,run.states)};});
  const groups=new Map();for(const row of rows)for(const d of row.differences){const sig=signature(d);if(!groups.has(sig))groups.set(sig,[]);groups.get(sig).push({...row,difference:d});}
  const names=family.fields.filter(f=>f.role==='driver').map(f=>f.name);
  const findings=[...groups.values()].map(group=>{const witness=minimize(group,rows,names);return {...group[0].difference,...witness,violatingStates:group.length,certificate:{familyId:family.id,familySha256:familyDigest(family),surveySha256:digest(survey),rulesSha256:digest(rules),answers:witness.answers}};}).sort((a,b)=>Object.keys(a.minimalAnswers).length-Object.keys(b.minimalAnswers).length||a.ruleId.localeCompare(b.ruleId)||Number(a.expected)-Number(b.expected));
  return {familyId:family.id,provenance:{origin,reviewStatus,modelInference:'not-run',claim:'Finite execution against supplied rules; not evidence of prose interpretation accuracy.'},engine:{name:'survey-core',version:'3.1.2'},native,statesChecked:rows.length,findings,durationMs:Math.round((performance.now()-start)*10)/10,surveySha256:digest(survey),rulesSha256:digest(rules)};
}
export function replay(family,survey,rules,finding){
  if(!object(finding)||typeof finding.expected!=='boolean'||typeof finding.observed!=='boolean'||finding.expected===finding.observed)fail('Replay needs differing Boolean expected/observed states');
  validateFields(family);validateRules(family,rules);validateSurvey(family,survey);
  const c=finding.certificate;if(!c||c.familyId!==family.id||c.familySha256!==familyDigest(family)||c.surveySha256!==digest(survey)||c.rulesSha256!==digest(rules))fail('Replay certificate does not match policy, fields, form or rules');
  if(digest(c.answers)!==digest(finding.answers))fail('Replay answers differ from certificate');
  const rule=rules.find(r=>r.id===finding.ruleId);
  if(!rule||['field','property','source','condition'].some(key=>digest(finding[key])!==digest(rule[key])))fail('Replay finding metadata differs from the source rule');
  const run=executeSurvey(family,survey,c.answers);const actual=differences(rules,c.answers,run.states).find(d=>signature(d)===signature(finding));
  if(!actual)return {reproduced:false,...run};
  if(digest(finding.steps)!==digest(run.steps)||digest(finding.states)!==digest(run.states))fail('Replay path/state metadata is not authentic');
  if(!object(finding.minimalAnswers))fail('Invalid minimized witness');
  const drivers=family.fields.filter(f=>f.role==='driver').map(f=>f.name), cube=Object.entries(finding.minimalAnswers);
  if(cube.some(([name,value])=>!drivers.includes(name)||c.answers[name]!==value))fail('Invalid minimized witness answers');
  // Recompute the bounded proof, not just one lucky execution. This also checks
  // smallest-cardinality and count claims in externally loaded replay files.
  const fresh=analyze(family,survey,{rules});const reference=fresh.findings.find(f=>signature(f)===signature(finding));
  if(!reference||cube.length!==Object.keys(reference.minimalAnswers).length||finding.violatingStates!==reference.violatingStates)fail('Replay minimality/count claim is invalid');
  const completions=assignments(family).filter(a=>cube.every(([k,v])=>a[k]===v));
  if(finding.guaranteedCompletions!==completions.length||!completions.every(a=>differences(rules,a,executeSurvey(family,survey,a).states).some(d=>signature(d)===signature(finding))))fail('Replay sufficient-condition claim is invalid');
  return {reproduced:true,...run};
}
