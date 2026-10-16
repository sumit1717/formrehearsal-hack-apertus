/**
 * Inactive, prepare-only Apertus experiment adapter. No networking or credentials.
 * Prepared requests and offline fixtures are NOT model output or performance data.
 */
import { readFileSync } from 'node:fs';
import {LIMITS, validateFields, validateRules, validateSurvey} from './core.mjs';

export const APERTUS_ADAPTER_STATUS = Object.freeze({
  kind: 'prepare-only',
  liveEnabled: false,
  liveCalls: 0,
  modelVerification: 'not-performed',
  structuredOutputGuarantee: 'unknown',
  maximumExplicitRepairRetries: 1,
});

const extractionPrompt = readFileSync(new URL('../prompts/extraction.txt', import.meta.url), 'utf8').trim();
const directPrompt = readFileSync(new URL('../prompts/direct.txt', import.meta.url), 'utf8').trim();
const MODES = new Set(['ordinary', 'thinking']);
const COMPARISONS = new Set(['eq', 'ne', 'gt', 'gte', 'lt', 'lte']);
const FORBIDDEN_IDS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_POLICY_LENGTH = LIMITS.policyLength;
const MAX_RESPONSE_LENGTH = 1_000_000;
const MAX_DRIVER_ASSIGNMENTS = LIMITS.states;

