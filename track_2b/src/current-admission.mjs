/** Current operations only. Frozen artifacts retain their original admission semantics. */
import {getBuiltInVariableNames,settings} from 'survey-core';
import {lintSurvey} from 'survey-core/linter';
import {validateNewInput} from './new-input.mjs';

export const CURRENT_ADMISSION_MODE='current-no-unknown-functions-or-native-driver-collisions-v3';
export const UNKNOWN_FUNCTION_ERROR='Unsupported form expression: unknown SurveyJS function. Functions are outside the supplied-input contract; no form was changed.';
// In the pinned native resolver, bare references can resolve to a primitive
// target string's length, the question-local self value, or survey built-ins
// before the declared driver answer. Only driver names can enter expressions.
// Other native context names require excluded paths/control types. Primitive
// prototype methods are not traversed. Do not blacklist unrelated identifiers
// or target-only names. No submitted identifier is rewritten.
const nativeDriverNames=new Set(['length',settings.expressionVariables.self,...getBuiltInVariableNames()]
  .map(name=>name.toLowerCase()));

/** Pinned, unextended SurveyJS runtime; callers cannot supply lint overrides. */
export function validateCurrentInput(body) {
  const input=validateNewInput(body);
  const collisions=input.family.fields.filter(field=>field.role==='driver'&&nativeDriverNames.has(field.name.toLowerCase()));
  if(collisions.length){
    const names=collisions.map(field=>JSON.stringify(field.name)).join(', ');
    const error=new Error(`Independent driver IDs collide with native SurveyJS expression names: ${names}. A condition may read native context or a target answer instead of these drivers. Choose noncolliding IDs and update their form references and driver list, then validate again. No form was changed.`);
    error.status=400;throw error;
  }
  if(lintSurvey(input.survey).findings.some(finding=>finding.ruleId==='expression/unknown-function')){
    const error=new Error(UNKNOWN_FUNCTION_ERROR);error.status=400;throw error;
  }
  return input;
}
