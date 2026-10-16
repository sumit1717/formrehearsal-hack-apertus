/** Deterministic draft predictions only. Never consults a form or author rules. */
import {assignments, evaluateCondition, validateFields, validateRules} from './core.mjs';

const words = {eq: 'equals', ne: 'does not equal', gt: 'is greater than', gte: 'is at least', lt: 'is less than', lte: 'is at most'};
const literal = value => typeof value === 'string' ? JSON.stringify(value) : String(value);
// Parentheses retain the AST's grouping, including nested NOT and singletons.
export function conditionText(node) {
  if (typeof node === 'boolean') return node ? 'always true' : 'always false';
  if (node.op === 'not') return `NOT (${conditionText(node.arg)})`;
  if (['all', 'any'].includes(node.op)) return `${node.op === 'all' ? 'ALL' : 'ANY'} of (${node.args.map(conditionText).join('; ')})`;
  return `${node.field} ${words[node.op]} ${literal(node.value)}`;
}
const key = rule => `${rule.field}/${rule.property}`;

function summarize(rule, rows, drivers, visibility) {
  const values = rows.map(answers => evaluateCondition(rule.condition, answers));
  const influences = [];
  for (const field of drivers) {
    const others = drivers.filter(name => name !== field);
    const witness = indexes => {
      const groups = new Map();
      for (const i of indexes) {
        const group = JSON.stringify(others.map(name => rows[i][name]));
        if (!groups.has(group)) groups.set(group, i);
        const first = groups.get(group);
        if (values[first] !== values[i]) return {field, before: first, after: i};
      }
      return null;
    };
    const all = rows.map((_, i) => i);
    // Prefer a shown context using only this draft's visibility predicate.
    // Influence and the complete table still cover the entire finite domain.
    const preferred = rule.property === 'required' && visibility !== undefined
      ? all.filter(i => evaluateCondition(visibility, rows[i])) : all;
    const pair = witness(preferred) ?? witness(all);
    if (pair) influences.push(pair);
  }
  const examples = [...new Set(influences.flatMap(pair => [pair.before, pair.after]))];
  if (!examples.length) examples.push(0);
  return {target: key(rule), text: conditionText(rule.condition), values, influences, examples};
}

/** Complete finite-domain predictions and original-to-current deltas.
 * Missing slots use null (unknown), never false. Requiredness assumes shown.
 * Tables share one row ordering, so row indexes are stable within this result.
 */
export function reviewBehavior(family, originalRules, currentRules) {
  validateFields(family); validateRules(family, originalRules); validateRules(family, currentRules);
  const rows = assignments(family), drivers = family.fields.filter(f => f.role === 'driver').map(f => f.name);
  const rules = currentRules.map(rule => summarize(rule, rows, drivers, currentRules.find(other => other.field === rule.field && other.property === 'visible')?.condition));
  const before = new Map(originalRules.map(rule => [key(rule), rows.map(answers => evaluateCondition(rule.condition, answers))]));
  const after = new Map(rules.map(rule => [rule.target, rule.values]));
  const changes = [...new Set([...before.keys(), ...after.keys()])].map(target => {
    const original = before.get(target) ?? null, current = after.get(target) ?? null;
    const changedRows = rows.flatMap((_, i) => (original?.[i] ?? null) !== (current?.[i] ?? null) ? [i] : []);
    // Include unchanged rules too: a source/AST edit can preserve all behavior.
    return {target, original, current, changedRows};
  });
  return {drivers, rows: rows.map(row => drivers.map(name => row[name])), rules, changes};
}

/** Current-only independent authored predictions; no invented original baseline. */
export function authoredBehavior(family, rules) {
  validateFields(family);validateRules(family,rules);
  const rows=assignments(family),drivers=family.fields.filter(f=>f.role==='driver').map(f=>f.name);
  return {drivers,rows:rows.map(row=>drivers.map(name=>row[name])),
    rules:rules.map(rule=>summarize(rule,rows,drivers,rules.find(other=>other.field===rule.field&&other.property==='visible')?.condition)),changes:[]};
}
