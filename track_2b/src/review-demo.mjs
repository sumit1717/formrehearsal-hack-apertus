/** Disclosed authored demonstration. Never a provider recording or blinded case. */
import {createHash} from 'node:crypto';
const sentences = [
  'Show the delivery note exactly when delivery is true.',
  'When the delivery note is shown, require it exactly when urgent is true.',
  'Show the pickup note exactly when delivery is false.',
  'Whenever the pickup note is shown, require an answer.',
  'Always show the receipt note.',
  'No requiredness rule is stated for the receipt note.',
];
const fields = ['delivery', 'urgent', 'delivery_note', 'pickup_note', 'receipt_note'].map((name, i) => ({name, label: name.replaceAll('_', ' '), role: i < 2 ? 'driver' : 'target', kind: 'boolean'}));
const id = 'delivery-review-synthetic-omission';
const elements = fields.map(field => ({name: field.name, title: field.label, type: 'boolean'}));
elements[2].visibleIf = '{delivery} = true';
elements[3].visibleIf = '{delivery} = false'; elements[3].isRequired = true;
const clean = structuredClone(elements); clean[2].requiredIf = '{urgent} = true';
export const REVIEW_DEMO_FAMILY = {id, title: 'Delivery notes · synthetic omission demo', policy: sentences.join('\n'), fields,
  forms: {clean: {elements: clean}, mutant: {elements}}};
const rawFinalText = JSON.stringify({status: 'ok', rules: [
  {field: 'delivery_note', property: 'visible', condition: {op: 'eq', field: 'delivery', value: true}, quote: sentences[0]},
  {field: 'pickup_note', property: 'visible', condition: {op: 'eq', field: 'delivery', value: false}, quote: sentences[2]},
  {field: 'pickup_note', property: 'required', condition: true, quote: sentences[3]},
  {field: 'receipt_note', property: 'visible', condition: true, quote: sentences[4]},
]}, null, 2);
export const REVIEW_DEMO_RECORDING = {id, familyId: id, rawFinalText, provenance: {
  kind: 'synthetic-omission-demonstration', contractVersion: 'quote-extraction-v3',
  rawFinalTextSha256: createHash('sha256').update(rawFinalText).digest('hex'),
  claim: 'Authored demonstration with deliberate omissions. No provider response, blinded case, human result or model-quality claim.',
}};
