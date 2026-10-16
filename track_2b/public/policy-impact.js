// Browser presentation only. All policy comparison uses the fixed local Node engine.
(() => {
  const $ = id => document.getElementById(id);
  if (!$('policyImpactPanel')) return;
  const node = (tag, text, className = '') => {
    const value = document.createElement(tag); value.textContent = text;
    if (className) value.className = className; return value;
  };
  let view = null, binding = '', epoch = 0, oldText = null, oldName = '', reading = false, retainedSelection = null;
  let controller = null, result = null, resultExpiresAt = 0, expiryTimer = null, message = '', error = false, selectedComparison = 0;
  let renderedResult;
  let interactionRevision = 0;
  // A request must not move content under a new pointer/scroll gesture or take
  // focus back after the user has moved on. The initiating click precedes its pin.
  for (const type of ['focusin', 'blur', 'pointerdown', 'touchstart', 'wheel', 'keydown'])
    window.addEventListener(type, () => {interactionRevision++;}, {passive: true});
  const snapshot = () => view?.snapshot;
  const ready = () => !!view?.approved && !view?.dirty && !view?.unconfirmed && !!snapshot()?.suppliedInput;
  const retainedPrior = () => view?.retainedPrior && typeof view.retainedPrior.text === 'string'
    && Number.isFinite(view.retainedPrior.expiresAt) && Date.now() < view.retainedPrior.expiresAt ? view.retainedPrior : null;
  function discardRetainedPrior() {
    if (view?.retainedPrior) view.retainedPrior = null;
    window.dispatchEvent?.(new CustomEvent('practice-prior-cleared'));
  }
  // Selection keeps its own lifetime pin. A delayed/throttled browser timer
  // cannot authorize a request or result after these retained bytes expire.
  function expireRetainedSelection() {
    if (!retainedSelection) return false;
    const available = retainedPrior();
    if (available && Date.now() < retainedSelection.expiresAt && available.text === retainedSelection.text
      && available.approvalHash === retainedSelection.approvalHash
      && available.specificationSha256 === retainedSelection.specificationSha256) return false;
    retire('The retained old practice review expired or changed. Its bytes and comparison were cleared. Start practice again.', false, true);
    discardRetainedPrior(); return true;
  }
  const supported = () => {
    const input = snapshot()?.suppliedInput, fields = input?.family?.fields;
    return Array.isArray(fields) && fields.every(field => ['boolean', 'choice'].includes(field.kind))
      && Number.isSafeInteger(input.states) && input.states > 0 && input.states <= 256;
  };
  const currentKey = value => JSON.stringify([value?.snapshot?.sessionId, value?.snapshot?.revision,
    value?.snapshot?.approval?.approvalHash, value?.approved, value?.dirty, value?.unconfirmed,
    value?.snapshot?.suppliedInput?.hashes?.rawInputsSha256]);
  function retire(text = '', bad = false, clearFile = false) {
    epoch++; controller?.abort(); controller = null; reading = false; result = null; resultExpiresAt = 0; selectedComparison = 0;
    clearTimeout(expiryTimer); expiryTimer = null; message = text; error = bad;
    if (clearFile) {oldText = null; oldName = ''; retainedSelection = null; $('policyImpactFile').value = '';}
  }
  function answers(value, fields) {
    const list = node('ul', '');
    for (const [name, answer] of Object.entries(value)) list.append(node('li', `${fields.find(f => f.name === name)?.label ?? name}: ${typeof answer === 'boolean' ? answer ? 'Yes' : 'No' : answer}`));
    if (!Object.keys(value).length) list.append(node('li', 'Any complete declared driver assignment'));
    return list;
  }
  const flag = (property, value) => value === null ? 'Unknown' : property === 'visible' ? value ? 'Shown' : 'Hidden' : value ? 'Required' : 'Optional';
  const label = (r, name) => r.fields.find(field => field.name === name)?.label ?? name;
  const propertyLabel = property => property === 'visible' ? 'Visibility' : 'Requiredness';
  const answerText = value => typeof value === 'boolean' ? value ? 'Yes' : 'No' : String(value);
  const drivers = r => r.fields.filter(field => field.role === 'driver');
  const sameAnswers = (r, a, b) => drivers(r).every(field => a[field.name] === b[field.name]);
  const scenarioFor = (r, answers) => r.scenarios.find(row => sameAnswers(r, row.answers, answers));
  const changedEntries = row => Object.entries(row.slots).filter(([, state]) => state.status === 'changed');
  function expireResult() {
    if (!result || Date.now() < resultExpiresAt) return false;
    retire('The source review lifetime elapsed. Confirm or start a fresh review before comparing again.', false, true);
    discardRetainedPrior(); return true;
  }
  // Local navigation remains owned by the displayed result, including when a
  // timer was throttled or a detached link is activated after replacement.
  function summaryLink(r, text, targetId) {
    const link = node('a', text); link.href = `#${targetId}`;
    link.addEventListener('click', event => {
      event.preventDefault();
      if (expireRetainedSelection() || expireResult()) {render(); return;}
      if (!link.isConnected || result !== r || !ready() || currentKey(view) !== binding || view?.busy || controller || reading) return;
      const target = $(targetId);
      if (!target || target.disabled || target.closest('[hidden]')) return;
      for (let parent = target; parent; parent = parent.parentNode)
        if (parent.tagName?.toLowerCase() === 'details') parent.open = true;
      $('reviewNavigation').open = false;
      target.focus({preventScroll: true}); target.scrollIntoView?.({block: 'start', behavior: 'instant'});
    });
    return link;
  }
  // One existing witness, joined to its complete recorded row. No fixture
  // assumptions, predicate evaluation, repair or revised-editor inspection.
  function decisionSummaryData(r) {
    const unavailable = {available: false, row: null};
    if (!Array.isArray(r.fields) || !Array.isArray(r.scenarios) || !Array.isArray(r.changedSlots)
      || !Array.isArray(r.unknownSlots) || !r.reviews?.new?.review?.approvalHash
      || r.reviews.new.review.approvalHash !== snapshot()?.approval?.approvalHash) return unavailable;
    const stateKeys = ['status', 'oldExpected', 'newExpected', 'currentFormBehavior', 'currentVisible', 'comparison'];
    const agrees = (change, state) => state && stateKeys.every(key => Object.hasOwn(change, key) && change[key] === state[key]);
    function sourceAgrees(change, side) {
      const rule = change[`${side}Rule`], source = rule?.source, policy = r.reviews[side]?.policyText;
      return rule?.field === change.field && rule.property === change.property && rule.condition && typeof rule.condition === 'object'
        && typeof policy === 'string' && source && Number.isSafeInteger(source.start) && Number.isSafeInteger(source.end)
        && source.start >= 0 && source.end > source.start && source.end <= policy.length
        && typeof source.quote === 'string' && source.quote === policy.slice(source.start, source.end);
    }
    // Compare existing record identities and values only. This does not verify
    // a predicate, quote hash, signature, or the truth of the reviewed policy.
    for (const change of r.changedSlots) {
      if (!change?.answers || typeof change.answers !== 'object') return unavailable;
      const recorded = declaredScenario(r, change.answers), key = `${change.field}/${change.property}`;
      if (!recorded || !Object.hasOwn(recorded.slots, key) || change.status !== 'changed'
        || !agrees(change, recorded.slots[key]) || !sourceAgrees(change, 'old') || !sourceAgrees(change, 'new')) return unavailable;
    }
    const witness = r.changedSlots[0], selection = witness?.answers ?? r.scenarios[0]?.answers;
    const row = selection && typeof selection === 'object' ? declaredScenario(r, selection) : null;
    if (!row) return unavailable;
    for (const [key, state] of changedEntries(row)) {
      if (!r.changedSlots.some(change => `${change.field}/${change.property}` === key && agrees(change, state))) return unavailable;
    }
    const unknownKeys = Object.keys(row.slots).filter(key => row.slots[key].status === 'unknown');
    const listedKeys = r.unknownSlots.map(slot => `${slot?.field}/${slot?.property}`);
    if (new Set(listedKeys).size !== listedKeys.length || listedKeys.length !== unknownKeys.length
      || unknownKeys.some(key => !listedKeys.includes(key)) || r.unknownSlots.some(slot => {
        const state = row.slots[`${slot.field}/${slot.property}`];
        return slot.oldRulePresent !== (state.oldExpected !== null) || slot.newRulePresent !== (state.newExpected !== null);
      })) return unavailable;
    return {available: true, row: witness ? row : null};
  }
  function renderDecisionSummary(r, data) {
    const panel = node('section', '', 'policy-decision-summary'); panel.id = 'policyImpactDecisionSummary';
    panel.append(node('h4', 'Developer decision summary'));
    if (!data.available) {
      panel.append(node('p', 'Decision summary unavailable: comparison records or approval identities are missing or inconsistent. No behavior or revision action is inferred.', 'coverage-caution'),
        node('p', 'Unknown status cannot be resolved from this response. Do not infer unchanged or passing. Review the sources and compare again.', 'coverage-caution'));
      return panel;
    }
    const witness = r.changedSlots[0], row = data.row;
    const changes = row ? changedEntries(row) : [];
    if (changes.length) {
      panel.append(node('p', 'One computed changed request. Other requests may differ.', 'subtle'));
      const request = node('p', '', 'policy-decision-request');
      request.textContent = drivers(r).map(field => `${field.label || field.name}: ${answerText(row.answers[field.name])}`).join(' · ');
      panel.append(request);
      const list = node('ul', '');
      for (const [key, state] of changes) {
        const [field, property] = key.split('/');
        const action = state.comparison === 'differs-from-new' ? 'Revision needed here.'
          : state.comparison === 'matches-new' ? 'Already matches here.' : 'Target hidden; requiredness check skipped.';
        list.append(node('li', `${label(r, field)} / ${propertyLabel(property)}: old ${flag(property, state.oldExpected)} → new ${flag(property, state.newExpected)}; original form ${flag(property, state.currentFormBehavior)}. ${action}`));
      }
      panel.append(list);
    } else panel.append(node('p', witness ? 'No unique complete changed request row is available. No behavior is inferred.'
      : 'No changed request witness was reported. Review known form differences and unresolved rules below.'));
    const unknown = r.unknownSlots.map(slot => `${label(r, slot.field)} / ${propertyLabel(slot.property)}`);
    panel.append(node('p', unknown.length ? `Still unknown: ${unknown.join('; ')}. Unknown is not unchanged or passing.`
      : 'No unknown rule slots reported. This bounded comparison is not a whole-form correctness claim.', 'coverage-caution'));
    panel.append(node('p', 'Original reviewed form only. Editor revisions need a separate explicit recheck.', 'subtle'));
    const links = node('nav', '', 'policy-decision-links'); links.setAttribute('aria-label', 'Comparison next steps');
    if (changes.length) links.append(summaryLink(r, 'Scenario details', 'policyImpactSummaryWitness'));
    links.append(summaryLink(r, 'Policy-owner questions', 'policyImpactPolicyQuestions'),
      summaryLink(r, 'Revision editor', 'recheckFormText'));
    panel.append(links); return panel;
  }
  // Questions and next steps summarize this response only. They never supply a
  // predicate, claim an owner has answered, or examine an unchecked editor draft.
  function renderNextSteps(r) {
    const panel = node('section', '', 'policy-next-steps'); panel.id = 'policyImpactNextSteps';
    panel.append(node('h3', 'What needs clarification'),
      node('p', 'These next steps belong to this comparison of the two approved policies and the original reviewed form. They do not describe an unchecked revision in the editor.', 'subtle'));
    const questions = node('section', ''); questions.id = 'policyImpactPolicyQuestions'; questions.tabIndex = -1;
    questions.append(node('h4', 'Policy owner: decide the unresolved rules'));
    if (!r.unknownSlots.length) questions.append(node('p', 'No unknown target/property slots were reported in this comparison. The bounded review limits still apply.'));
    for (const slot of r.unknownSlots) {
      const card = node('section', '', 'policy-impact-change');
      const side = slot.newRulePresent ? 'old' : 'new', disposition = slot[`${side}Disposition`];
      card.append(node('h5', `${label(r, slot.field)} / ${propertyLabel(slot.property)} (${slot.field}/${slot.property})`),
        node('p', `Under the ${side} policy, when should ${label(r, slot.field)} be ${slot.property === 'visible' ? 'shown' : 'required'}?`, 'policy-next-question'));
      const followup = disposition?.reasonCode === 'not-stated'
        ? 'Should the policy state this rule, or explicitly leave it unspecified?'
        : disposition?.reasonCode === 'outside-grammar'
          ? 'Can this rule be expressed with the supported Boolean/choice conditions, or does it require a scope change?'
          : 'Which precise conditions define this rule? Can the declared drivers express them, or are additional inputs needed?';
      card.append(node('p', followup), node('p', `Recorded ${side}-review reason: ${disposition?.reason ?? 'No reviewed predicate or reason was supplied.'}`));
      const evidence = disposition?.evidence, policy = r.reviews[side].policyText;
      if (evidence) card.append(node('p', policy.slice(evidence.start, evidence.end), 'policy'));
      else card.append(node('p', 'No source excerpt was recorded for this disposition. No missing clause is inferred.', 'subtle'));
      const detail = node('details', ''); detail.append(node('summary', 'Both reviews and exact evidence identifiers'));
      for (const source of ['old', 'new']) {
        const d = slot[`${source}Disposition`], e = d?.evidence, review = r.reviews[source];
        detail.append(node('h6', `${source === 'old' ? 'Old' : 'New'} review`),
          node('p', slot[`${source}RulePresent`] ? 'A reviewed predicate is present on this side; the other side is unknown.' : `Recorded reason: ${d?.reason ?? 'No reviewed predicate or reason was supplied.'}`));
        if (e) detail.append(node('p', review.policyText.slice(e.start, e.end), 'policy'),
          node('p', `Policy character range [${e.start}, ${e.end}); excerpt SHA-256: ${e.quoteSha256 ?? 'not supplied'}.`, 'hash-line'));
        else if (!slot[`${source}RulePresent`]) detail.append(node('p', 'No source excerpt was recorded.'));
        detail.append(node('p', `Policy SHA-256: ${review.policyTextSha256 ?? 'not supplied'}. Specification SHA-256: ${review.specificationSha256}. Approval SHA-256: ${review.review?.approvalHash ?? 'not supplied'}.`, 'hash-line'));
      }
      card.append(detail, node('p', `This is a question for a future decision. The unresolved ${side}-review slot remains unknown in this comparison. Preserve both original approvals; any clarified interpretation needs a fresh review.`, 'coverage-caution'));
      questions.append(card);
    }
    panel.append(questions);
    const developer = node('section', ''); developer.id = 'policyImpactDeveloperActions';
    developer.append(node('h4', 'Developer: revise the known form differences'));
    const list = node('ul', '');
    // Use computed scenario comparisons, not just changed predicates. This also
    // retains known discrepancies unrelated to the amendment, without promoting
    // hidden requiredness checks or unknown slots into implementation requests.
    for (const field of r.fields.filter(item => item.role === 'target')) for (const property of ['visible', 'required']) {
      const key = `${field.name}/${property}`;
      const differs = r.scenarios.filter(row => Object.hasOwn(row.slots, key)
        && ['changed', 'unchanged'].includes(row.slots[key].status)
        && row.slots[key].comparison === 'differs-from-new'
        && (property !== 'required' || row.slots[key].currentVisible));
      if (!differs.length) continue;
      const changed = differs.filter(row => row.slots[key].status === 'changed').length;
      list.append(node('li', `${field.label} / ${propertyLabel(property)} (${key}): differs from the new reviewed expectation in ${differs.length} of ${r.summary.declaredScenarios} declared combinations (${changed} with a changed policy expectation; ${differs.length - changed} with an unchanged expectation).`));
    }
    if (list.children.length) {
      developer.append(list, node('p', 'Inspect these target expressions, revise the form yourself, then explicitly recheck with the current new approval. Any unknown rules above need a policy decision first. No form is edited or checked by this panel.'));
      const go = node('button', 'Go to revised-form editor', 'secondary'); go.id = 'policyImpactRevisionEditor'; go.type = 'button';
      go.addEventListener('click', () => {
        if (expireRetainedSelection() || expireResult()) {render(); return;}
        if (result !== r || !ready() || currentKey(view) !== binding || view?.busy || controller || reading) return;
        const editor = $('recheckFormText');
        if (!editor || editor.disabled || editor.closest('[hidden]')) return;
        $('reviewNavigation').open = false; editor.focus({preventScroll: true}); editor.scrollIntoView?.({block: 'start', behavior: 'instant'});
      });
      developer.append(go);
    } else developer.append(node('p', 'No comparable current-form differences were reported. Do not invent an implementation change for an unknown rule or a skipped hidden-target requiredness check.'));
    developer.append(node('p', `Compared original form SHA-256: ${r.currentForm.hashes?.formTextSha256 ?? 'not supplied'}. Editor changes require a separate recheck; they do not change this comparison.`, 'hash-line subtle'));
    panel.append(developer); return panel;
  }
  function expectationLine(property, state) {
    return `Old expectation: ${flag(property, state.oldExpected)} → New expectation: ${flag(property, state.newExpected)} → Current form: ${flag(property, state.currentFormBehavior)}${property === 'required' && !state.currentVisible ? ' (target hidden; native requiredness check skipped)' : ''}.`;
  }
  function ruleEvidence(change) {
    const detail = node('details', ''); detail.append(node('summary', 'Exact source excerpts for this changed rule'));
    for (const side of ['old', 'new']) detail.append(node('h6', `${side === 'old' ? 'Old' : 'New'} exact source excerpt`), node('p', change[`${side}Rule`].source.quote, 'policy'));
    return detail;
  }
  // Presentation-only lookup. No predicate evaluation, native execution or invented rows.
  function declaredScenario(r, selection) {
    const inputs = drivers(r), targets = r.fields.filter(field => field.role === 'target');
    if (!inputs.length || inputs.length > 6 || !Array.isArray(r.scenarios) || r.scenarios.length > 256
      || new Set(inputs.map(field => field.name)).size !== inputs.length) return null;
    const domain = field => field.kind === 'boolean' ? [false, true]
      : field.kind === 'choice' && Array.isArray(field.values) && field.values.length >= 2 && field.values.length <= 8
        && field.values.every(value => typeof value === 'string') && new Set(field.values).size === field.values.length ? field.values : null;
    if (Object.keys(selection).length !== inputs.length || inputs.some(field => !Object.hasOwn(selection, field.name)
      || !domain(field)?.some(value => value === selection[field.name]))) return null;
    const matches = r.scenarios.filter(row => row && row.answers && Object.keys(row.answers).length === inputs.length
      && inputs.every(field => Object.hasOwn(row.answers, field.name) && row.answers[field.name] === selection[field.name]));
    if (matches.length !== 1) return null;
    const row = matches[0], keys = targets.flatMap(field => ['visible', 'required'].map(property => `${field.name}/${property}`));
    if (!row.slots || Object.keys(row.slots).length !== keys.length || keys.some(key => {
      const state = row.slots[key], visibility = row.slots[key.replace(/\/required$/, '/visible')];
      return !Object.hasOwn(row.slots, key) || !state || !['changed', 'unchanged', 'unknown'].includes(state.status)
        || ![true, false, null].includes(state.oldExpected) || ![true, false, null].includes(state.newExpected)
        || typeof state.currentFormBehavior !== 'boolean' || typeof state.currentVisible !== 'boolean'
        || !visibility || state.currentVisible !== visibility.currentFormBehavior
        || !['matches-new', 'differs-from-new', 'unknown', 'skipped-hidden-target'].includes(state.comparison)
        || (state.status === 'unknown' ? state.comparison !== 'unknown'
            || state.oldExpected !== null && state.newExpected !== null
          : state.oldExpected === null || state.newExpected === null
            || (state.oldExpected === state.newExpected ? state.status !== 'unchanged' : state.status !== 'changed')
            || state.comparison !== (key.endsWith('/required') && !state.currentVisible ? 'skipped-hidden-target'
              : state.currentFormBehavior === state.newExpected ? 'matches-new' : 'differs-from-new'));
    })) return null;
    return row;
  }
  function renderScenarioExplorer(r) {
    const panel = node('section', '', 'policy-scenario-explorer'); panel.id = 'policyImpactScenarioExplorer';
    panel.append(node('h3', 'Inspect any declared request'),
      node('p', 'Choose a complete combination of the declared answers to inspect its already-computed result. This is a synthetic scenario, not a real request, a fresh execution or a check of the revised-form editor.', 'subtle'));
    const fields = drivers(r), controls = node('fieldset', '', 'policy-scenario-controls');
    controls.append(node('legend', 'Request answers'));
    const selected = new Map(), initial = r.changedSlots[0]?.answers ?? r.scenarios[0]?.answers;
    let validControls = fields.length > 0 && fields.length <= 6;
    fields.forEach((field, index) => {
      const values = field.kind === 'boolean' ? [false, true] : field.kind === 'choice' && Array.isArray(field.values) ? field.values : [];
      if (values.length < 2 || values.length > 8 || values.some(value => field.kind === 'boolean' ? typeof value !== 'boolean' : typeof value !== 'string')
        || new Set(values).size !== values.length) validControls = false;
      const control = node('label', field.label || field.name), select = node('select', '');
      select.id = `policyImpactScenarioDriver-${index}`; control.htmlFor = select.id;
      values.forEach((value, position) => {const option = node('option', answerText(value)); option.value = String(position); select.append(option);});
      const first = values.findIndex(value => value === initial?.[field.name]); select.value = String(first < 0 ? 0 : first);
      selected.set(field.name, {select, values}); control.append(select); controls.append(control);
      select.addEventListener('change', display);
    });
    const status = node('p', '', 'policy-scenario-status'); status.id = 'policyImpactScenarioStatus';
    status.setAttribute?.('role', 'status'); status.setAttribute?.('aria-live', 'polite');
    const body = node('div', '', 'policy-scenario-outcomes'); body.id = 'policyImpactScenarioOutcomes';
    const source = node('details', '', 'policy-scenario-source');
    source.append(node('summary', 'This scenario’s separate approvals and compared form'),
      node('p', `Old approved specification: ${r.reviews.old.specificationSha256}. Old approval: ${r.reviews.old.review?.approvalHash ?? 'not supplied'}. New approved specification: ${r.reviews.new.specificationSha256}. New approval: ${r.reviews.new.review?.approvalHash ?? 'not supplied'}. Compared original form: ${r.currentForm.hashes?.formTextSha256 ?? 'not supplied'}. Original approval attribution and scope remain in the comparison details.`, 'hash-line subtle'));
    panel.append(controls, status, body, source);
    function display(event) {
      if (event && !panel.isConnected) return;
      if (expireRetainedSelection() || expireResult()) {render(); return;}
      if (result !== r || !ready() || currentKey(view) !== binding) return;
      body.replaceChildren();
      const selection = Object.create(null);
      let valid = validControls;
      for (const [name, {select, values}] of selected) {
        const position = Number(select.value);
        if (!/^(0|[1-9][0-9]*)$/.test(select.value) || !Number.isSafeInteger(position) || position >= values.length) valid = false;
        else selection[name] = values[position];
      }
      const row = valid ? declaredScenario(r, selection) : null;
      if (!row) {status.textContent = 'No unique recorded result matches this complete declared combination. No behavior is inferred.'; status.className = 'error'; return;}
      const states = Object.values(row.slots), changed = states.filter(state => state.status === 'changed').length;
      const unknown = states.filter(state => state.status === 'unknown').length;
      const mismatch = states.filter(state => state.comparison === 'differs-from-new').length;
      status.className = unknown ? 'coverage-caution policy-scenario-status' : 'policy-scenario-status';
      status.textContent = `Selected scenario: ${changed} changed rule slot${changed === 1 ? '' : 's'}, ${mismatch} compared form difference${mismatch === 1 ? '' : 's'}, ${unknown} unknown rule slot${unknown === 1 ? '' : 's'}. ${unknown ? 'Partial interpretation; unknown does not mean unchanged or passing.' : 'Only declared covered behavior is represented; other review limits still apply.'}`;
      for (const field of r.fields.filter(item => item.role === 'target')) {
        const card = node('section', '', 'policy-scenario-target'); card.append(node('h4', field.label || field.name));
        for (const property of ['visible', 'required']) {
          const state = row.slots[`${field.name}/${property}`];
          card.append(node('h5', propertyLabel(property)), node('p', expectationLine(property, state)));
          const explanation = state.status === 'unknown' ? 'Unknown: at least one review lacks a predicate. No agreement or passing outcome is inferred.'
            : state.comparison === 'skipped-hidden-target' ? `${state.status === 'changed' ? 'Changed' : 'Unchanged'} reviewed predicate. Native requiredness comparison was skipped because the target is hidden.`
              : `${state.status === 'changed' ? 'Changed' : 'Unchanged'} reviewed predicate. ${state.comparison === 'differs-from-new' ? 'The compared original form differs from the new expectation.' : 'The compared original form matches the new expectation for this slot.'}`;
          card.append(node('p', explanation, state.status === 'unknown' ? 'coverage-caution' : 'subtle'));
        }
        body.append(card);
      }
    }
    display(); return panel;
  }
  // Presentation joins only already-computed rows and witnesses. No predicate evaluation.
  function renderProfileComparison(r) {
    const comparisons = [];
    for (const change of r.changedSlots) {
      const neighbor = change.unchangedNeighbor;
      let entry = comparisons.find(item => sameAnswers(r, item.change.answers, change.answers)
        && (!item.change.unchangedNeighbor && !neighbor || item.change.unchangedNeighbor && neighbor && sameAnswers(r, item.change.unchangedNeighbor.answers, neighbor.answers)));
      if (!entry) {entry = {change, anchors: []}; comparisons.push(entry);}
      entry.anchors.push(change);
    }
    if (!comparisons.length) return null;
    const panel = node('section', '', 'policy-profile-comparison');
    panel.append(node('h3', 'Compare these two request profiles'),
      node('p', 'Illustrative, synthetic request profiles from the declared answers. These are not observed requests or evidence of human validation.'),
      node('p', `${comparisons.length} example comparison${comparisons.length === 1 ? ' covers' : 's cover'} ${r.changedSlots.length} changed outcome group${r.changedSlots.length === 1 ? '' : 's'}. Each group has an engine-selected witness; this is not a list of every affected person or request.`, 'subtle'));
    if (['old', 'new'].every(side => r.reviews[side].provenance.actor.kind === 'agent-simulation')) panel.append(node('p', 'Both approvals declare agent-simulation reviews. This authored review example is not independent human validation or evidence of model extraction.', 'subtle'));
    const control = node('label', `Choose an example comparison (${comparisons.length})`), select = node('select', ''); select.id = 'policyImpactProfileSelect'; control.htmlFor = select.id;
    comparisons.forEach((entry, index) => {const option = node('option', `Example ${index + 1}: ${[...new Set(entry.anchors.map(change => label(r, change.field)))].join(', ')}`); option.value = String(index); select.append(option);});
    selectedComparison = Math.min(selectedComparison, comparisons.length - 1); select.value = String(selectedComparison);
    control.append(select); panel.append(control);
    const body = node('div', '', 'policy-profile-body'); panel.append(body);
    function display() {
      body.replaceChildren();
      const entry = comparisons[selectedComparison], change = entry.change, nearby = change.unchangedNeighbor;
      const changed = scenarioFor(r, change.answers), neighbor = nearby ? scenarioFor(r, nearby.answers) : null;
      const different = nearby ? drivers(r).filter(field => change.answers[field.name] !== nearby.answers[field.name]) : [];
      body.append(node('p', `Example ${selectedComparison + 1} of ${comparisons.length}. ${nearby ? `${different.length} answer${different.length === 1 ? ' differs' : 's differ'}: ${different.map(field => field.label).join(', ')}. ${different.length < drivers(r).length ? 'All other declared answers match.' : 'No declared answer is held the same.'}` : 'No unchanged assignment exists for the selected target/property; no contrast is invented.'}`, 'policy-profile-difference'));
      const pair = node('div', '', 'policy-profile-pair');
      for (const [title, row] of [['Changed request profile', changed], ['Nearby request profile', neighbor]]) {
        const card = node('section', '', 'policy-profile-answers'); card.append(node('h4', title));
        if (row) {
          const list = node('ul', '');
          for (const field of drivers(r)) {const differs = different.some(item => item.name === field.name); list.append(node('li', `${field.label}: ${answerText(row.answers[field.name])}${differs ? ' · Different answer' : ''}`, differs ? 'policy-profile-answer-different' : ''));}
          card.append(list);
          const changedQuestions = new Set(changedEntries(row).map(([key]) => key.split('/')[0])).size;
          const unknown = Object.values(row.slots).filter(state => state.status === 'unknown').length;
          card.append(node('p', `${changedQuestions} affected question${changedQuestions === 1 ? '' : 's'}; ${unknown} unknown rule slot${unknown === 1 ? '' : 's'}.`, unknown ? 'coverage-caution' : 'subtle'));
        } else card.append(node('p', 'No nearby unchanged example is available for this target/property.'));
        pair.append(card);
      }
      body.append(pair);
      if (nearby) body.append(node('p', `Nearest unchanged neighbor for: ${entry.anchors.map(item => `${label(r, item.field)} / ${propertyLabel(item.property)}`).join('; ')}. “Unchanged” applies only to these named rules, not a whole-form pass. Any other changed or unknown slots are shown below.`, 'subtle'));
      body.append(node('h4', 'Who changes? Smallest sufficient conditions'));
      for (const anchor of entry.anchors) {
        const conditions = node('div', '', 'policy-profile-conditions');
        conditions.append(node('p', `${label(r, anchor.field)} / ${propertyLabel(anchor.property)}`), answers(anchor.minimalAnswers, r.fields));
        const omitted = drivers(r).filter(field => !Object.hasOwn(anchor.minimalAnswers, field.name));
        conditions.append(node('p', `${anchor.guaranteedCompletions} complete declared profiles share this old/new/current direction.${omitted.length ? ` ${omitted.map(field => field.label).join(', ')} ${omitted.length === 1 ? 'is' : 'are'} not needed for this changed outcome; any declared value is allowed.` : 'All declared answers are constrained.'}`, 'subtle'));
        body.append(conditions);
      }
      function affected(row, title, other) {
        const groups = new Map();
        for (const [key, state] of changedEntries(row)) {const [field, property] = key.split('/'); if (!groups.has(field)) groups.set(field, []); groups.get(field).push({field, property, state});}
        const section = node('section', '', 'policy-profile-affected'); section.append(node('h4', `${title}: ${groups.size} affected question${groups.size === 1 ? '' : 's'}`));
        if (!groups.size) section.append(node('p', 'No known rule changes here. Unknown slots still need review.'));
        for (const [field, slots] of groups) {
          const card = node('section', '', 'policy-impact-change'); card.append(node('h5', label(r, field)));
          for (const {property, state} of slots) {
            card.append(node('p', `${propertyLabel(property)} · ${expectationLine(property, state)}`, 'policy-profile-expectation'));
            card.append(node('p', state.comparison === 'differs-from-new' ? 'The current form needs an update for this change.' : state.comparison === 'matches-new' ? 'The current form already matches the new expectation here.' : 'The required predicate changed; the current target is hidden, so this native requiredness comparison is skipped.'));
            if (other) {const otherState = other.slots[`${field}/${property}`]; card.append(node('p', `Nearby profile · ${propertyLabel(property)} (${otherState.status}): ${expectationLine(property, otherState)}`, 'subtle'));}
            const evidence = r.changedSlots.find(item => item.field === field && item.property === property);
            card.append(ruleEvidence(evidence));
          }
          section.append(card);
        }
        body.append(section);
      }
      affected(changed, 'What changes in the changed request profile?', neighbor);
      // A nearest neighbor is unchanged for its anchor only; expose all its other deltas.
      if (neighbor && changedEntries(neighbor).length) affected(neighbor, 'Other changes in the nearby request profile', null);
      const stays = node('section', '', 'policy-profile-unchanged'); stays.append(node('h4', 'What stays the same?'));
      for (const [title, row] of [['Changed request profile', changed], ['Nearby request profile', neighbor]]) if (row) {
        const list = node('ul', ''), unchanged = Object.entries(row.slots).filter(([, state]) => state.status === 'unchanged');
        stays.append(node('h5', title));
        for (const [key, state] of unchanged) {const [field, property] = key.split('/'); list.append(node('li', `${label(r, field)} / ${propertyLabel(property)} · ${expectationLine(property, state)}`));}
        if (!unchanged.length) list.append(node('li', 'No comparable rule is unchanged in this profile.'));
        stays.append(list);
      }
      body.append(stays);
      const unknown = node('section', '', 'coverage-caution policy-profile-unknown'); unknown.append(node('h4', 'What remains unknown?'));
      if (!r.unknownSlots.length) unknown.append(node('p', 'Both reviews cover every declared target/property slot. The bounded exclusions still apply.'));
      for (const slot of r.unknownSlots) {
        unknown.append(node('h5', `${label(r, slot.field)} / ${propertyLabel(slot.property)}`), node('p', `Unknown in ${neighbor ? 'both displayed profiles' : 'this displayed profile'}. No old/new equality or passing outcome is inferred.`));
        for (const side of ['old', 'new']) {
          const disposition = slot[`${side}Disposition`], evidence = disposition?.evidence;
          unknown.append(node('p', `${side === 'old' ? 'Old' : 'New'} review: ${slot[`${side}RulePresent`] ? 'predicate present, but the other review has no comparable predicate' : disposition?.reason ?? 'no reviewed predicate'}.`));
          if (evidence) {const detail = node('details', ''); detail.append(node('summary', `${side === 'old' ? 'Old' : 'New'} exact unresolved source excerpt`), node('p', r.reviews[side].policyText.slice(evidence.start, evidence.end), 'policy')); unknown.append(detail);}
        }
      }
      body.append(unknown);
    }
    select.addEventListener('change', () => {const next = Number(select.value); if (Number.isSafeInteger(next) && next >= 0 && next < comparisons.length) {selectedComparison = next; display();}});
    display(); return panel;
  }
  function renderResult() {
    // Ordinary view updates must retain the focused result node and open details.
    // Refocusing a replacement would trigger the workspace's focus-clearance scroll.
    if (renderedResult === result) return false;
    const area = $('policyImpactResults'), summary = $('policyImpactSummary');
    area.replaceChildren(); summary.replaceChildren(); summary.hidden = !result;
    if (!result) {renderedResult = null; return true;}
    const r = result, s = r.summary;
    const decision = decisionSummaryData(r);
    if (!decision.available) {
      const heading = node('h3', 'Comparison details unavailable'); heading.id = 'policyImpactResultHeading'; heading.tabIndex = -1;
      summary.append(heading, renderDecisionSummary(r, decision));
      area.append(node('p', 'Detailed comparison actions are withheld because the recorded evidence is incomplete or inconsistent. Clear this comparison and review its sources again.', 'coverage-caution'));
      renderedResult = result; return true;
    }
    const affectedQuestions = new Set(r.changedSlots.map(change => change.field)).size, unknownSlots = r.unknownSlots.length;
    const heading = node('h3', `${s.changedScenarios} of ${s.declaredScenarios} declared scenarios change`);
    heading.id = 'policyImpactResultHeading'; heading.tabIndex = -1;
    summary.append(heading,
      node('p', `${affectedQuestions} affected question${affectedQuestions === 1 ? '' : 's'} · ${unknownSlots} unknown rule slot${unknownSlots === 1 ? '' : 's'}. Counts are combinations of declared answers, not people or traffic.`),
      renderDecisionSummary(r, decision),
      node('p', `Compared approved specifications: old ${r.reviews.old.specificationSha256.slice(0, 12)} → new ${r.reviews.new.specificationSha256.slice(0, 12)}. Short SHA-256 identifiers; full identifiers are in the approval details below.`, 'hash-line policy-impact-identity'),
      node('p', `${s.fullyUnchangedScenarios} whole scenarios are fully unchanged. ${s.noKnownChangeButUnknownScenarios} have no known change but remain unknown. ${s.scenariosWithUnknownSlots} contain an unknown slot, including any overlapping changed scenarios. Unknown never means unchanged or passing.`, 'coverage-caution'));
    area.append(renderNextSteps(r), node('p', `${s.changedScenariosNeedingFormUpdate} changed scenarios need a current-form update. Each scenario is counted once, even when several target predicates change.`));
    area.append(renderScenarioExplorer(r));
    const comparison = renderProfileComparison(r); if (comparison) area.append(comparison);
    const policy = node('details', ''); policy.append(node('summary', 'Old and new reviewed policies'));
    for (const side of ['old', 'new']) policy.append(node('h4', `${side === 'old' ? 'Old' : 'New'} reviewed policy`), node('p', r.reviews[side].policyText, 'policy'));
    area.append(policy);
    const allChanges = node('details', ''); allChanges.append(node('summary', `All changed outcomes and full reviewed evidence (${r.changedSlots.length} groups)`));
    for (const change of r.changedSlots) {
      const card = node('section', '', 'policy-impact-change'), title = r.fields.find(f => f.name === change.field)?.label ?? change.field;
      card.append(node('h4', `${title} · ${change.property}`),
        node('p', `Old approved predicate: ${flag(change.property, change.oldExpected)}. New approved predicate: ${flag(change.property, change.newExpected)}. Current reviewed form: ${flag(change.property, change.currentFormBehavior)}${change.property === 'required' && !change.currentVisible ? ' (target hidden; native requiredness check skipped)' : ''}.`),
        node('p', change.comparison === 'differs-from-new' ? 'The current form needs an update for this change.' : change.comparison === 'matches-new' ? 'The current form already matches the new expectation here.' : 'The required predicate changed; the current target is hidden, so this native requiredness comparison is skipped.'),
        node('h5', 'Smallest sufficient changed scenario'), answers(change.minimalAnswers, r.fields),
        node('p', `${Object.keys(change.minimalAnswers).length} driver constraints guarantee this old/new/current direction across ${change.guaranteedCompletions} complete declared scenarios. Omitted drivers may take any declared value.`),
        node('h5', 'Nearest unchanged neighbor'));
      if (change.unchangedNeighbor) {
        const neighbor = change.unchangedNeighbor;
        card.append(answers(neighbor.answers, r.fields), node('p', `Both approved predicates: ${flag(change.property, neighbor.expected)}. Current form: ${flag(change.property, neighbor.currentFormBehavior)}${change.property === 'required' && !neighbor.currentVisible ? ' (hidden; requiredness check skipped)' : ''}.`));
      } else card.append(node('p', 'No unchanged assignment exists for this target/property.'));
      card.append(node('p', 'Unchanged applies only to this target/property. Other slots can be unknown or changed; this is not a whole-form pass.', 'subtle'));
      const detail = node('details', ''); detail.append(node('summary', 'Complete reproduction and reviewed evidence'), answers(change.answers, r.fields),
        node('h5', 'Old exact source excerpt'), node('p', change.oldRule.source.quote, 'policy'), node('pre', JSON.stringify(change.oldRule.condition, null, 2)),
        node('h5', 'New exact source excerpt'), node('p', change.newRule.source.quote, 'policy'), node('pre', JSON.stringify(change.newRule.condition, null, 2)));
      if (change === r.changedSlots[0]) {detail.id = 'policyImpactSummaryWitness'; detail.tabIndex = -1;}
      card.append(detail); allChanges.append(card);
    }
    if (r.changedSlots.length) area.append(allChanges);
    if (!r.changedSlots.length) area.append(node('p', 'No changed expectation was found in comparable slots. Review unknown slots before drawing a broader conclusion.'));
    area.append(node('h4', 'Still unknown'));
    for (const slot of r.unknownSlots) area.append(node('p', `${slot.field} / ${slot.property}. Old review: ${slot.oldRulePresent ? 'predicate present' : slot.oldDisposition?.reason ?? 'no reviewed predicate'}. New review: ${slot.newRulePresent ? 'predicate present' : slot.newDisposition?.reason ?? 'no reviewed predicate'}. No old/new equality or passing outcome is inferred.`));
    if (!r.unknownSlots.length) area.append(node('p', 'Both reviews cover every declared target/property slot. The bounded exclusions still apply.'));
    area.append(node('p', `${s.scenariosWithCurrentFormDiscrepancy} declared scenarios differ from a comparable new predicate, including differences unrelated to this amendment. Manually revise the affected target logic, then use “Check your form changes” with this new approval. No form is changed automatically.`));
    const provenance = node('details', ''); provenance.append(node('summary', 'Separate approvals, exact current form and limits'));
    for (const side of ['old', 'new']) provenance.append(node('h4', `${side === 'old' ? 'Old' : 'New'} approval`),
      node('p', r.reviews[side].provenance.actor.claim), node('pre', JSON.stringify(r.reviews[side], null, 2)));
    for (const limit of r.limitations) provenance.append(node('p', limit));
    provenance.append(node('pre', JSON.stringify(r.currentForm, null, 2))); area.append(provenance);
    renderedResult = result; return true;
  }
  function render() {
    expireRetainedSelection();
    expireResult();
    const active = document.activeElement, resultFocus = $('policyImpactResults').contains?.(active);
    const summaryFocus = $('policyImpactSummary').contains?.(active);
    $('policyImpactPanel').hidden = !snapshot()?.suppliedInput;
    $('policyImpactFile').disabled = !ready() || !supported();
    const retained = retainedPrior();
    if ($('policyImpactRetained')) {
      $('policyImpactRetained').hidden = !retained;
      $('policyImpactRetainedLabel').textContent = retained
        ? `Old: retained approved practice review. Specification ${retained.specificationSha256}. Approval ${retained.approvalHash}.` : '';
      $('policyImpactUseRetained').disabled = !retained || !ready() || !supported() || !!view?.busy || reading || !!controller;
    }
    $('policyImpactRun').disabled = !ready() || !supported() || !!view?.busy || reading || !!controller || oldText === null;
    $('policyImpactCancel').disabled = !controller && !reading && oldText === null && !result && !retained;
    $('policyImpactStatus').textContent = message || (!ready() ? 'Independently review and approve the new policy above before comparing.' : !supported() ? 'This comparison supports only Boolean/choice fields and at most 256 complete declared scenarios.' : 'Choose the prior policy’s approved specification. It will be validated independently when you compare.');
    $('policyImpactStatus').className = error ? 'error' : 'subtle';
    const rebuilt = renderResult();
    if (rebuilt && summaryFocus && !$('policyImpactPanel').hidden) ($('policyImpactResultHeading') ?? $('policyImpactStatus')).focus({preventScroll: true});
    else if (rebuilt && resultFocus && !$('policyImpactPanel').hidden) $('policyImpactStatus').focus();
  }
  function revealCompletedResult() {
    const heading = $('policyImpactResultHeading');
    if (!heading || $('policyImpactPanel').hidden || $('policyImpactSummary').hidden) return;
    // The user explicitly requested this result. Collapse the sticky navigation,
    // use its existing focus-clearance/scroll margin, and never animate the jump.
    // Instant scrolling also respects reduced-motion preferences.
    $('reviewNavigation').open = false;
    heading.focus({preventScroll: true});
    heading.scrollIntoView?.({block: 'start', behavior: 'instant'});
  }
  function reset() {retire('', false, true); view = null; binding = ''; render();}
  window.formRehearsalPolicyImpact = Object.freeze({
    reset,
    update(value) {
      const key = currentKey(value);
      if (key !== binding) {retire('', false, true); binding = key;}
      view = value; render();
    },
  });
  $('policyImpactFile').addEventListener('change', async () => {
    if ($('policyImpactFile').disabled) return;
    const file = $('policyImpactFile').files?.[0];
    retire(file ? 'Reading the selected prior specification…' : 'File selection cancelled. Choose the prior approval again.', false, true);
    if (!file) {render(); return;}
    const token = epoch; reading = true; render();
    try {
      if (file.size > 1048576) throw new Error('Choose an approved specification of at most 1 MiB.');
      const bytes = await file.arrayBuffer(); if (token !== epoch) return;
      if (bytes.byteLength > 1048576) throw new Error('The selected file exceeds 1 MiB.');
      oldText = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(bytes); oldName = file.name || 'Selected prior specification';
      message = `${oldName} loaded. Compare explicitly to validate both approvals and see changed scenarios.`;
    } catch (failure) {if (token !== epoch) return; oldText = null; message = 'File not loaded: ' + failure.message; error = true;}
    reading = false; $('policyImpactFile').value = ''; render();
  });
  $('policyImpactFile').addEventListener('cancel', () => {retire('File selection cancelled. Choose the prior approval again.', false, true); render();});
  $('policyImpactUseRetained')?.addEventListener('click', () => {
    if ($('policyImpactUseRetained').disabled || !ready()) return;
    const retained = retainedPrior();
    if (!retained) {retire('The retained practice review expired. Start practice again.', false, true); discardRetainedPrior(); render(); return;}
    retire('', false, true);
    retainedSelection = {...retained};
    oldText = retained.text; oldName = 'Retained approved practice review';
    message = 'Old: retained approved practice review. Compare explicitly to independently validate both specifications and the current form context.';
    render();
  });
  $('policyImpactCancel').addEventListener('click', () => {retire('Comparison cleared. A cancelled request cannot restore its result. Select a prior approval to compare again.', false, true); discardRetainedPrior(); render();});
  $('policyImpactRun').addEventListener('click', async () => {
    if (expireRetainedSelection()) {render(); return;}
    if ($('policyImpactRun').disabled) return;
    retire('Comparing both approved policies against the exact current reviewed form…');
    const token = epoch, pin = binding, s = snapshot(), prior = oldText;
    const owner = new AbortController(); controller = owner; render();
    const initiatingInteraction = interactionRevision; let completed = false;
    const timer = setTimeout(() => {if (controller === owner) {retire('Comparison timed out. No result is available. Retry explicitly after the local worker stops.', true); render();}}, 65000);
    try {
      const body = JSON.stringify({sessionId: s.sessionId, expectedRevision: s.revision, approvalHash: s.approval.approvalHash, oldSpecificationText: prior});
      if (new TextEncoder().encode(body).length > 2 * 1024 * 1024) throw new Error('Comparison request exceeds the 2 MiB limit.');
      const response = await fetch('/api/review/policy-impact', {method: 'POST', headers: {'Content-Type': 'application/json'}, body, signal: owner.signal});
      const data = await response.json();
      if (token !== epoch || pin !== binding || controller !== owner || !ready()) return;
      if (expireRetainedSelection()) {render(); return;}
      if (!response.ok) throw new Error(data.error || `Local comparison failed (${response.status}).`);
      if (data.sessionId !== s.sessionId || data.revision !== s.revision || data.approvalHash !== s.approval.approvalHash || !Number.isFinite(data.sourceExpiresAt) || Date.now() >= data.sourceExpiresAt) throw new Error('Comparison did not match the current approval or its lifetime.');
      if (data.status === 'invalid') throw new Error(data.error);
      if (data.status !== 'complete' || data.result?.kind !== 'formrehearsal-policy-change-impact') throw new Error('No complete comparison result was returned.');
      result = data.result; message = 'Policy comparison complete for these two approvals and the exact current reviewed form.';
      completed = true;
      resultExpiresAt = Math.min(data.sourceExpiresAt, retainedSelection?.expiresAt ?? Infinity);
      expiryTimer = setTimeout(() => {retire('The source review lifetime elapsed. Confirm or start a fresh review before comparing again.', false, true); discardRetainedPrior(); render();}, Math.max(1, resultExpiresAt - Date.now()));
    } catch (failure) {if (token !== epoch || pin !== binding || controller !== owner) return; message = 'No comparison result: ' + failure.message; error = true; result = null;}
    finally {clearTimeout(timer); if (controller === owner) {controller = null; render();
      // Background refreshes, local profile changes and abandoned requests do
      // not navigate. New user input cancels takeover, with no delayed jump on release.
      if (completed && initiatingInteraction === interactionRevision && document.visibilityState !== 'hidden') revealCompletedResult();
    }}
  });
  window.addEventListener('pagehide', reset);
  window.addEventListener('pageshow', event => {if (event.persisted) reset();});
  window.addEventListener('visibilitychange', () => {if (document.visibilityState !== 'hidden') render();});
})();
