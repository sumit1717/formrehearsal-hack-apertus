/** Operational coverage only; never an interpretation or policy-validity score. */
import {Version} from 'survey-core';
import {assignments,digest,evaluateCondition,executeSurvey,validateFields,validateRules,validateSurvey} from './core.mjs';
const fail=message=>{throw new Error(message);};
const familyHash=family=>digest({id:family.id,policy:family.policy,fields:family.fields});

/** One fresh form execution per assignment, shared by all approved predicates.
 * The existing report is required so divergent/partial counts cannot accompany
 * an otherwise successful analysis. No fallback to author-reference rules.
 */
export function ruleApplicability(family,survey,rules,report){
  validateFields(family);validateRules(family,rules);validateSurvey(family,survey);
  const rows=assignments(family),surveySha256=digest(survey),rulesSha256=digest(rules);
  if(!report||report.familyId!==family.id||report.surveySha256!==surveySha256||report.rulesSha256!==rulesSha256
    ||report.statesChecked!==rows.length||report.engine?.name!=='survey-core'||report.engine.version!==Version||Version!=='3.1.2'
    ||!Array.isArray(report.findings))fail('Operational coverage does not match the complete analysis inputs or engine');
  const counts=rules.map(rule=>({ruleId:rule.id,field:rule.field,property:rule.property,totalStates:rows.length,
    conditionTrueStates:0,comparedStates:0,skippedHiddenStates:0,conditionTrueComparedStates:0,mismatchStates:0}));
  for(const answers of rows){
    const {states}=executeSurvey(family,survey,answers);
    rules.forEach((rule,index)=>{
      const row=counts[index],expected=evaluateCondition(rule.condition,answers),actual=states[rule.field];
      if(typeof expected!=='boolean'||typeof actual?.visible!=='boolean'||typeof actual?.[rule.property]!=='boolean')fail('Operational coverage requires complete Boolean observations');
      if(expected)row.conditionTrueStates++;
      if(rule.property==='required'&&!actual.visible){row.skippedHiddenStates++;return;}
      row.comparedStates++;if(expected)row.conditionTrueComparedStates++;
      if(expected!==actual[rule.property])row.mismatchStates++;
    });
  }
  const mismatches=new Map(rules.map(rule=>[rule.id,0]));
  for(const finding of report.findings){
    if(!mismatches.has(finding.ruleId)||!Number.isSafeInteger(finding.violatingStates)||finding.violatingStates<1)fail('Operational coverage requires complete finding counts');
    mismatches.set(finding.ruleId,mismatches.get(finding.ruleId)+finding.violatingStates);
  }
  for(const row of counts){
    if(row.comparedStates+row.skippedHiddenStates!==row.totalStates||row.conditionTrueStates>row.totalStates
      ||row.conditionTrueComparedStates>row.comparedStates||row.mismatchStates>row.comparedStates
      ||row.mismatchStates!==mismatches.get(row.ruleId))fail('Operational coverage differs from the complete finding counts');
  }
  const uncheckedSlots=family.fields.filter(field=>field.role==='target').flatMap(field=>['visible','required']
    .filter(property=>!rules.some(rule=>rule.field===field.name&&rule.property===property)).map(property=>({field:field.name,property})));
  return {kind:'finite-rule-applicability',version:1,familyId:family.id,familySha256:familyHash(family),surveySha256,rulesSha256,
    engine:{name:'survey-core',version:Version},totalStates:rows.length,rules:counts,uncheckedSlots,
    domainScope:{kind:'declared-finite-domains',integerDrivers:family.fields.filter(field=>field.role==='driver'&&field.kind==='integer').map(field=>field.name),
      claim:'Only complete answers in the declared finite driver domains are counted. Declared integer domains exclude fractions. Missing, null, out-of-domain and target-answer combinations are not covered.'},
    claim:'Counts describe predicate truth and comparisons actually made. Requiredness is compared only while the form actually shows the target. A never-true predicate can be intentional; these counts do not establish policy truth or whole-form correctness.'};
}