function fail(message) { throw new TypeError(message); }
function record(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) fail(`${label} must be a plain object`);
  return value;
}
function exactKeys(value, allowed, label, required = allowed) {
  record(value, label);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${label}: unexpected key ${key}`);
  for (const key of required) if (!Object.hasOwn(value, key)) fail(`${label}: missing ${key}`);
}
function string(value, label, max = 2_000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(`${label} must be a nonempty string of at most ${max} characters`);
  return value;
}
function fieldId(value, label) {
  string(value, label, 80);
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(value) || FORBIDDEN_IDS.has(value)) fail(`${label} must be a safe field identifier`);
  return value;
}
function domainFor(field) {
  if (field.kind === 'boolean') return [false, true];
  if (field.kind === 'choice') {
    if (!Array.isArray(field.values) || field.values.length < 1 || field.values.length > 64) fail(`${field.name}: choice domain must contain 1–64 strings`);
    const values = field.values.map((v) => string(v, `${field.name} choice`, 200));
    if (new Set(values).size !== values.length) fail(`${field.name}: duplicate choice value`);
    return values;
  }
  if (field.kind === 'integer') {
    if (!Number.isSafeInteger(field.min) || !Number.isSafeInteger(field.max) || field.max < field.min || field.max - field.min > 255) fail(`${field.name}: integer domain requires min/max and at most 256 values`);
    return Array.from({ length: field.max - field.min + 1 }, (_, i) => field.min + i);
  }
  fail(`${field.name}: unsupported kind ${field.kind}`);
}

/** Whitelist public inputs. Never serialize an entire family. */
export function publicFamilyInput(family) {
  record(family, 'family');
  validateFields(family);
  const id = string(family.id, 'family.id', 200);
  const title = string(family.title, 'family.title', 400);
  const policy = string(family.policy, 'family.policy', MAX_POLICY_LENGTH);
  if (!Array.isArray(family.fields) || family.fields.length < 1 || family.fields.length > 16) fail('family.fields must contain 1–16 fields');
  const names = new Set();
  let combinations = 1;
  const fields = family.fields.map((field) => {
    record(field, 'field');
    const id = fieldId(field.name, 'field.name');
    if (names.has(id)) fail(`duplicate field ${id}`);
    names.add(id);
    if (!['driver', 'target'].includes(field.role)) fail(`${id}: role must be driver or target`);
    const domain = domainFor(field);
    if (field.role === 'driver') combinations *= domain.length;
    if (combinations > MAX_DRIVER_ASSIGNMENTS) fail('driver assignment space exceeds preparation bound');
    return { id, label: string(field.label, `${id}.label`, 400), role: field.role, type: field.kind, domain };
  });
  if (!fields.some((f) => f.role === 'driver') || !fields.some((f) => f.role === 'target')) fail('at least one driver and one target are required');
  return { id, title, policy, fields };
}

function selectedMode(model, mode) {
  string(model, 'model', 200);
  if (!MODES.has(mode)) fail('mode must explicitly be ordinary or thinking');
  // This selects prompt wording only. It does not activate a provider feature or
  // verify that an alias resolves to Apertus 1.5. Verify that separately first.
  return mode === 'thinking'
    ? 'The caller intends a separately verified thinking-mode configuration. Keep any deliberation internal. The final assistant message must contain only the requested JSON.'
    : 'The caller intends a separately verified ordinary-mode configuration. Return only the requested JSON, without an explanation or reasoning trace.';
}
function request(model, mode, systemPrompt, input) {
  const modeInstruction = selectedMode(model, mode);
  return {
    model,
    messages: [
      { role: 'system', content: `${systemPrompt}\n\n${modeInstruction}` },
      { role: 'user', content: JSON.stringify({ input }) },
    ],
  };
}

/** Plain chat-completions body. No tools, response_format, or provider flags. */
export function buildExtractionRequest({ family, model, mode } = {}) {
  return request(model, mode, extractionPrompt, publicFamilyInput(family));
}

/** A single explicitly supplied implementation; never family.forms or gold. */
export function buildDirectRequest({ family, survey, model, mode } = {}) {
  const input = publicFamilyInput(family);
  validateSurvey(family, survey);
  return request(model, mode, directPrompt, { ...input, survey: structuredClone(survey) });
}

/** Strict JSON envelope parsing only. Does not extract JSON from prose/fences. */
export function parseModelJson(raw) {
  if (typeof raw !== 'string' || raw.length > MAX_RESPONSE_LENGTH) fail('model output must be a bounded JSON string');
  const text = raw.replace(/^[\x20\t\r\n]+|[\x20\t\r\n]+$/g, '');
  if (!text.startsWith('{') || !text.endsWith('}')) fail('model output must be exactly one JSON object without prose or fences');
  let result;
  try { result = JSON.parse(text); } catch { fail('model output is not valid JSON'); }
  // JSON.parse normally keeps the last duplicate member. Reject ambiguity before
  // a repeated status/rule/answer key can silently overwrite an earlier value.
  const stack=[];
  for(let i=0;i<text.length;i++) {
    const char=text[i];
    if(char==='"') {
      const start=i;
      while(++i<text.length) {if(text[i]==='\\')i++;else if(text[i]==='"')break;}
      const container=stack.at(-1);
      if(container?.keyExpected) {
        const key=JSON.parse(text.slice(start,i+1));
        if(container.keys.has(key))fail('model output contains duplicate JSON member names');
        container.keys.add(key);container.keyExpected=false;
      }
    } else if(char==='{'||char==='[') {
      stack.push(char==='{'?{keys:new Set(),keyExpected:true}:null);
      if(stack.length>64)fail('model output exceeds JSON nesting bound');
    } else if(char==='}'||char===']')stack.pop();
    else if(char===','&&stack.at(-1))stack.at(-1).keyExpected=true;
  }
  record(result, 'model output');
  return result;
}

function outputEnvelope(result, listName) {
  exactKeys(result, ['status', 'reason', listName], 'output', ['status', listName]);
  if (!['ok', 'abstain'].includes(result.status)) fail('status must be ok or abstain');
  if (!Array.isArray(result[listName]) || result[listName].length > 256) fail(`${listName} must be an array of at most 256 items`);
  if (Object.hasOwn(result, 'reason')) string(result.reason, 'reason');
  if (result.status === 'abstain') {
    string(result.reason, 'abstain reason');
    if (result[listName].length) fail('abstain output must have an empty result array');
  }
}
function sourceSpan(source, policy) {
  exactKeys(source, ['start', 'end', 'quote'], 'source');
  if (!Number.isInteger(source.start) || !Number.isInteger(source.end) || source.start < 0 || source.end <= source.start || source.end > policy.length) fail('invalid half-open UTF-16 source offsets');
  string(source.quote, 'source.quote', MAX_POLICY_LENGTH);
  if (policy.slice(source.start, source.end) !== source.quote) fail('source quote does not match policy offsets');
}
function targetProperty(result, fields) {
  if (fields.get(result.field)?.role !== 'target') fail('output field must be a declared target');
  if (!['visible', 'required'].includes(result.property)) fail('property must be visible or required');
}
function valueInDomain(value, field, label) {
  if (!field.domain.some((allowed) => Object.is(allowed, value))) fail(`${label} is outside the declared ${field.id} domain`);
}
function conditionAst(ast, fields, budget, depth = 0) {
  if (++budget.nodes > 256 || depth > LIMITS.depth) fail('condition AST exceeds size/depth bound');
  if (typeof ast === 'boolean') return;
  record(ast, 'condition');
  if (COMPARISONS.has(ast.op)) {
    exactKeys(ast, ['op', 'field', 'value'], 'comparison');
    const field = fields.get(ast.field);
    if (!field || field.role !== 'driver') fail('predicates may reference driver fields only');
    valueInDomain(ast.value, field, 'comparison value');
    if (!['eq', 'ne'].includes(ast.op) && field.type !== 'integer') fail('ordered comparisons require integer drivers');
  } else if (ast.op === 'all' || ast.op === 'any') {
    exactKeys(ast, ['op', 'args'], 'junction');
    if (!Array.isArray(ast.args) || !ast.args.length || ast.args.length > 8) fail('junction requires 1–8 arguments');
    for (const arg of ast.args) conditionAst(arg, fields, budget, depth + 1);
  } else if (ast.op === 'not') {
    exactKeys(ast, ['op', 'arg'], 'negation');
    conditionAst(ast.arg, fields, budget, depth + 1);
  } else fail('unsupported condition operator');
}

/** Structural and grounding checks only; semantic validity needs independent review. */
export function validateExtractionResult(result, { family } = {}) {
  const input = publicFamilyInput(family);
  const fields = new Map(input.fields.map((f) => [f.id, f]));
  outputEnvelope(result, 'rules');
  const ids = new Set();
  const properties = new Set();
  for (const rule of result.rules) {
    exactKeys(rule, ['id', 'field', 'property', 'condition', 'source'], 'rule');
    string(rule.id, 'rule.id', 80);
    if (ids.has(rule.id)) fail('duplicate rule id');
    ids.add(rule.id);
    targetProperty(rule, fields);
    const key = `${rule.field}:${rule.property}`;
    if (properties.has(key)) fail('duplicate target/property rule; combine clauses in one condition');
    properties.add(key);
    conditionAst(rule.condition, fields, { nodes: 0 });
    sourceSpan(rule.source, input.policy);
  }
  if(result.status==='ok') validateRules(family,result.rules);
  return result;
}

/** Validate witness shape/domain; this does not execute or verify the witness. */
export function validateDirectResult(result, { family } = {}) {
  const input = publicFamilyInput(family);
  const fields = new Map(input.fields.map((f) => [f.id, f]));
  const drivers = input.fields.filter((f) => f.role === 'driver');
  outputEnvelope(result, 'defects');
  for (const defect of result.defects) {
    exactKeys(defect, ['field', 'property', 'source', 'answers', 'expected', 'observed', 'observedVisible'], 'defect', ['field', 'property', 'source', 'answers', 'expected', 'observed']);
    targetProperty(defect, fields);
    sourceSpan(defect.source, input.policy);
    exactKeys(defect.answers, drivers.map((f) => f.id), 'answers');
    for (const field of drivers) valueInDomain(defect.answers[field.id], field, `answer ${field.id}`);
    if (typeof defect.expected !== 'boolean' || typeof defect.observed !== 'boolean' || defect.expected === defect.observed) fail('defect expected/observed must be different Boolean states');
    if (Object.hasOwn(defect, 'observedVisible') && typeof defect.observedVisible !== 'boolean') fail('observedVisible must be a Boolean');
    if (defect.property === 'required' && defect.observedVisible !== true) fail('requiredness witnesses require observedVisible:true; hidden-target requiredness is skipped');
  }
  return result;
}

/**
 * For UI/plumbing demonstrations only. The wrapper must remain visible.
 * Never use this adapter to populate a column labeled model accuracy/latency.
 */
export function createOfflineFixtureAdapter({ fixture } = {}) {
  const configuredFixture = fixture === undefined ? undefined : structuredClone(fixture);
  const wrap = (kind, inputFixture, family) => {
    const supplied = inputFixture !== undefined ? inputFixture : configuredFixture;
    if (supplied === undefined) {
      return {
        provenance: { kind: 'not-run', label: 'NOT RUN — no model call or inference', modelOutput: false, liveCalls: 0 },
        result: null,
      };
    }
    const result = structuredClone(supplied);
    if (kind === 'extraction') validateExtractionResult(result, { family });
    else validateDirectResult(result, { family });
    return {
      provenance: { kind: 'mock', label: 'OFFLINE MOCK — supplied fixture, not model output or inference', modelOutput: false, liveCalls: 0 },
      result,
    };
  };
  return Object.freeze({
    kind: 'offline-fixture',
    liveEnabled: false,
    extract: ({ family, fixture: inputFixture } = {}) => wrap('extraction', inputFixture, family),
    direct: ({ family, fixture: inputFixture } = {}) => wrap('direct', inputFixture, family),
  });
}
