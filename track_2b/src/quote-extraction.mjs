/** Prospective v3 wire adapter. Derives labels/text positions only; never repairs predicates. */
import { createHash } from 'node:crypto';
import { LIMITS, validateCondition } from './core.mjs';
import { parseModelJson, publicFamilyInput, validateExtractionResult } from './apertus.mjs';

export const QUOTE_EXTRACTION_VERSION = 'quote-extraction-v3';
const NORMALIZATION_VERSION = 'unique-exact-quote-to-legacy-v1';
const sha = text => createHash('sha256').update(text).digest('hex');
class ContractError extends TypeError {
  constructor(code, stage) { super(code); this.code = code; this.stage = stage; }
}
const fail = (code = 'invalid-wire-schema', stage = 'wire') => { throw new ContractError(code, stage); };
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const exact = (value, keys) => {
  if (!plain(value) || Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) fail();
};
const text = (value, max) => typeof value === 'string' && !!value.trim() && value.length <= max;

function wireCondition(condition, family) {
  try { validateCondition(condition, family); } catch { fail(); }
  let nodes = 0;
  const walk = node => {
    if (++nodes > 256) fail();
    if (typeof node === 'boolean') return;
    if (!plain(node)) fail();
    if (node.op === 'all' || node.op === 'any') node.args.forEach(walk);
    else if (node.op === 'not') walk(node.arg);
  };
  walk(condition);
}
function validateWire(result, family, input) {
  if (result?.status === 'abstain') {
    exact(result, ['status', 'reason', 'rules']);
    if (!text(result.reason, 2000) || !Array.isArray(result.rules) || result.rules.length) fail();
    return;
  }
  exact(result, ['status', 'rules']);
  if (result.status !== 'ok' || !Array.isArray(result.rules) || !result.rules.length || result.rules.length > LIMITS.rules) fail();
  const seen = new Set();
  for (const rule of result.rules) {
    exact(rule, ['field', 'property', 'condition', 'quote']);
    if (!input.fields.some(f => f.id === rule.field && f.role === 'target') || !['visible', 'required'].includes(rule.property)) fail();
    const key = `${rule.field}/${rule.property}`;
    if (seen.has(key) || !text(rule.quote, LIMITS.policyLength)) fail();
    seen.add(key);
    wireCondition(rule.condition, family);
  }
}
function resolveQuote(quote, policy) {
  // No whitespace, case, Unicode or punctuation normalization; overlapping repeats count.
  if (!quote.isWellFormed()) fail('quote-not-well-formed', 'normalization');
  const start = policy.indexOf(quote);
  if (start < 0) fail('quote-not-found', 'normalization');
  if (policy.indexOf(quote, start + 1) >= 0) fail('quote-not-unique', 'normalization');
  return { start, end: start + quote.length, quote };
}

/** A new wire contract, not a permissive parser for prior output contracts. */
export function normalizeQuoteExtraction(rawResult, { family } = {}) {
  const input = publicFamilyInput(family);
  validateWire(rawResult, family, input);
  const resolvedSources = [];
  const normalizedResult = rawResult.status === 'abstain' ? structuredClone(rawResult) : {
    status: 'ok',
    rules: rawResult.rules.map((rule, index) => {
      const id = `r${index + 1}`, source = resolveQuote(rule.quote, input.policy);
      resolvedSources.push({ ruleId: id, quoteSha256: sha(rule.quote), start: source.start, end: source.end });
      return { id, field: rule.field, property: rule.property, condition: structuredClone(rule.condition), source };
    }),
  };
  try { validateExtractionResult(normalizedResult, { family }); }
  catch { fail('invalid-normalized-schema', 'normalization'); }
  return { normalizedResult, normalization: {
    version: NORMALIZATION_VERSION, policySha256: sha(input.policy),
    method: 'unique-exact-UTF16-substring', ruleIds: 'array-order-rN',
    derivedFields: rawResult.status === 'ok' ? ['id', 'source.start', 'source.end'] : [],
    semanticCoercions: 0, resolvedSources,
    claim: 'Exact text grounding only; citation association and semantic entailment are not established.',
  } };
}

/** Strict raw JSON, wire validity and normalized legacy validity are distinct evidence stages. */
export function parseQuoteExtraction(raw, { family } = {}) {
  publicFamilyInput(family); // Invalid caller context is a setup error, not a model failure.
  const base = { contractVersion: QUOTE_EXTRACTION_VERSION, status: 'invalid', strictJsonValid: false,
    wireSchemaValid: false, normalizedSchemaValid: false, rawResult: null,
    normalizedResult: null, normalization: null, error: null };
  let rawResult;
  try { rawResult = parseModelJson(raw); }
  catch { return { ...base, error: 'invalid-final-json' }; }
  try {
    const normalized = normalizeQuoteExtraction(rawResult, { family });
    return { ...base, ...normalized, rawResult, status: rawResult.status === 'abstain' ? 'abstain' : 'valid',
      strictJsonValid: true, wireSchemaValid: true, normalizedSchemaValid: true };
  } catch (error) {
    if (!(error instanceof ContractError)) throw error;
    return { ...base, rawResult, strictJsonValid: true, wireSchemaValid: error.stage === 'normalization', error: error.code };
  }
}
