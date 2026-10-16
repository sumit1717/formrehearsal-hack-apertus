/** Final-draft attribution and unchecked-slot dispositions, never an edit history. */
import {createHash} from 'node:crypto';
import {digest} from './core.mjs';
export const shaText = text => createHash('sha256').update(text).digest('hex');
export const V4_REVIEW_CLAIM = 'Local review of this final draft and its unchecked slots. Actor context is identity-unverified; not independent human gold or a complete edit history.';
export const V4_BUNDLE_CLAIM = 'Replay of exact final reviewed predicates only. Unchecked slots remain unknown. Actor declarations and hashes do not authenticate identity or establish policy truth.';
export const slotKey = rule => `${rule.field}/${rule.property}`;
const fail = message => {const error = new Error(message); error.status = 400; throw error;};
export function exactKeys(value, names) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('Malformed review metadata');
  const keys = Reflect.ownKeys(value), descriptors = Object.getOwnPropertyDescriptors(value);
  if (keys.length !== names.length || keys.some(key => typeof key !== 'string' || !names.includes(key) || !descriptors[key].enumerable || !Object.hasOwn(descriptors[key], 'value'))) fail('Malformed review metadata');
}
export function reviewSlots(family) {
  return family.fields.filter(field => field.role === 'target').flatMap(field => ['visible', 'required'].map(property => ({field: field.name, property})));
}
const actorClaims = {
  'unattributed-local': 'Unattributed local review; identity unverified.',
  'self-reported-human': 'Self-reported human review; identity unverified, not independent human gold.',
  'agent-simulation': 'Agent simulation; not a human participant response or model extraction success.',
};
export function actorContext(kind = 'unattributed-local', basis = 'default-unattributed') {
  if (!Object.hasOwn(actorClaims, kind) || !['default-unattributed', 'session-declaration', 'server-simulation'].includes(basis)
    || basis === 'default-unattributed' && kind !== 'unattributed-local' || basis === 'server-simulation' && kind !== 'agent-simulation') fail('Invalid actor context');
  return Object.freeze({kind, basis, identityVerified: false, claim: actorClaims[kind]});
}
export function validateActor(value) {
  exactKeys(value, ['kind', 'basis', 'identityVerified', 'claim']);
  if (digest(value) !== digest(actorContext(value.kind, value.basis))) fail('Invalid actor declaration');
  return value;
}
export function selectEvidence(family, selection) {
  exactKeys(selection, ['start', 'end']);
  const {start, end} = selection, policy = family.policy;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start || end > policy.length) fail('Select a nonempty policy passage');
  const quote = policy.slice(start, end);
  if (!quote.trim() || !quote.isWellFormed()) fail('Selection must contain complete Unicode text');
  if (policy.indexOf(quote) !== start || policy.indexOf(quote, start + 1) !== -1) fail('Select more surrounding text: the passage must occur exactly once');
  return {start, end, quote};
}
function validateSlot(family, value) {
  if (!reviewSlots(family).some(slot => slot.field === value.field && slot.property === value.property)) fail('Resolution requires a declared target/property slot');
}
export function dispositionFromResolution(family, resolution) {
  exactKeys(resolution, ['field', 'property', 'classification', 'reasonCode', 'reason', 'selection']);
  validateSlot(family, resolution);
  const {field, property, classification: kind, reasonCode, reason, selection} = resolution;
  if (!['unsupported', 'ambiguous'].includes(kind) || !(kind === 'unsupported' ? ['not-stated', 'outside-grammar'] : ['ambiguous']).includes(reasonCode)
    || typeof reason !== 'string' || !reason.trim() || !reason.isWellFormed() || reason.length > 600) fail('An unchecked disposition needs its classification and a short reason');
  if (kind === 'unsupported' && selection !== null) fail('Unsupported dispositions do not need invented evidence');
  const source = selection === null ? null : selectEvidence(family, selection);
  return {field, property, kind, reasonCode, reason, evidence: source ? {start: source.start, end: source.end, quoteSha256: shaText(source.quote)} : null};
}
export function validateDispositions(family, rules, values) {
  if (!Array.isArray(values) || values.length > 20) fail('Invalid bounded dispositions');
  const occupied = new Set(rules.map(slotKey)), seen = new Set();
  for (const value of values) {
    exactKeys(value, ['field', 'property', 'kind', 'reasonCode', 'reason', 'evidence']);
    validateSlot(family, value);
    const key = slotKey(value);
    if (seen.has(key) || occupied.has(key)) fail('A disposition must identify one unchecked slot');
    seen.add(key);
    if (value.evidence !== null) exactKeys(value.evidence, ['start', 'end', 'quoteSha256']);
    const expected = dispositionFromResolution(family, {field: value.field, property: value.property, classification: value.kind,
      reasonCode: value.reasonCode, reason: value.reason, selection: value.evidence === null ? null : {start: value.evidence.start, end: value.evidence.end}});
    if (digest(expected) !== digest(value)) fail('Disposition evidence mismatch');
  }
  return reviewSlots(family).flatMap(slot => values.filter(value => slotKey(value) === slotKey(slot)));
}
export function finalReviewSnapshot(family, original, current, recording, actor, dispositions) {
  if (original.status !== 'valid' || current.status !== 'valid') fail('Valid original and final draft required');
  validateActor(actor);
  const before = new Map(original.rawResult.rules.map(rule => [slotKey(rule), rule]));
  const after = new Map(current.rawResult.rules.map(rule => [slotKey(rule), rule]));
  const resolved = validateDispositions(family, current.rawResult.rules, dispositions);
  const slots = reviewSlots(family).map(slot => {
    const first = before.get(slotKey(slot)), last = after.get(slotKey(slot));
    const originalRuleSha256 = first ? digest(first) : null, currentRuleSha256 = last ? digest(last) : null;
    const derivation = !first ? last ? 'locally-added' : 'omitted' : !last ? 'removed'
      : originalRuleSha256 === currentRuleSha256 ? 'matches-original' : 'locally-modified';
    return {...slot, originalRuleSha256, currentRuleSha256, derivation};
  });
  return {version: 1, actor: structuredClone(actor), originalResponseSha256: shaText(recording.rawFinalText), slots, dispositions: resolved};
}
export function coverageSummary(provenance) {
  const unchecked = provenance.slots.filter(slot => slot.currentRuleSha256 === null).map(slotKey);
  const resolved = new Set(provenance.dispositions.map(slotKey));
  return {present: provenance.slots.length - unchecked.length, unchecked, unresolved: unchecked.filter(key => !resolved.has(key))};
}
export function validateFinalSnapshot(family, original, current, recording, value) {
  exactKeys(value, ['version', 'actor', 'originalResponseSha256', 'slots', 'dispositions']);
  const expected = finalReviewSnapshot(family, original, current, recording, value.actor, value.dispositions);
  if (digest(expected) !== digest(value)) fail('Final review provenance mismatch');
  return expected;
}
