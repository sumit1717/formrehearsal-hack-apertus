// This view uses same-origin APIs. Recorded review is the keyless default;
// live inference requires one explicit action and a server-owned bounded budget.
// Server validation and input hashes remain authoritative; typing invalidates the
// local view immediately, even while an earlier server action is in flight.
const $ = id => document.getElementById(id);
const element = (tag, value = '', className = '') => {
  const node = document.createElement(tag);
  node.textContent = value;
  if (className) node.className = className;
  return node;
};
const json = value => JSON.stringify(value, null, 2);
const fmt = value => typeof value === 'boolean' ? (value ? 'yes' : 'no') : String(value);
const propertyState = (property, value) => property === 'visible'
  ? (value ? 'Visible' : 'Hidden') : (value ? 'Required' : 'Optional');
const releasedInputIds = new Set(), releasedInputLeases = new Set(), releasedSessionIds = new Set();
let inputLeaseId = null, inputLeaseOrder = null, inputReleaseEpoch = 0;
const releasedLeaseOrder = new Map(), inputReleaseEvents = new Map(), unknownOrderReleaseEvents = new Map();
const validLeaseOrder=value=>typeof value?.leaseEpoch==='string'&&value.leaseEpoch.length>0&&Number.isSafeInteger(value.leaseRevision)&&value.leaseRevision>0;
const orderKey=(inputId,order)=>inputId+'/'+order.leaseEpoch;
const admissionReleased=(inputId,order)=>validLeaseOrder(order)&&order.leaseRevision<=(releasedLeaseOrder.get(orderKey(inputId,order))??0);
function assertUnreleasedReview(value){
  const sessionId=value?.sessionId??value?.snapshot?.sessionId;
  if(sessionId&&releasedSessionIds.has(sessionId))throw Object.assign(new Error('This review was explicitly released; its delayed response cannot restore the draft, approval or results.'),{status:410,releasedReview:true});
}
let recordings = [], snapshot = null, dirty = false, selected = 0;
// Presentation state belongs only to this exact approved review. Never let a
// previous approval's collapsed evidence hide a newly edited/unapproved rule.
let ruleEvidenceApproval = null, ruleEvidenceNodes = new Map(), ruleEvidenceOpen = new Map();
function resetRuleEvidence() {
  ruleEvidenceApproval = null; ruleEvidenceNodes.clear(); ruleEvidenceOpen.clear();
}
function retainRuleDisclosure(details, key) {
  if (!key) return;
  details.id = key; details.children[0].id = `${key}-summary`;
  if (ruleEvidenceOpen.has(key)) details.open = ruleEvidenceOpen.get(key);
  ruleEvidenceNodes.set(key, details);
}
let generation = 0, navigation = 0, pending = null, startController = null;
let computationAttempt = null, computationControl = null, computationRecovery = false, computationMessage = '';
// A workspace may close while the user is still focused inside it.
const availableFocus = node => node && node.isConnected !== false && !node.hidden && !node.disabled && !node.closest?.('[hidden]');
const focusVisible = node => {if (availableFocus(node)) node.focus?.();};
function moveLoadingFocus(message) {
  const active = document.activeElement;
  const owns = active === $('reviewRetry') || active === $('reviewLoading') || active === $('startActorReview') || $('reviewWorkspace').contains?.(active);
  setLoading(message);
  if (owns) focusVisible($('reviewLoading'));
}
function finishLoadingFocus(failed = false) {
  if (document.activeElement === $('reviewLoading')) focusVisible($(failed ? 'reviewRetry' : 'reviewTitle'));
  if (!failed) $('reviewLoading').hidden = true;
}
function announceReviewView(sessionId) {
  if ($('reviewWorkspace').dataset.sessionId === sessionId) return;
  $('reviewWorkspace').dataset.sessionId = sessionId;
  window.dispatchEvent?.(new CustomEvent('review-view-changed', {detail: {sessionId}}));
}
let focusRevision = 0;
// Native focus scrolling may leave an already-visible control behind the sticky
// bar. Correct only a new focus entry, after disclosure/layout changes settle;
// ordinary scrolling remains free and never changes focus or review state.
function clearReviewFocus(target) {
  const nav = $('reviewNavigation');
  if (document.activeElement !== target || !availableFocus(target)
    || !$('reviewWorkspace').contains(target) || nav.contains(target)) return;
  const bar = nav.getBoundingClientRect(), control = target.getBoundingClientRect();
  if (!bar.width || !bar.height || bar.bottom <= 0 || bar.top >= window.innerHeight
    || !control.width || !control.height) return;
  const top = Math.max(0, bar.bottom) + 8, bottom = window.innerHeight - 8;
  if (bottom <= top) return;
  // A resized textarea may span the viewport with its caret already visible.
  // Re-aligning its top would move that caret offscreen; keep native placement
  // unless the entire oversized control is outside the usable region.
  if (control.height > bottom - top && control.top < bottom && control.bottom > top) return;
  let bounds = {top: control.top, bottom: control.bottom};
  // Include complete associated wording when it fits, especially attestations.
  // An oversized label/control must not scroll the focused control out of view.
  for (const label of target.labels ?? []) {
    const box = label.getBoundingClientRect();
    if (box.width && box.height) {
      bounds.top = Math.min(bounds.top, box.top); bounds.bottom = Math.max(bounds.bottom, box.bottom);
    }
  }
  if (bounds.bottom - bounds.top > bottom - top) bounds = control;
  const delta = bounds.top < top ? bounds.top - top
    : bounds.bottom > bottom ? Math.min(bounds.bottom - bottom, bounds.top - top) : 0;
  if (delta) window.scrollBy({top: delta, behavior: 'instant'});
}
let pendingFocusClearance = null, focusClearanceFrame = false;
const focusPointers = new Set();
function scheduleFocusClearance() {
  if (!pendingFocusClearance || focusClearanceFrame || focusPointers.size || !window.requestAnimationFrame) return;
  focusClearanceFrame = true;
  window.requestAnimationFrame(() => {
    focusClearanceFrame = false;
    if (focusPointers.size) return;
    const target = pendingFocusClearance; pendingFocusClearance = null;
    if (target) clearReviewFocus(target);
  });
}
// Never move a pointer activation target between press and release. A cancelled
// gesture/window blur drops the correction; Tab recovers a release lost outside.
window.addEventListener('pointerdown', event => { focusPointers.add(event.pointerId); }, true);
window.addEventListener('pointerup', event => { focusPointers.delete(event.pointerId); scheduleFocusClearance(); }, true);
window.addEventListener('pointercancel', event => { focusPointers.delete(event.pointerId); pendingFocusClearance = null; }, true);
window.addEventListener('blur', () => { focusPointers.clear(); pendingFocusClearance = null; });
window.addEventListener('keydown', event => { if (event.key === 'Tab') focusPointers.clear(); });
window.addEventListener('focusin', event => {
  focusRevision++;
  const target = event.target;
  pendingFocusClearance = $('reviewWorkspace').contains(target) && !$('reviewNavigation').contains(target) ? target : null;
  scheduleFocusClearance();
});
let replayMessage = null, exportMessage = null, currentError = '', recoveryDraft = null, stateUnconfirmed = false;
// The source choice survives refresh. An in-flight ID survives only for explicit
// state recovery; neither storage nor an enabled server ever starts inference.
const requestedSource = new URLSearchParams(location.search).get('source');
let source = ['live', 'new'].includes(requestedSource) ? requestedSource : 'recorded';
let liveConfig = null, liveConfigLoading = false, liveConfigError = false, configGeneration = 0;
let liveOperation = null, liveDismissal = null, liveMessage = '', liveMessageError = false;
let validatedInput = null, inputGeneration = 0, inputValidation = null;
let inputMessage = 'Paste all three inputs, then validate locally.', inputError = false;
const liveStorageKey = 'formrehearsal-live-unresolved-v1';
const isLive = () => source === 'live' || source === 'new';
const isNew = () => source === 'new';
const inputIdPattern = /^input-[a-f0-9]{64}$/;
const rawInputIds = ['policyText', 'formText', 'driverText'];
const rawInputs = () => Object.fromEntries(rawInputIds.map(id => [id, $(id).value]));
const equalRawInputs = (a, b) => rawInputIds.every(id => typeof a?.[id] === 'string' && a[id] === b?.[id]);
// This guided sequence holds only inert authored input and exact exported bytes.
// It never checks an attestation, supplies a disposition, or calls approval or
// extraction. The ordinary manual review and server validators stay authoritative.
let practice = null, practiceLoad = null, practiceEpoch = 0, practiceTimer = null, practiceMessage = '', reviewActivity = 0;
const practiceReviewPin = () => JSON.stringify([snapshot?.sessionId, snapshot?.revision, snapshot?.approval?.approvalHash]);
// While a preset is loading, any newer interaction with the current workspace
// wins, including disclosure/download controls that do not revise server state.
for (const type of ['input','change','click']) window.addEventListener(type, event => {
  if (practiceLoad && $('reviewWorkspace').contains(event.target)) reviewActivity++;
}, true);
const PRACTICE_TTL_MS = 30 * 60 * 1000;
const practiceInput = () => practice?.preset[practice.stage]?.input;
const practiceMatches = () => !!practice && Date.now() < practice.expiresAt && isNew()
  && equalRawInputs(practiceInput(), rawInputs());
function retainedPracticePrior() {
  if (!practiceMatches() || practice.stage !== 'amended' || !practice.retained
    || Date.now() >= practice.retained.expiresAt || !manualSession()
    || !equalRawInputs(snapshot?.suppliedInput?.rawInputs, practiceInput())) return null;
  return {...practice.retained};
}
// Read at the moment of an explicit load, not just at the last render. The
// practice lifetime begins before either review's inactivity lifetime.
function authoredPracticeRevision() {
  if (!practiceMatches() || practice.stage !== 'amended' || !manualSession()
    || !approved() || stateUnconfirmed || composition || pending || manualOperation
    || practiceLoad || computationBusy() || !equalRawInputs(snapshot.suppliedInput?.rawInputs, practiceInput())) return null;
  return {practiceEpoch, expiresAt: practice.expiresAt, sessionId: snapshot.sessionId,
    revision: snapshot.revision, approvalHash: snapshot.approval.approvalHash,
    inputId: snapshot.suppliedInput.inputId, rawInputs: {...practiceInput()},
    formText: practice.preset.revision.formText};
}
function renderPractice() {
  if (!$('practiceStart')) return;
  window.formRehearsalRecheck?.refreshPractice();
  const busy = !!practiceLoad || !!pending || !!manualOperation || !!inputValidation || computationBusy()
    || !!pendingLive() || !!liveOperation?.busy || !!liveDismissal;
  $('practiceStart').disabled = busy;
  $('practiceOwnInput').disabled = busy;
  $('practicePanel').hidden = !practice;
  $('practiceStatus').textContent = practiceMessage;
  if (!practice) return;
  const matches = practiceMatches(), old = practice.stage === 'old';
  if (old && practice.retained && (!matches || !approved() || stateUnconfirmed
    || snapshot.sessionId !== practice.retained.sessionId || snapshot.approval.approvalHash !== practice.retained.approvalHash)) practice.retained = null;
  $('practiceHeading').textContent = old ? '1. Review the old policy' : '3. Review the amended policy';
  $('practiceInstruction').textContent = old
    ? 'Source: authored synthetic practice. Loading these inputs is not validation or approval. After review and approval, use “Download approved specification” below, then return here to load the amendment.'
    : 'Source: separately authored amended draft. The previous review is retained only as an exact exported specification. This policy needs a new manual session, explicit disposition, both attestations and a separate approval. ' + practice.preset.change.dependency;
  $('practiceChange').textContent = old ? practice.preset.change.before : practice.preset.change.after;
  $('practiceDraft').textContent = practice.preset[practice.stage].draftText;
  $('practiceDraftLoad').disabled = busy || !matches || !manualEmpty() || !!composition || stateUnconfirmed;
  $('practiceAmendment').hidden = !old;
  $('practiceAmendment').disabled = busy || !matches || !old || !approved() || stateUnconfirmed || !practice.retained;
  $('practiceOldIdentity').textContent = practice.retained
    ? `Old: retained approved practice review. Approval ${practice.retained.approvalHash}. Specification ${practice.retained.specificationSha256}. Exact exported bytes are held only for this practice sequence.`
    : old && approved() ? `Old approval ${snapshot.approval.approvalHash}. Download its approved specification below before loading the amendment.` : 'No old approved specification retained.';
}
function resetPractice(message = '') {
  practiceEpoch++; practiceLoad?.controller.abort(); practiceLoad = null;
  clearTimeout(practiceTimer); practiceTimer = null; practice = null; practiceMessage = message;
  window.formRehearsalPolicyImpact?.reset(); renderPractice();
}
function validatePracticePreset(value) {
  if (value?.kind !== 'authored-equipment-practice-v1' || typeof value.source !== 'string'
    || !/^[a-f0-9]{64}$/.test(value.sourceSha256)
    || !['before','after','dependency','unresolved'].every(key => typeof value.change?.[key] === 'string')) throw new Error('Unrecognized practice preset.');
  for (const key of ['old','amended']) {
    const item = value[key];
    if (!item || !rawInputIds.every(id => typeof item.input?.[id] === 'string') || typeof item.draftText !== 'string') throw new Error('Incomplete practice preset.');
    const draft = JSON.parse(item.draftText);
    if (draft.version !== 1 || draft.kind !== 'independent-rules-v1' || !Array.isArray(draft.rules)) throw new Error('Invalid authored draft preset.');
  }
  if (value.old.input.formText !== value.amended.input.formText || value.old.input.driverText !== value.amended.input.driverText
    || value.old.input.policyText.replace(value.change.before,value.change.after) !== value.amended.input.policyText) throw new Error('Incompatible practice contexts.');
  const revision = value.revision;
  if (revision?.kind !== 'authored-equipment-revision-v1' || typeof revision.source !== 'string'
    || typeof revision.formText !== 'string' || new TextEncoder().encode(revision.formText).length > 32768) throw new Error('Invalid authored example revision.');
  // This is a closed supplied example, not a policy-to-expression generator.
  const original = JSON.parse(value.amended.input.formText), revised = JSON.parse(revision.formText);
  for (const [name, expression] of [
    ['unloading_assistance', "{delivery_method} = 'courier' and {equipment_weight} = 'heavy' and {loading_dock} = false"],
    ['handling_contact', "{delivery_method} = 'courier' and {loading_dock} = false"],
  ]) {
    const question = original.elements?.find(item => item.name === name);
    if (!question || question.visibleIf === expression) throw new Error('Incompatible authored example target.');
    question.visibleIf = expression;
  }
  if (JSON.stringify(original) !== JSON.stringify(revised)) throw new Error('Authored example revision changes unsupported context.');
  return value;
}
function fillPracticeStage(stage) {
  practice.stage = stage;
  dismissLive(); clearReviewView(); invalidateInput('Practice inputs loaded. Validate locally before starting a fresh independent review.');
  source = 'new';
  for (const id of rawInputIds) $(id).value = practiceInput()[id];
  $('manualActor').value = 'unattributed-local'; $('manualHumanAttestation').checked = false;
  liveMessage = ''; liveMessageError = false;
  const url = new URL(location.href); url.searchParams.set('source','new'); history.replaceState(null,'',url);
  practiceMessage = stage === 'old' ? 'Old authored inputs loaded. No validation, review approval or provider request has run.'
    : 'Old exact export retained. Amended inputs loaded with no active review or approval. Complete a separate review below, then explicitly use the retained old review in “What changes under this new policy?”.';
  renderInput(); renderLive(); focusVisible($('practiceHeading'));
}
async function beginPractice() {
  if ($('practiceStart').disabled || !confirmReviewReplacement('Start equipment practice')) return;
  resetPractice();
  const operation = {epoch:practiceEpoch,navigation,generation,inputGeneration,reviewActivity,reviewPin:practiceReviewPin(),controller:new AbortController()};
  practiceLoad = operation; practiceMessage = 'Loading the authored practice data. No review or provider request is started.'; renderPractice();
  try {
    const response = await fetch('/equipment-practice.json',{signal:operation.controller.signal});
    if (!response.ok) throw new Error('The authored practice data could not be loaded.');
    const text = await response.text();
    if (text.length > 65536) throw new Error('Practice data exceeds its local size limit.');
    const preset = validatePracticePreset(JSON.parse(text));
    if (practiceLoad !== operation || operation.epoch !== practiceEpoch || operation.navigation !== navigation
      || operation.generation !== generation || operation.inputGeneration !== inputGeneration
      || operation.reviewActivity !== reviewActivity || operation.reviewPin !== practiceReviewPin()) {
      if (practiceLoad === operation) practiceMessage = 'Practice load discarded after newer review changes. Start practice again explicitly.';
      return;
    }
    practiceLoad = null; practice = {stage:'old',preset,retained:null,expiresAt:Date.now()+PRACTICE_TTL_MS};
    practiceTimer = setTimeout(() => {
      resetPractice('Practice expired. Retained bytes and the active practice review were cleared. Start again explicitly.');
      clearReviewView(); invalidateInput('Practice expired. Validate again before a new review.');
      for (const id of rawInputIds) $(id).value = '';
      renderInput(); renderLive();
    }, PRACTICE_TTL_MS);
    fillPracticeStage('old');
  } catch (error) {
    if (practiceLoad !== operation || error.name === 'AbortError') return;
    practiceMessage = 'Practice not loaded: ' + error.message;
  } finally { if (practiceLoad === operation) {practiceLoad = null;renderPractice();} }
}
function retainPracticeExport(specification, exactText) {
  if (!practiceMatches() || practice.stage !== 'old' || !approved() || !manualSession() || stateUnconfirmed) return;
  if (typeof exactText !== 'string' || !/^[a-f0-9]{64}$/.test(specification?.specificationSha256)
    || specification.reviewBasis?.review?.approvalHash !== snapshot.approval.approvalHash
    || !equalRawInputs(specification.reviewBasis?.suppliedInput?.rawInputs, practiceInput())) throw new Error('The old export does not match this approved practice review.');
  practice.retained = {text:exactText,sessionId:snapshot.sessionId,inputId:snapshot.suppliedInput.inputId,
    approvalHash:snapshot.approval.approvalHash,specificationSha256:specification.specificationSha256,expiresAt:practice.expiresAt};
  practiceMessage = 'Exact old specification exported and retained in memory. Review its identifier above, then explicitly load the amendment.';
  renderPractice();
}
function ownInputs() {
  if ($('practiceOwnInput').disabled || !confirmReviewReplacement('Use your own policy and form')) return;
  resetPractice(); dismissLive(); clearReviewView(); invalidateInput(); source = 'new';
  for (const id of rawInputIds) $(id).value = '';
  const url = new URL(location.href); url.searchParams.set('source','new'); history.replaceState(null,'',url);
  renderInput(); renderLive(); void loadLiveConfig(); focusVisible($('policyText'));
}
const validSuppliedInput = value => inputIdPattern.test(value?.inputId)
  && value.family?.id === value.inputId && typeof value.family?.policy === 'string' && Array.isArray(value.family?.fields)
  && value.survey && typeof value.survey === 'object' && !Array.isArray(value.survey)
  && rawInputIds.every(id => typeof value.rawInputs?.[id] === 'string')
  && value.family.policy === value.rawInputs.policyText
  && value.hashes && typeof value.hashes === 'object' && Object.values(value.hashes).every(hash => /^[a-f0-9]{64}$/.test(hash))
  && Number.isSafeInteger(value.states) && value.states > 0 && value.states <= 256;
const pendingLive = () => liveOperation && ['pending', 'uncertain'].includes(liveOperation.status);
const provenanceKind = () => snapshot?.recording?.provenance?.kind;
const historicalR5Kind = 'historical-apertus-input-recording-r5-v1';
const historicalEvidence = () => provenanceKind() === historicalR5Kind;
const historicalSelection = () => !isLive() && recordings.find(item => item.id === $('reviewRecording').value)?.provenance?.kind === historicalR5Kind;
const syntheticEvidence = () => provenanceKind() === 'synthetic-omission-demonstration';
const liveEvidence = () => ['live-provider-response', 'local-mock-transport'].includes(provenanceKind());
const liveErrors = {
  timeout: 'The provider request exceeded its time limit. The server budget is stopped; the provider may still charge.',
  'transport-failed': 'The provider connection failed. The result and charges may be uncertain; this server will not retry.',
  'returned-model-mismatch': 'The returned model did not match the configured model. The result was rejected and the server budget stopped.',
  'unexpected-response-endpoint': 'The response destination did not match the configured endpoint. The result was rejected.',
  'invalid-usage': 'The provider returned invalid usage accounting. The result was rejected and the server budget stopped.',
  'missing-provider-usage': 'The provider omitted usage accounting. The result was rejected and the server budget stopped.',
  'credential-echo-detected': 'The response failed a credential-safety check. The result was discarded and the server budget stopped.',
  'reported-total-token-limit-exceeded': 'The reported total-token limit was exceeded. The result was rejected and the server budget stopped.',
  'live-result-rejected': 'The live result failed validation. It was rejected and the server budget stopped.',
  LIVE_DISABLED: 'Live extraction is disabled on this server.',
  LIVE_NOT_CONFIGURED: 'Live extraction is not configured on this server.',
  LIVE_BUDGET_EXHAUSTED: 'The server-side request budget is exhausted.',
  LIVE_BUSY: 'Another extraction is in progress on this server.',
  LIVE_UNKNOWN_REQUEST: 'This server does not know that request ID. No request was retried.',
  LIVE_REQUEST_NOT_FOUND: 'This server does not know that request ID. No request was retried.',
  LIVE_TIMEOUT: 'The provider request exceeded its time limit.',
  LIVE_PROVIDER_ERROR: 'The provider request failed.',
  LIVE_CANCELLED: 'The request was discarded. The provider may still finish and charge.',
};
const safeLiveError = code => (typeof code === 'string' && /^http-[1-5][0-9]{2}$/.test(code) ? `The provider returned HTTP ${code.slice(5)}. The server budget is stopped; no request was retried.` : liveErrors[code]) ?? 'The live request could not be completed. Inspect the local server configuration; no request was retried.';
// Only exact local preflight messages are exposed. Unknown/provider error bodies
// remain behind safeLiveError and never become display text.
const extractionPreflightErrors = new Map([
  ['Unsupported form expression: unknown SurveyJS function. Functions are outside the supplied-input contract; no form was changed.', {status: 400, revalidate: true, message: 'This form uses an unsupported function expression. Review the form and validate locally again. No provider request was sent.'}],
  ['Supplied input binding mismatch; validate the exact inputs again', {status: 400, revalidate: true, message: 'The local input does not match this request. Validate the exact inputs again. No provider request was sent.'}],
  ['Review session limit reached; release a review in Local session capacity or wait for expiry. No live request was sent', {status: 429, message: 'The local review session limit is reached. Release an unwanted review in Local session capacity, or wait for an idle review to expire, then explicitly try again. Export any wanted results or specifications before release. No provider request was sent.'}],
  ['Review session limit reached; restart the local server or wait for expiry. No live request was sent', {status: 429, message: 'The local review session limit is reached. Wait for an idle session to expire, or save any useful exports before restarting the server. No provider request was sent. Restart loses all local sessions and resets the local budget.'}],
  ['Validated input expired or is unknown; validate the exact inputs again', {status: 410, revalidate: true, message: 'This validated input expired or is unknown to the local server. Validate the exact inputs again. No provider request was sent.'}],
  ['Extraction request exceeds the configured byte limit; shorten the policy or labels', {status: 413, revalidate: true, message: 'The policy and field labels exceed the configured provider request byte limit. Shorten them, validate locally again, then explicitly extract. No provider request was sent.'}],
  ['Another live extraction is pending; no request was sent', {status: 409, message: 'Another extraction is already pending on this server. No provider request was sent for this attempt. Recover or finish that request before explicitly trying again.'}],
  ['Live process budget stopped or exhausted; no request was sent', {status: 429, message: 'The local server request budget is stopped or exhausted. No provider request was sent for this attempt. Refresh configuration only to see the current limits.'}],
]);
function persistLive(value) {
  try {
    if (value) sessionStorage.setItem(liveStorageKey, JSON.stringify(value));
    else sessionStorage.removeItem(liveStorageKey);
  } catch { /* Storage is optional; in-page request guards remain authoritative. */ }
}
function restoreLive() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(liveStorageKey));
    if (saved?.kind === 'dismissal') {
      liveDismissal = {message: 'A previously discarded request may still finish and charge. Acknowledge this before starting another request.'};
    } else if (saved?.kind === 'request' && /^[a-f0-9-]{36}$/i.test(saved.requestId)
      && ((inputIdPattern.test(saved.inputId) && saved.familyId === saved.inputId && saved.variant === 'supplied')
        || (saved.inputId === undefined && typeof saved.familyId === 'string' && ['mutant', 'clean'].includes(saved.variant)))) {
      // Copy identifiers only. Browser storage is never a source of input text.
      liveOperation = {requestId: saved.requestId, familyId: saved.familyId, variant: saved.variant,
        ...(saved.inputId ? {inputId: saved.inputId} : {}), status: 'uncertain', busy: false, navigation};
      liveMessage = 'An earlier request has an unconfirmed result. Recover it explicitly or discard it; refreshing never sends it again.';
    }
  } catch { /* A malformed local record cannot enable or trigger extraction. */ }
}
let manualOperation = null, manualMessage = '', manualError = false, manualResolutionRecovery = null;
const manualSession = () => snapshot?.kind === 'independent-manual';
const manualEmpty = () => manualSession() && !dirty && snapshot?.parsed?.status === 'empty';
const canResolve = () => valid() || manualEmpty();
function renderManualStart() {
  const parentMock = snapshot?.recording?.provenance?.kind === 'local-mock-transport';
  const locked = manualSession() || parentMock;
  if (parentMock || snapshot?.actor?.basis === 'server-simulation') {
    $('manualActor').value = 'agent-simulation'; $('manualHumanAttestation').checked = false;
  }
  const kind = $('manualActor').value || 'unattributed-local';
  $('manualHumanLabel').hidden = kind !== 'self-reported-human';
  $('manualActor').disabled = locked || !!manualOperation || !!pending;
  $('manualHumanAttestation').disabled = locked || !!manualOperation || !!pending;
  const uncertain = !!pendingLive() || !!liveOperation?.busy || !!liveDismissal;
  const eligibleSnapshot = !snapshot || !manualSession() && ['invalid', 'abstain'].includes(snapshot.originalParsed?.status);
  $('manualStart').disabled = !isNew() || !!manualOperation || !!pending || computationBusy() || stateUnconfirmed || uncertain || !!inputValidation
    || !validatedInput || !equalRawInputs(validatedInput.rawInputs, rawInputs()) || !eligibleSnapshot
    || kind === 'self-reported-human' && !$('manualHumanAttestation').checked;
  $('manualStart').textContent = manualOperation ? 'Starting independent draft…' : snapshot && !manualSession()
    && ['invalid', 'abstain'].includes(snapshot.originalParsed?.status) ? 'Start separate independent draft' : 'Author independent rules locally';
  $('manualStatus').textContent = uncertain ? 'Recover the pending result, or discard and acknowledge its possible charges, before starting an independent draft.'
    : manualMessage || (manualSession() ? `Independent draft active. ${snapshot.actor.claim} Continue with the rules and coverage below.`
    : !validatedInput ? 'Validate these inputs first. Local authoring needs no configured model or provider request.'
    : 'Start an empty independently authored specification. A linked invalid or abstained extraction will remain unchanged. No provider request is made by this action.');
  $('manualStatus').className = manualError ? 'error' : 'subtle';
}
function verifiedManualSnapshot(value, input) {
  return value?.kind === 'independent-manual' && value.reviewVersion === 5 && typeof value.sessionId === 'string'
    && value.recording === null && value.originalParsed === null && value.variant === 'supplied'
    && validSuppliedInput(value.suppliedInput) && json(value.suppliedInput) === json(input)
    && json(value.family) === json(input.family) && json(value.survey) === json(input.survey)
    && value.parsed?.contractVersion === 'independent-rules-v1' && value.actor?.identityVerified === false;
}
async function startManual() {
  if ($('manualStart').disabled) return;
  reviewActivity++;
  const input = validatedInput, previous = snapshot;
  const body = {inputId: input.inputId, actorKind: $('manualActor').value || 'unattributed-local',
    humanAttestation: $('manualActor').value === 'self-reported-human' && $('manualHumanAttestation').checked,
    ...(previous ? {parentSessionId: previous.sessionId, parentExpectedRevision: previous.revision} : {})};
  clearReviewView();
  const operation = {navigation, inputGeneration, input, controller: new AbortController()};
  manualOperation = operation; manualMessage = 'Starting a separate empty local draft. No provider request is made.'; renderLive();
  try {
    const next = await post('manual-start', body, operation.controller.signal);
    if (manualOperation !== operation || navigation !== operation.navigation || inputGeneration !== operation.inputGeneration
      || !isNew() || !equalRawInputs(input.rawInputs, rawInputs())) return;
    if (!verifiedManualSnapshot(next, input) || next.revision !== 0 || next.parsed.status !== 'empty' || next.approval !== null || next.report !== null
      || json(next.priorExtraction) !== json(previous ? {recording: previous.recording, originalParsed: previous.originalParsed} : null))
      throw uncertainError('The independent start response could not be verified.');
    snapshot = next; $('draftEditor').value = next.draftText; dirty = false; clearAttestations();
    manualMessage = previous ? 'Separate independent draft started. The linked extraction remains ' + previous.originalParsed.status + '; no model rule was copied into the starting draft.'
      : 'Empty independent draft started. No extraction is linked to this specification.';
    render(); $('reviewWorkspace').hidden = false; $('reviewLoading').hidden = true;
  } catch (error) {
    if (manualOperation !== operation || error.name === 'AbortError') return;
    snapshot = previous && !releasedSessionIds.has(previous.sessionId) ? previous : null;
    manualMessage = error.responseUncertain
      ? 'The independent draft start is unconfirmed. It may have created an unapproved local session. Choose the start action again explicitly for a fresh draft; no start or extraction was retried.'
      : extractionPreflightErrors.get(error.message)?.message || error.message;
    if (error.status === 410 && !error.releasedReview) invalidateInput('The validated input or linked session expired. Validate the exact inputs again before starting a fresh independent draft.');
    manualError = true;
    if (snapshot) { $('draftEditor').value = snapshot.draftText; render(); $('reviewWorkspace').hidden = false; }
  } finally {
    if (manualOperation === operation) { manualOperation = null; renderLive(); }
  }
}
async function recoverManual() {
  if (!manualSession() || pending || manualOperation) return;
  reviewActivity++;
  const operation = {action: 'state', navigation, generation, sessionId: snapshot.sessionId};
  const input = snapshot.suppliedInput, retainedComposition = composition ? JSON.parse(json(composition)) : null;
  const retained = dirty && !composition ? $('draftEditor').value : null, resolutionRecovery = manualResolutionRecovery;
  pending = operation; renderControls();
  try {
    const actual = await post('state', {sessionId: operation.sessionId});
    if (navigation !== operation.navigation || snapshot?.sessionId !== operation.sessionId) return;
    if (!verifiedManualSnapshot(actual, input) || actual.sessionId !== operation.sessionId) throw new Error('Independent session identity mismatch');
    if (generation !== operation.generation) {snapshot.revision = Math.max(snapshot.revision, actual.revision);return;}
    const appliedResolution = resolutionRecovery && resolutionRecovery.generation === operation.generation
      && resolutionCommitted(actual, resolutionRecovery.token, resolutionRecovery.body);
    snapshot = actual; stateUnconfirmed = false; currentError = ''; structuredDraft = null; manualResolutionRecovery = null;
    composition = appliedResolution ? null : retainedComposition;
    dirty = !appliedResolution && (retained !== null || !!composition);
    $('draftEditor').value = appliedResolution || composition ? actual.draftText : retained ?? actual.draftText;
    if (composition) {
      composition.conflict = actual.coverage.some(slot => slot.field === composition.field && slot.property === composition.property && slot.present);
      if (composition.conflict) composition.error = 'The server has a rule in this slot. Your unapplied composition is preserved here; cancel it explicitly to inspect the current rule before editing.';
    }
    if (dirty) {snapshot.approval = null;snapshot.report = null;}
    clearAttestations(); manualMessage = appliedResolution
      ? 'The authored resolution was applied. Its exact result was recovered; no mutation or provider request was repeated.'
      : composition ? 'Independent state recovered. Your complete unapplied composition is preserved; inspect it and explicitly apply when ready.'
      : 'Independent session state recovered without repeating a mutation or provider request.';
    manualError = false;
  } catch (error) {
    if (navigation !== operation.navigation || snapshot?.sessionId !== operation.sessionId) return;
    stateUnconfirmed = true; snapshot.approval = null; snapshot.report = null; clearAttestations();
    currentError = 'Independent state could not be confirmed. ' + error.message + ' Your local draft is retained. Recover this same session, or copy the draft before switching sources to start a fresh unapproved review; no action was retried.';
  } finally {
    if (pending === operation) {pending = null;render();}
  }
}


function clearReviewView() {
  if ($('reviewWorkspace').contains?.(document.activeElement) || document.activeElement === $('reviewRetry') || document.activeElement === $('reviewLoading')) focusVisible($('reviewSource'));
  announceReviewView('');
  resetRuleEvidence();
  clearComputationView();
  window.formRehearsalRecheck?.reset();
  window.formRehearsalPolicyImpact?.reset();
  manualOperation?.controller.abort(); manualOperation = null; manualMessage = ''; manualError = false; manualResolutionRecovery = null; $('manualHumanAttestation').checked = false;
  navigation++; generation++; startController?.abort();
  snapshot = null; pending = null; dirty = false; structuredDraft = null; composition = null; selected = 0; replayMessage = null;
  recoveryDraft = null; stateUnconfirmed = false; currentError = ''; exportMessage = null; clearAttestations();
  $('reviewWorkspace').hidden = true; $('reviewRetry').hidden = true; $('reviewLoading').hidden = true;
  $('draftEditor').value = ''; $('draftEditor').disabled = true;
  $('reviewExportStatus').textContent = ''; $('reviewExportStatus').hidden = true;
  $('specificationExportStatus').textContent = ''; $('specificationExportStatus').hidden = true;
  $('specificationExportPanel').hidden = true; $('specificationExport').disabled = true;
  $('operationalCoveragePanel').hidden = true; $('operationalCoverage').replaceChildren();
  for (const id of ['reviewRules', 'reviewCoverage', 'reviewChanges', 'reviewFindings', 'reviewReplayArea', 'reviewReplayResult', 'reviewProvenance']) $(id).replaceChildren();
  for (const id of ['rawResponse', 'reviewTitle', 'reviewPolicy', 'reviewFields', 'reviewSurvey', 'reviewValidation']) $(id).textContent = '';
  $('reviewOverviewCounts').textContent = '';
  $('reviewNavigation').open = false;
  renderActor();
  $('rulesHash').textContent = 'Not available'; $('approvalHash').textContent = 'Not approved';
  for (const id of ['applyDraft', 'approveReview', 'analyzeReview', 'reviewInterpretation', 'reviewCompleteness', 'reviewReplay', 'reviewExport']) $(id).disabled = true;
}
function setSourcePresentation() {
  $('reviewActorPanel').hidden = isLive();
  $('reviewSource').value = source;
  $('reviewRecordedSourceOption').textContent = 'Saved model responses and authored examples';
  $('reviewRecordingLabelText').textContent = syntheticEvidence() && !isLive() ? 'Synthetic example' : 'Saved example';
  $('reviewRecordingLabel').hidden = isLive(); $('reviewLiveFamilyLabel').hidden = source !== 'live'; $('livePanel').hidden = !isLive() || !!practice;
  if ($('savedModelEvidence')) $('savedModelEvidence').hidden = isLive();
  $('newInputPanel').hidden = !isNew(); $('reviewVariantFieldset').hidden = isNew() || historicalSelection();
  $('reviewBoundaryTitle').textContent = isLive()
    ? isNew() ? 'New inputs: author rules locally, or explicitly request extraction.' : 'Optional live extraction. A provider call requires your explicit Extract action.'
    : historicalEvidence() ? 'Genuine saved Apertus r5 response. Exact original input; no new provider call.' : syntheticEvidence() ? 'Authored synthetic omission demo. No provider response or model inference.' : 'Recorded Apertus responses. No model inference runs in this page.';
  $('reviewBoundaryDetail').textContent = isNew()
    ? 'New non-sensitive examples must pass local validation before local authoring or extraction. The configured provider receives the validated policy and finite field schema; the supplied form is checked locally. Every returned rule and coverage slot still needs explicit review.'
    : isLive()
    ? 'Only bundled synthetic development policies are available. Review every returned rule and coverage slot before approving. Live results and local test mocks are labelled separately; provenance does not establish source authenticity or semantic correctness.'
    : syntheticEvidence() ? 'This example was authored to demonstrate adding a missing rule. It is not a model response or a human participant result. Review is local; approval does not establish policy correctness.'
    : historicalEvidence() ? 'The historical original already agrees with the one proposed visibility rule. Three other checks are unresolved. Review them explicitly, check the original, then deliberately try a newly authored revision below. The invalid historical control stays invalid.' : 'Saved provider responses and a disclosed synthetic omission demo, each retaining its original source. Review is local and explicit. Approval records your chosen interpretation; it is not independent human gold or proof of semantic correctness.';
  $('reviewSourcePill').textContent = isNew() ? 'NEW INPUT · LOCAL VALIDATION FIRST' : isLive() ? 'LIVE OPT-IN · CALLER-OWNED BUDGET' : syntheticEvidence() ? 'SYNTHETIC DEMO · NO PROVIDER RESPONSE' : 'SAVED RESPONSE · NO API KEY';
  $('liveInputNotice').textContent = isNew()
    ? 'Extract sends the validated policy and finite field schema to the configured provider below. The supplied SurveyJS form is checked locally. Use only non-sensitive examples. Validation, typing, source selection, refresh and navigation never start provider inference. Generic thinking mode is unavailable.'
    : 'The selected bundled synthetic policy and finite field schema will be sent to the destination below. No provider request runs on page load, source selection, family change or refresh. Generic thinking mode is unavailable.';
  if ($('historicalJourney')) $('historicalJourney').hidden = !historicalEvidence() || isLive();
  if (manualSession()) {
    $('reviewBoundaryTitle').textContent = 'Independent authored specification. No model rules are used as a seed.';
    $('reviewBoundaryDetail').textContent = 'Rules are composed locally from exact policy evidence. Any linked failed extraction stays unchanged. Review all authored rules and unchecked slots before approval.';
    $('reviewSourcePill').textContent = 'INDEPENDENT AUTHORSHIP · LOCAL ONLY';
  }
  if (practiceMatches()) {
    $('reviewBoundaryTitle').textContent = 'Authored synthetic equipment practice. No provider request.';
    $('reviewBoundaryDetail').textContent = 'The old and amended drafts were authored for this example. Each starts as a separate unapproved local review. Review every rule and the unresolved access-instructions visibility slot yourself. Reviewer identity is separate from the example’s origin.';
    $('reviewSourcePill').textContent = 'AUTHORED PRACTICE · EXPLICIT LOCAL REVIEW';
  }
  renderPractice();
}
function renderInput() {
  $('validateInput').disabled = !isNew() || !!inputValidation || rawInputIds.some(id => !$(id).value.trim());
  $('validateInput').textContent = inputValidation ? 'Validating locally…' : 'Validate locally';
  $('inputStatus').textContent = inputMessage;
  $('inputStatus').className = inputError ? 'error' : 'subtle';
  $('inputValidation').hidden = !validatedInput;
  $('inputId').textContent = validatedInput?.inputId ?? '';
  $('inputDetails').textContent = validatedInput ? json({states: validatedInput.states, fields: validatedInput.family.fields, hashes: validatedInput.hashes}) : '';
  renderManualStart();
}
function invalidateInput(message = 'Input changed. Validate all three inputs again before extraction.') {
  inputGeneration++; inputValidation?.controller.abort(); inputValidation = null; validatedInput = null; inputLeaseId = null; inputLeaseOrder = null;
  inputMessage = message; inputError = false;
}
function editInput() {
  if (practice || practiceLoad) resetPractice('Practice cleared because an input changed. Any retained old specification and comparison were discarded.');
  dismissLive(); clearReviewView(); invalidateInput(); liveMessage = ''; liveMessageError = false;
  renderInput(); renderLive();
}
async function validateInput() {
  if ($('validateInput').disabled) return;
  reviewActivity++;
  const input = rawInputs();
  const captured = snapshot?.suppliedInput ?? manualOperation?.input ?? liveOperation?.input ?? validatedInput;
  const unchanged = captured && equalRawInputs(captured.rawInputs, input);
  // Admission renewal must not abandon the captured review, local composition,
  // recheck or in-flight action. A raw-byte edit still invalidates immediately.
  if (!unchanged) {
    dismissLive(); clearReviewView(); invalidateInput(); liveMessage = ''; liveMessageError = false;
  }
  // Retire only the admission lease while renewal runs. Old-lease releases
  // must not abort a newer validation; its own ordered response is checked below.
  validatedInput = null; inputLeaseId = null; inputLeaseOrder = null;
  const operation = {generation: inputGeneration, releaseEpoch:inputReleaseEpoch, rawInputs: input, controller: new AbortController()};
  inputValidation = operation; inputMessage = 'Checking the supported subset locally. No provider request is made.';
  renderInput(); renderLive();
  try {
    const response = await fetch('/api/input/validate', {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: json(operation.rawInputs), signal: operation.controller.signal});
    const data = await response.json();
    if (!isNew() || inputValidation !== operation || operation.generation !== inputGeneration || !equalRawInputs(operation.rawInputs, rawInputs())) return;
    if (!response.ok) throw new Error(typeof data?.error === 'string' ? data.error : 'The supplied input is outside the supported subset.');
    if (!validSuppliedInput(data) || !equalRawInputs(data.rawInputs, operation.rawInputs)
      || unchanged && json(data) !== json(captured)) throw new Error('The local validation result could not be verified. Validate again.');
    const leaseId=response.headers?.get?.('X-FormRehearsal-Input-Lease')??null;
    const order={leaseEpoch:response.headers?.get?.('X-FormRehearsal-Input-Lease-Epoch')??null,
      leaseRevision:Number(response.headers?.get?.('X-FormRehearsal-Input-Lease-Revision'))};
    const crossedUnknownRelease=(unknownOrderReleaseEvents.get(data.inputId)??0)>operation.releaseEpoch;
    const crossedUnorderedResponse=!validLeaseOrder(order)&&(inputReleaseEvents.get(data.inputId)??0)>operation.releaseEpoch;
    if(releasedInputLeases.has(data.inputId+'/'+leaseId)||admissionReleased(data.inputId,order)||crossedUnknownRelease||crossedUnorderedResponse)
      throw new Error('This validated admission was released before its response arrived. Validate the complete inputs again.');
    validatedInput = data; inputLeaseId=leaseId; inputLeaseOrder=validLeaseOrder(order)?order:null; releasedInputIds.delete(data.inputId);
    inputMessage = `Validated locally: ${data.family.fields.length} fields and ${data.states} independent driver combinations. Each successful validation keeps these exact inputs available for 30 minutes in this running server. No provider request has been made for this validation.${unchanged ? ' Existing review and in-progress work are retained; this does not renew an expired review or restore invalidated approval.' : ' Choose independent local authoring, or review the configured destination and explicitly choose Extract.'}`;
  } catch (error) {
    if (!isNew() || inputValidation !== operation || error.name === 'AbortError') return;
    inputMessage = error instanceof Error ? error.message : 'Local validation could not be confirmed. Validate again.'; inputError = true;
  } finally {
    if (inputValidation === operation) { inputValidation = null; renderInput(); renderLive(); }
  }
}
function validLiveConfig(value) {
  const limits = ['maxCalls', 'maxOutputTokens', 'maxTotalOutputTokens', 'timeoutMs', 'maxRequestBytes', 'maxResponseBytes', 'maxReportedTotalTokens'];
  return value && typeof value.enabled === 'boolean' && Array.isArray(value.families)
    && value.families.every(f => typeof f.id === 'string' && typeof f.title === 'string')
    && (!value.enabled || (typeof value.model === 'string' && value.model.length > 0 && typeof value.endpoint === 'string' && value.endpoint.startsWith('https://')))
    && ((!value.enabled && value.limits === null) || limits.every(key => Number.isSafeInteger(value.limits?.[key]) && value.limits[key] > 0))
    && ['attempts', 'reservedOutputTokens', 'reportedTotalTokens'].every(key => Number.isSafeInteger(value.budget?.[key]) && value.budget[key] >= 0);
}
function acceptLiveConfig(config) {
  if (!validLiveConfig(config)) throw uncertainError('The local live configuration response could not be verified.');
  liveConfig = config; liveConfigError = false;
}
function budgetStopped() {
  if (!liveConfig?.enabled || !liveConfig.limits) return true;
  const {limits, budget} = liveConfig;
  return !!budget.stopReason || budget.attempts >= limits.maxCalls
    || budget.reservedOutputTokens + limits.maxOutputTokens > limits.maxTotalOutputTokens
    || budget.reportedTotalTokens >= limits.maxReportedTotalTokens;
}
function renderLive() {
  setSourcePresentation();
  const config = liveConfig, rows = element('dl', '', 'provenance');
  if (config) {
    const {limits, budget} = config;
    const values = [
      ['Server availability', config.enabled ? 'Enabled for explicit requests' : 'Disabled'],
      ['Requested model', config.enabled ? config.model : 'Unavailable'],
      ['Extraction prompt revision', config.enabled ? config.promptRevision ?? 'Unavailable' : 'Unavailable'],
      ['Prompt SHA-256', config.enabled ? config.promptSha256 ?? 'Unavailable' : 'Unavailable'],
      ...(config.enabled && config.promptRevision === 'extraction-v5' ? [['Prompt evidence', 'Experimental opt-in development revision; exposed-case evidence only. No reliability or generalization claim.']] : []),
      ['Provider destination', config.enabled ? config.endpoint : 'Unavailable'],
      ...(limits ? [
      ['Calls attempted / maximum', `${budget.attempts} / ${limits.maxCalls}`],
      ['Requested output per call', `${limits.maxOutputTokens} tokens`],
      ['Reserved output / maximum', `${budget.reservedOutputTokens} / ${limits.maxTotalOutputTokens} tokens`],
      ['Reported total / stop threshold', `${budget.reportedTotalTokens} / ${limits.maxReportedTotalTokens} tokens`],
      ['Provider-call deadline', `${limits.timeoutMs / 1000} seconds`],
      ['Request / response limits', `${limits.maxRequestBytes} / ${limits.maxResponseBytes} bytes`],
      ['Budget availability', budgetStopped() ? 'Stopped; another call is blocked' : 'Within configured limits'],
      ] : [['Startup status', config.reason || 'No validated live configuration is available.']]),
    ];
    for (const [label, value] of values) rows.append(element('dt', label), element('dd', value));
  }
  $('liveConfigValues').replaceChildren(rows);
  const running = pendingLive(), recoveringReview = !!liveOperation?.busy;
  $('reviewLiveFamily').disabled = liveConfigLoading || !config?.families.length;
  if (isLive()) document.querySelectorAll('[name=reviewVariant]').forEach(node => { node.disabled = isNew() || liveConfigLoading || !config?.families.length; });
  $('liveExtract').disabled = !!practice || manualSession() || !!manualOperation || !!pending || computationBusy() || !isLive() || liveConfigLoading || liveConfigError || !config?.enabled || budgetStopped()
    || !!running || recoveringReview || !!liveDismissal || (isNew()
      ? !!inputValidation || !validatedInput || !equalRawInputs(validatedInput.rawInputs, rawInputs())
      : !config.families.some(f => f.id === $('reviewLiveFamily').value));
  $('liveExtract').textContent = running && liveOperation?.busy ? 'Extracting once…' : 'Extract once with configured model';
  $('liveRecover').hidden = manualSession() || !running && !stateUnconfirmed;
  $('liveRecover').disabled = liveConfigLoading || !!liveOperation?.busy || !!pending || computationBusy() || !!liveOperation && isNew() !== !!liveOperation.inputId;
  $('liveCancel').hidden = manualSession() || !running && !stateUnconfirmed;
  $('liveCancel').disabled = false;
  $('liveAcknowledge').hidden = !liveDismissal;
  $('liveConfigRetry').disabled = liveConfigLoading || !!running;
  $('liveStatus').textContent = liveDismissal?.message || liveMessage || (liveConfigLoading ? 'Reading server configuration only…'
    : liveConfigError ? 'Could not verify the live configuration. Refresh configuration only to try again.'
    : !config?.enabled ? config?.reason || 'Live extraction is disabled. Configure and enable the local server before requesting a call.'
    : budgetStopped() ? 'The finite server budget is exhausted or stopped. No further extraction is available.'
    : isNew() && !validatedInput ? 'Validate the policy, form and independent drivers locally before extraction. No provider request is started by validation.'
    : 'No current extraction result is loaded. Review the model, destination and limits above, then explicitly choose Extract.');
  $('liveStatus').className = liveMessageError || liveConfigError ? 'error' : 'subtle';
  renderInput();
  refreshWireDiagnostic();
}
async function livePost(action, body, signal) {
  let response, data;
  try {
    response = await fetch(`/api/live/${action}`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: json(body), signal});
    data = await response.json();
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw uncertainError('The response is unconfirmed; the provider may have run and charged. No extraction was retried. Use Recover result to check this same request ID.');
  }
  if (!response.ok && !['failed', 'pending', 'complete', 'cancelled'].includes(data?.status)) {
    const preflight = action === 'extract' ? extractionPreflightErrors.get(data?.error) : null;
    if (preflight?.status === response.status) {
      throw Object.assign(new Error(preflight.message), {config: data?.config, notStarted: true, revalidate: !!preflight.revalidate});
    }
    const error = new Error(response.status === 404 ? liveErrors.LIVE_UNKNOWN_REQUEST : safeLiveError(data?.error));
    error.config = data?.config; throw error;
  }
  return data;
}
async function loadLiveConfig() {
  const token = ++configGeneration;
  liveConfigLoading = true; liveConfigError = false; renderLive();
  try {
    const response = await fetch('/api/live/config');
    if (!response.ok) throw new Error('Configuration unavailable');
    const config = await response.json();
    if (token !== configGeneration || !isLive()) return;
    acceptLiveConfig(config);
    const selectedFamily = liveOperation?.familyId ?? $('reviewLiveFamily').value;
    $('reviewLiveFamily').replaceChildren();
    for (const family of config.families) { const option = element('option', family.title); option.value = family.id; $('reviewLiveFamily').append(option); }
    if (config.families.some(f => f.id === selectedFamily)) $('reviewLiveFamily').value = selectedFamily;
    if (pendingLive() && !liveOperation.inputId) document.querySelectorAll('[name=reviewVariant]').forEach(node => { node.checked = node.value === liveOperation.variant; });
  } catch {
    if (token !== configGeneration || !isLive()) return;
    liveConfigError = true;
  } finally {
    if (token === configGeneration) { liveConfigLoading = false; renderLive(); }
  }
}
function currentLive(operation) {
  return isLive() && isNew() === !!operation.inputId && liveOperation === operation && operation.navigation === navigation;
}
function acceptLiveOutcome(data, operation, retained = null) {
  if (data?.requestId !== operation.requestId || !['complete', 'failed', 'pending', 'cancelled'].includes(data.status)) {
    throw uncertainError('The response identity could not be verified. Recover this request explicitly; no extraction was retried.');
  }
  acceptLiveConfig(data.config);
  if (data.status === 'complete') {
    assertUnreleasedReview(data);
    const next = data.snapshot;
    if (!next?.sessionId || next.family?.id !== operation.familyId || next.variant !== operation.variant
      || next.recording?.id !== `live-${operation.requestId}` || next.recording?.provenance?.requestId !== operation.requestId
      || !['live-provider-response', 'local-mock-transport'].includes(next.recording?.provenance?.kind)) {
      throw uncertainError('The extraction result could not be verified. Recover this request explicitly; no extraction was retried.');
    }
    if (operation.inputId) {
      const supplied = next.suppliedInput;
      if (!validSuppliedInput(supplied) || supplied.inputId !== operation.inputId
        || json(supplied.family) !== json(next.family) || json(supplied.survey) !== json(next.survey)
        || validatedInput && json(validatedInput) !== json(supplied)) {
        throw uncertainError('The supplied input identity could not be verified. Recover this request explicitly; no extraction was retried.');
      }
      validatedInput = inputValidation || releasedInputIds.has(supplied.inputId) ? null : supplied;
      for (const id of rawInputIds) $(id).value = supplied.rawInputs[id];
      inputMessage = `Validated input recovered for this exact request: ${supplied.family.fields.length} fields and ${supplied.states} independent driver combinations.`;
      if(inputValidation)inputMessage = 'Captured result recovered. Local input admission renewal is still pending; no review or extraction was restarted.';
      else if(!validatedInput)inputMessage = 'Captured result recovered. Its input admission was released; validate raw inputs again before another start.';
      inputError = false;
    }
    snapshot = next; structuredDraft = null; composition = null; stateUnconfirmed = false; currentError = ''; exportMessage = null; selected = 0; replayMessage = null; clearAttestations();
    dirty = retained !== null && editable(); $('draftEditor').value = dirty ? retained : next.draftText;
    if (dirty) { snapshot.approval = null; snapshot.report = null; }
    render(); $('reviewWorkspace').hidden = false; $('reviewLoading').hidden = true;
    liveMessage = next.recording.provenance.kind === 'local-mock-transport'
      ? 'Local mock transport result. This is test plumbing, not live provider evidence. Review is still required.'
      : 'Live response received. Source authenticity is unverified. Review the original output, interpretation and coverage before approval.';
    operation.status = 'complete'; persistLive(null);
  } else if (data.status === 'pending') {
    operation.status = 'pending'; liveMessage = 'This request is still pending. Recover result checks the same ID without another extraction, or cancel and discard locally.';
  } else {
    operation.status = data.status; liveMessage = data.status === 'cancelled' ? liveErrors.LIVE_CANCELLED : safeLiveError(data.error);
    liveMessageError = data.status === 'failed'; persistLive(null);
  }
}
async function extractLive() {
  if ($('liveExtract').disabled) return;
  clearReviewView(); liveMessage = ''; liveMessageError = false;
  const operation = {requestId: crypto.randomUUID(), familyId: isNew() ? validatedInput.inputId : $('reviewLiveFamily').value,
    variant: isNew() ? 'supplied' : document.querySelector('[name=reviewVariant]:checked').value,
    ...(isNew() ? {inputId: validatedInput.inputId, input: validatedInput} : {}),
    navigation, status: 'pending', busy: true, controller: new AbortController()};
  liveOperation = operation; persistLive({kind: 'request', requestId: operation.requestId, familyId: operation.familyId, variant: operation.variant,
    ...(operation.inputId ? {inputId: operation.inputId} : {})});
  liveMessage = 'One extraction request is in progress. A repeated click cannot create another request.'; renderLive();
  try {
    const body = operation.inputId ? {requestId: operation.requestId, inputId: operation.inputId}
      : {requestId: operation.requestId, familyId: operation.familyId, variant: operation.variant};
    const data = await livePost('extract', body, operation.controller.signal);
    if (currentLive(operation)) acceptLiveOutcome(data, operation);
  } catch (error) {
    if (!currentLive(operation) || error.name === 'AbortError') return;
    operation.status = error.notStarted ? 'failed' : 'uncertain'; liveMessage = error.message; liveMessageError = true;
    if (error.notStarted) persistLive(null);
    if (error.revalidate && isNew()) invalidateInput(error.message);
    if (validLiveConfig(error.config)) acceptLiveConfig(error.config);
  } finally { if (currentLive(operation)) { operation.busy = false; if (snapshot) renderControls(); renderLive(); } }
}
async function recoverLive() {
  const operation = liveOperation;
  if (manualSession() || manualOperation || !operation || operation.busy || pending || liveConfigLoading || !isLive() || isNew() !== !!operation.inputId) return;
  const retained = snapshot && dirty && editable() ? $('draftEditor').value : null;
  const editGeneration = generation;
  operation.busy = true; operation.navigation = navigation; liveMessageError = false;
  if (snapshot) renderControls();
  liveMessage = 'Checking this request ID only. No extraction is being repeated.'; renderLive();
  try {
    const data = await livePost('state', {requestId: operation.requestId});
    if (!currentLive(operation)) return;
    // Editing is allowed while recovery runs. Keep the newest typed text and
    // invalidate any recovered approval/report rather than restoring old input.
    const latestDraft = generation !== editGeneration && snapshot && editable() ? $('draftEditor').value : retained;
    acceptLiveOutcome(data, operation, latestDraft);
  } catch (error) {
    if (!currentLive(operation)) return;
    operation.status = 'uncertain'; liveMessage = `${error.message} Discard and acknowledge before starting a new request.`; liveMessageError = true;
    if (validLiveConfig(error.config)) acceptLiveConfig(error.config);
  } finally { if (currentLive(operation)) { operation.busy = false; if (snapshot) renderControls(); renderLive(); } }
}
function dismissLive() {
  const operation = liveOperation;
  const mayRun = pendingLive() || (operation && stateUnconfirmed && !manualSession());
  liveOperation = null;
  if (!mayRun) return;
  operation.controller?.abort();
  liveDismissal = {message: 'Discarded locally. Cancellation is unconfirmed; the provider may still finish and charge. Acknowledge this before starting a new request.'};
  const dismissal = liveDismissal; persistLive({kind: 'dismissal'});
  // Best-effort cancellation never restores a dismissed result or repeats work.
  // Even a confirmed cancellation cannot promise the provider stopped charging.
  livePost('cancel', {requestId: operation.requestId}).then(data => {
    if (liveDismissal !== dismissal) return;
    if (data.requestId === operation.requestId && data.status === 'cancelled') {
      dismissal.message = 'Cancellation recorded; the result is discarded. The provider may still finish and charge, with no automatic retry or refund. Acknowledge this before a new request.';
    }
    renderLive();
  }).catch(() => { if (liveDismissal === dismissal) renderLive(); });
}
function hasReviewWork() {
  return !!snapshot && (!!composition?.touched || dirty && $('draftEditor').value !== snapshot.draftText
    || snapshot.edited && (!manualSession() || snapshot.parsed.status !== 'empty')
    || !!snapshot.dispositions?.length || !!snapshot.approval
    || $('reviewInterpretation').checked || $('reviewCompleteness').checked
    || !!window.formRehearsalRecheck?.capture().formText);
}
function confirmReviewReplacement(action = 'Switch review source') {
  return !hasReviewWork() || window.confirm(`${action}? Your authored edits, review decisions, approval and results will leave this view and cannot be reopened here. Export any approved specification or result, and copy any unapplied draft you need, before switching. Cancel keeps this review.`);
}
window.formRehearsalReview = Object.freeze({confirmLeave: () => confirmReviewReplacement('Switch workspace')});
async function chooseSource() {
  const nextSource = ['live', 'new'].includes($('reviewSource').value) ? $('reviewSource').value : 'recorded';
  // Restore the current choice before asking. Cancel changes no state, URL,
  // request, approval or authored work; repeated selection is a true no-op.
  $('reviewSource').value = source;
  if (nextSource === source) return;
  if (!confirmReviewReplacement()) return;
  if (practice || practiceLoad) resetPractice('Practice cleared after changing the starting point.');
  dismissLive(); clearReviewView(); invalidateInput(); configGeneration++; liveConfigLoading = false;
  source = nextSource; liveMessage = ''; liveMessageError = false;
  const url = new URL(location.href);
  if (isLive()) url.searchParams.set('source', source); else url.searchParams.delete('source');
  history.replaceState(null, '', url);
  setSourcePresentation();
  if (isLive()) { renderLive(); await loadLiveConfig(); }
  else if (recordings.length) { catalogControls(true); await start(); }
  else await bootstrap();
}
function changeLiveSelection() {
  dismissLive(); clearReviewView(); liveMessage = ''; liveMessageError = false;
  renderLive();
  if (!liveConfig || liveConfigLoading) { configGeneration++; liveConfigLoading = false; void loadLiveConfig(); }
}

const stage = () => dirty ? 'draft' : computationBusy() ? 'computation-pending' : snapshot?.state ?? 'draft';
const valid = () => !!snapshot && !dirty && snapshot.parsed.status === 'valid';
const approved = () => valid() && !!snapshot.approval;
const editable = () => manualSession() || snapshot?.originalParsed?.status === 'valid';
const currentFinding = () => !dirty && snapshot?.report?.findings?.[selected];
const uncertainError = message => Object.assign(new Error(message), {responseUncertain: true});
const stateDetails = {
  authoring: 'Empty independent draft. Choose a missing slot, select exact policy evidence and author a rule. No model response is used as a seed.',
  draft: 'Unapplied draft. Previous approval and results have been cleared from this view.',
  invalid: 'Validation failed. Approval, analysis, replay and export are blocked.',
  abstained: 'The extraction abstained. No rule interpretation is available to approve or analyze.',
  'review-needed': 'Review the proposed interpretation and every coverage slot, then explicitly approve.',
  approved: 'Exact reviewed inputs approved locally. Run analysis to compare the form with these rules.',
  analyzed: 'Analysis compares the form only with the exact rules approved below.',
  replayed: 'A fresh SurveyJS instance replayed the selected discrepancy against the reviewed rules.',
  rechecking: 'A revised form is being checked against the immutable original approved rules.',
  rechecked: 'A revised-form check completed. See the revised-form section for its current status. Original-form analysis is separate; original approval does not attest the replacement form.',
  'recheck-invalid': 'The revised form was rejected. No revised-form result is available.',
  'recheck-incomplete': 'The revised-form check did not finish. This is not a clean check.',
  'analysis-incomplete': 'Analysis did not finish. No completed analysis result is available; choose Analyze explicitly to try again.',
  'replay-incomplete': 'Replay did not finish. The earlier completed analysis remains available, with no new replay result.',
};
async function post(path, body, signal, captureExactText = false) {
  let response;
  try {
    response = await fetch(`/api/review/${path}`, {
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: json(body), signal,
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw uncertainError(path === 'start' ? 'The local session response was lost. Load this recording again.' : 'The local response was lost; the action may have completed.');
  }
  let data, exactText;
  try { if (captureExactText) {exactText = await response.text(); data = JSON.parse(exactText);} else data = await response.json(); }
  catch { throw uncertainError(path === 'start' ? 'The local server returned invalid JSON. Load this recording again.' : 'The local server returned invalid JSON; the action may have completed.'); }
  if (!response.ok) {
    if (response.status === 410 && practice) resetPractice('Practice cleared because its review expired or was released.');
    throw Object.assign(new Error(data?.error || 'The local review request failed.'), {status: response.status});
  }
  assertUnreleasedReview(data);
  return captureExactText ? {data,exactText} : data;
}
function clearAttestations() {
  $('reviewInterpretation').checked = false;
  $('reviewCompleteness').checked = false;
}
function clearError() { exportMessage = null; if (!stateUnconfirmed) currentError = ''; }
function renderError() {
  $('reviewError').textContent = currentError;
  $('reviewError').hidden = !currentError;
  // A reconciled export can be retried directly; restarting would discard a
  // confirmed review. Unconfirmed state still keeps its explicit recovery path.
  $('reviewRetry').hidden = computationRecovery || !!computationAttempt || !currentError || exportMessage?.kind === 'error' && !stateUnconfirmed && approved() && (['export-specification','export-recheck'].includes(exportMessage.action) ? !!snapshot.suppliedInput : !!currentFinding());
  if (currentError) $('reviewRetry').textContent = manualSession() ? 'Recover independent draft state' : isLive() ? 'Recover live review state' : 'Restart review with current draft';
}
function setLoading(message, failed = false) {
  $('reviewLoading').textContent = message;
  $('reviewLoading').className = failed ? 'error' : '';
  $('reviewLoading').hidden = false;
}
function catalogControls(enabled) {
  $('reviewRecording').disabled = !enabled;
  document.querySelectorAll('[name=reviewVariant]').forEach(node => { node.disabled = !enabled; });
}
function renderProvenance() {
  if (manualSession()) {
    const description = element('dl', '', 'provenance');
    for (const [label, value] of [['Rule source', practiceMatches() ? 'Authored synthetic equipment practice inputs. Rules may be loaded or edited locally; approval remains explicit. No model response.' : 'Locally authored; the starting draft contained no copied model rules'], ['Review actor', snapshot.actor.claim],
      ['Linked extraction', snapshot.priorExtraction ? snapshot.priorExtraction.originalParsed.status + ' · unchanged' : 'No extraction linked; no claim about other requests']])
      description.append(element('dt', label), element('dd', value));
    const details = element('details'); details.append(element('summary', 'Independent authorship, unchanged ancestry and unchecked decisions'),
      element('pre', json({manualProvenance: snapshot.manualProvenance, priorExtraction: snapshot.priorExtraction})));
    $('reviewProvenance').replaceChildren(description, element('p', 'Local authorship is not model extraction success or proof of policy truth. Actor identity is unverified.', 'subtle'), details);return;
  }
  const provenance = snapshot.recording.provenance;
  const description = element('dl', '', 'provenance');
  const promptSource = historicalEvidence() || provenance.contractVersion === 'quote-extraction-v3' && ['recorded-live-provider-response', 'live-provider-response', 'local-mock-transport'].includes(provenance.kind);
  const promptRevision = promptSource ? provenance.promptRevision ?? 'extraction-v3' : null;
  const items = [
    ['Review actor', snapshot.actor?.claim], ['Source claim', provenance.claim], ['Requested model', provenance.model], ['Returned model', provenance.returnedModel],
    [liveEvidence() ? 'Response date' : 'Recording date', provenance.date], ['Contract', provenance.contractVersion],
    ['Extraction prompt revision', promptRevision], ['Prompt SHA-256', promptSource ? provenance.promptSha256 : null],
    ['Prompt evidence', promptRevision === 'extraction-v5' ? 'Experimental opt-in development revision; exposed-case evidence only. No reliability or generalization claim.' : null],
    ['Run ID', provenance.runId], ['Historical status', provenance.historicalStatus],
    ...(historicalEvidence() ? [['Historical source ID', snapshot.recording.id], ['Current local review', `${snapshot.sessionId} · revision ${snapshot.revision}`], ['Execution boundary', snapshot.historicalContext?.claim]] : []),
    ['Evidence source', liveEvidence() ? provenance.kind === 'local-mock-transport' ? 'Local mock transport · not provider evidence' : 'Live provider response · source authenticity unverified' : provenance.kind === 'synthetic-omission-demonstration' ? 'Authored synthetic omission demo · no provider evidence' : 'Preserved historical provider response'],
  ];
  for (const [label, value] of items) {
    if (value !== undefined && value !== null) description.append(element('dt', label), element('dd', String(value)));
  }
  // Only verified-format HTTPS links are rendered; provenance text is never HTML.
  if (typeof provenance.runUrl === 'string') {
    try {
      const url = new URL(provenance.runUrl);
      if (url.protocol === 'https:') {
        const link = element('a', 'Inspect the original run');
        link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer';
        const value = element('dd'); value.append(link);
        description.append(element('dt', 'Source run'), value);
      }
    } catch { /* The raw provenance remains inspectable below. */ }
  }
  const details = element('details');
  details.append(element('summary', 'Request configuration and provenance hashes'), element('pre', json(provenance)));
  $('reviewProvenance').replaceChildren(description, element('p', syntheticEvidence() ? 'Authored demonstration. No provider request or response exists for this example.' : `${liveEvidence() ? 'Response' : 'Recorded'} request configuration: ${json(provenance.requestConfig ?? {})}`, 'subtle'), details);
  if (historicalEvidence()) {
    const captured = element('details'); captured.append(element('summary', 'Exact historical request, envelope and input evidence'), element('pre', json(snapshot.recording.evidence)));
    const current = element('details'); current.append(element('summary', 'Current local review release and exact original input strings'), element('pre', json({currentLocalReview: snapshot.historicalContext, originalRawInputs: snapshot.suppliedInput.rawInputs})));
    $('reviewProvenance').append(captured, current);
  }
  if (snapshot.reviewProvenance) {const lineage = element('details'); lineage.append(element('summary', 'Inspect final-draft attribution and unchecked decisions'), element('pre', json(snapshot.reviewProvenance))); $('reviewProvenance').append(lineage);}
}
// Structured edits change only the selected condition node. Quotes and targets
// stay bound to the existing draft; the server still validates every edit.
let structuredDraft = null;
const fieldDomain = field => field.kind === 'boolean' ? [false, true] : field.kind === 'choice'
  ? field.values : Array.from({length: field.max - field.min + 1}, (_, i) => field.min + i);
const nodeKind = node => node === null ? '' : typeof node === 'boolean' ? String(node) : ['all', 'any', 'not'].includes(node.op) ? node.op : 'comparison';
function draftBounds(draft, incomplete = false) {
  for (const rule of draft.rules) {
    let count = 0;
    const walk = (node, depth = 0) => {
      if (++count > 256 || depth > 8) throw new Error('This edit exceeds the condition limit (256 nodes, depth 8).');
      if (typeof node === 'boolean' || incomplete && node === null) return;
      if (node.op === 'not') walk(node.arg, depth + 1);
      if (['all', 'any'].includes(node.op)) {
        if (node.args.length < 1 || node.args.length > 8) throw new Error('A group needs 1–8 conditions.');
        node.args.forEach(arg => walk(arg, depth + 1));
      }
    };
    walk(rule.condition);
  }
}
function markDraftEdited() {
  generation++; dirty = true; clearAttestations(); clearError(); replayMessage = null;
  snapshot.approval = null; snapshot.report = null;
  if (!computationBusy()) {snapshot.computation = null;computationMessage = '';}
  renderOverview(); renderRules(); renderChanges(); renderFindings(); renderReplay(); renderControls();
}
const conditionPrefix = (index, path) => `condition-${index}-${path.join('-') || 'root'}`;
function focusCondition(primary, fallback) {
  const control = $(primary) ?? $(fallback), editor = control?.closest?.('.condition-editor');
  if (editor) editor.open = true;
  control?.focus?.();
}
function editCondition(index, path, change, focusId, fallbackFocusId) {
  if (!snapshot || !editable() || composition || stateUnconfirmed || (dirty && !structuredDraft)) return;
  const draft = JSON.parse(JSON.stringify(structuredDraft ?? snapshot.parsed.rawResult));
  try {
    let parent = draft.rules[index], member = 'condition';
    for (const part of path) { parent = parent[member]; member = part; }
    parent[member] = change(parent[member]);
    draftBounds(draft);
    const text = json(draft);
    if (new Blob([text]).size > 65536) throw new Error('This edit exceeds the 65536-byte draft limit.');
    structuredDraft = draft; $('draftEditor').value = text; markDraftEdited();
    focusCondition(focusId, fallbackFocusId);
  } catch (error) { renderRules(); currentError = error.message; renderControls(); focusCondition(fallbackFocusId, focusId); }
}
function conditionEditor(index, condition, {incomplete = false, onChange = null, property = null} = {}) {
  const drivers = snapshot.family.fields.filter(field => field.role === 'driver');
  const comparison = () => incomplete ? {op: null, field: null, value: null} : {op: 'eq', field: drivers[0].name, value: fieldDomain(drivers[0])[0]};
  const walk = (node, path = []) => {
    const group = element('fieldset', '', 'ast-node'), prefix = conditionPrefix(index, path);
    group.append(element('legend', path.length ? 'Nested condition' : 'Rule condition'));
    const change = (fn, focusId = `${prefix}-type`) => onChange ? onChange(path, fn, focusId, `${prefix}-type`) : editCondition(index, path, fn, focusId, `${prefix}-type`);
    const select = (labelText, suffix, options, value, fn, unavailable = false) => {
      const label = element('label', labelText), input = element('select');
      input.id = `${prefix}-${suffix}`; label.htmlFor = input.id;
      for (const [value, text] of options) { const option = element('option', text); option.value = value; input.append(option); }
      input.value = String(value); input.disabled = stateUnconfirmed || unavailable || !!onChange && !!pending?.resolution;
      input.addEventListener('change', () => change(old => fn(old, input.value), input.id));
      label.append(input); group.append(label);
    };
    const button = (text, suffix, fn, disabled = false) => {
      const button = element('button', text, 'secondary'); button.id = `${prefix}-${suffix}`; button.type = 'button'; button.disabled = stateUnconfirmed || disabled;
      button.addEventListener('click', fn); group.append(button);
    };
    select('Condition type', 'type', [...(incomplete ? [['', 'Choose a condition…']] : []), ['all', 'ALL conditions'], ['any', 'ANY condition'], ['not', 'NOT condition'],
      ['comparison', 'Compare an input'], ['true', property === 'required' ? 'Always required when shown' : property === 'visible' ? 'Always shown' : 'Always true'], ['false', property === 'required' ? 'Never required' : property === 'visible' ? 'Never shown' : 'Always false']], nodeKind(node), (old, kind) => {
      if (kind === '') return null;
      if (kind === nodeKind(old)) return old;
      if (kind === 'true' || kind === 'false') return kind === 'true';
      if (kind === 'comparison') return comparison();
      if (kind === 'not') return {op: 'not', arg: old};
      return ['all', 'any'].includes(old?.op) ? {...old, op: kind} : {op: kind, args: [old]};
    });
    if (['all', 'any'].includes(node?.op)) {
      node.args.forEach((arg, position) => {
        const child = walk(arg, [...path, 'args', position]);
        if (node.args.length > 1) {
          const remove = element('button', 'Remove this condition', 'secondary'); remove.id = `${conditionPrefix(index, [...path, 'args', position])}-remove`; remove.type = 'button'; remove.disabled = stateUnconfirmed;
          remove.addEventListener('click', () => change(old => ({...old, args: old.args.filter((_, i) => i !== position)}),
            `${conditionPrefix(index, [...path, 'args', Math.min(position, node.args.length - 2)])}-type`));
          child.append(remove);
        }
        group.append(child);
      });
      button('Add a comparison', 'add', () => change(old => ({...old, args: [...old.args, comparison()]}),
        `${conditionPrefix(index, [...path, 'args', node.args.length])}-type`), node.args.length >= 8);
    } else if (node?.op === 'not') {
      group.append(walk(node.arg, [...path, 'arg']));
      button('Remove NOT', 'remove-not', () => change(old => old.arg));
    } else if (node && typeof node !== 'boolean') {
      const field = drivers.find(field => field.name === node.field);
      select('Independent input', 'field', [...(incomplete ? [['', 'Choose an input…']] : []), ...drivers.map(field => [field.name, field.name])], node.field ?? '', (old, name) => {
        const next = drivers.find(field => field.name === name);
        if (!next) return {op: null, field: null, value: null};
        const values = fieldDomain(next), allowed = ['eq', 'ne', ...(next.kind === 'integer' ? ['gt', 'gte', 'lt', 'lte'] : [])];
        return {...old, field: name, op: allowed.includes(old.op) ? old.op : incomplete ? null : 'eq',
          value: values.includes(old.value) ? old.value : incomplete ? null : values[0]};
      });
      select('Comparison', 'operator', [...(incomplete ? [['', 'Choose a comparison…']] : []), ['eq', 'equals'], ['ne', 'does not equal'], ...(field?.kind === 'integer'
        ? [['gt', 'greater than'], ['gte', 'at least'], ['lt', 'less than'], ['lte', 'at most']] : [])], node.op ?? '', (old, op) => ({...old, op: op || null}), !field);
      const values = field ? fieldDomain(field) : [], selectedValue = values.indexOf(node.value);
      select('Value', 'value', [...(incomplete ? [['', 'Choose a value…']] : []), ...values.map((value, i) => [String(i), String(value)])], selectedValue < 0 ? '' : selectedValue,
        (old, i) => ({...old, value: i === '' ? null : values[Number(i)]}), !field);
    }
    return group;
  };
  return walk(condition);
}
function appendEditor(card, index, rule, disclosureKey = null) {
  if (historicalEvidence()) return;
  const details = element('details', '', 'condition-editor'); details.open = structuredDraft !== null;
  details.append(element('summary', 'Correct this condition'), element('p', 'Change the proposed condition, then apply and validate the draft. Every edit clears approval and results.', 'subtle'), conditionEditor(index, rule.condition));
  retainRuleDisclosure(details, disclosureKey);
  card.append(details);
}
function behaviorTable(behavior, indexes, columns, caption, {firstDriver = null, examples = false} = {}) {
  const drivers = firstDriver ? [firstDriver, ...behavior.drivers.filter(name => name !== firstDriver)] : behavior.drivers;
  const prediction = (column, index) => column.values === null ? 'Unknown · not checked' : propertyState(column.property, column.values[index]);
  const group = element('div', '', 'behavior-table-group'), wrapper = element('div', '', 'behavior-table-wrap'), table = element('table', '', `behavior-table${columns.length === 2 ? ' behavior-comparison' : ''}${columns.length === 2 && behavior.drivers.length === 1 ? ' behavior-single-input' : ''}`);
  const visibleCaption = element('p', caption, 'behavior-caption'); visibleCaption.ariaHidden = 'true';
  group.append(visibleCaption);
  if (examples) {
    const summary = element('ul', '', 'behavior-example-summary');
    for (const index of indexes) {
      const inputs = drivers.map(name => `${name} = ${JSON.stringify(behavior.rows[index][behavior.drivers.indexOf(name)])}`).join('; ');
      summary.append(element('li', `${inputs}. ${columns.map(column => `${column.label}: ${prediction(column, index)}`).join('; ')}.`));
    }
    group.append(summary);
  }
  group.append(element('p', 'Predictions come first. Scroll sideways to see all input values in the table.', 'behavior-scroll-hint'));
  wrapper.tabIndex = 0;
  // Keep a semantic caption for table navigation; the visible copy sits outside
  // horizontal scrolling so its complete explanation fits narrow screens.
  table.append(element('caption', caption));
  const head = element('thead'), row = element('tr');
  for (const column of columns) {const cell = element('th', column.label, 'behavior-output'); cell.scope = 'col'; row.append(cell);}
  for (const name of drivers) {const cell = element('th', name, name === firstDriver ? 'behavior-changed-input' : ''); cell.scope = 'col'; row.append(cell);}
  head.append(row); table.append(head);
  const body = element('tbody');
  for (const index of indexes) {
    const row = element('tr'); row.dataset.row = index;
    for (const column of columns) row.append(element('td', prediction(column, index), 'behavior-output'));
    for (const name of drivers) row.append(element('td', String(behavior.rows[index][behavior.drivers.indexOf(name)]), name === firstDriver ? 'behavior-changed-input' : ''));
    body.append(row);
  }
  table.append(body); wrapper.append(table); group.append(wrapper); return group;
}
function fullBehaviorTable(parent, behavior, indexes, columns, label, firstDriver = null, disclosureKey = null) {
  const details = element('details', '', 'full-behavior'), content = element('div');
  details.append(element('summary', label), content);
  let rendered = false;
  const renderContent = () => {
    if (details.open && !rendered) {rendered = true; content.append(behaviorTable(behavior, indexes, columns, label, {firstDriver}));}
  };
  retainRuleDisclosure(details, disclosureKey);
  details.addEventListener('toggle', renderContent); renderContent();
  parent.append(details);
}
function appendBehavior(card, rule, behaviorRule, evidence = card, disclosureKey = null) {
  const behavior = snapshot.behavior;
  if (!behavior || !behaviorRule) return;
  card.append(element('p', behaviorRule.text, 'behavior-predicate'));
  card.append(element('p', `Draft predictions only; not verified policy truth.${rule.property === 'required' ? ' Requiredness assumes this field is shown. Review visibility separately.' : ''}`, 'subtle'));
  const depends = behaviorRule.influences.map(pair => pair.field), ignored = behavior.drivers.filter(name => !depends.includes(name));
  evidence.append(element('p', `Inputs that actually change this result: ${depends.join(', ') || 'none (constant over the declared domain)'}.`, 'behavior-dependencies'));
  if (ignored.length) evidence.append(element('p', `No effect over this domain: ${ignored.join(', ')}.`, 'subtle'));
  for (const pair of behaviorRule.influences) {
    evidence.append(behaviorTable(behavior, [pair.before, pair.after], [{label: 'Draft prediction', property: rule.property, values: behaviorRule.values}], `Change only ${pair.field}; all other inputs stay the same`, {firstDriver: pair.field, examples: true}));
  }
  if (!depends.length) evidence.append(behaviorTable(behavior, behaviorRule.examples, [{label: 'Draft prediction', property: rule.property, values: behaviorRule.values}], 'Example of the constant prediction', {examples: true}));
  fullBehaviorTable(evidence, behavior, behavior.rows.map((_, i) => i), [{label: 'Draft prediction', property: rule.property, values: behaviorRule.values}], `All ${behavior.rows.length} assignments`, null, disclosureKey);
}

// One incomplete missing-slot composition at a time. No provider or default rule.
let composition = null;
const slotName = value => `${value.field}/${value.property}`;
const ruleCardId = value => `rule-${value.field}-${value.property}`;
function completeCondition(node) {
  if (typeof node === 'boolean') return true;
  if (!node || typeof node !== 'object') return false;
  if (node.op === 'not') return completeCondition(node.arg);
  if (['all', 'any'].includes(node.op)) return Array.isArray(node.args) && node.args.length > 0 && node.args.length <= 8 && node.args.every(completeCondition);
  const field = snapshot.family.fields.find(field => field.role === 'driver' && field.name === node.field);
  return !!field && ['eq', 'ne', ...(field.kind === 'integer' ? ['gt', 'gte', 'lt', 'lte'] : [])].includes(node.op) && fieldDomain(field).includes(node.value);
}
function resolutionReady() {
  if (!composition?.touched || composition.evidenceInvalid || composition.conflict) return false;
  if (composition.classification === 'rule') return !historicalEvidence() && !!composition.selection && completeCondition(composition.condition);
  return ['unsupported', 'ambiguous'].includes(composition.classification) && !!composition.reason.trim() && composition.reason.length <= 600
    && (composition.classification === 'unsupported' ? ['not-stated', 'outside-grammar'].includes(composition.reasonCode) : composition.reasonCode === 'ambiguous');
}
function resolutionBody() {
  const {field, property, classification, condition, selection, reasonCode, reason} = composition;
  return classification === 'rule' ? {field, property, classification, condition, selection}
    : {field, property, classification, reasonCode, reason, selection: classification === 'unsupported' ? null : selection};
}
function touchComposition(focusId, rerender = true) {
  composition.touched = true; composition.error = composition.evidenceInvalid ? 'Clear the invalid selection or select a valid passage before applying.' : ''; generation++; dirty = true;
  clearAttestations(); clearError(); snapshot.approval = null; snapshot.report = null; replayMessage = null;
  renderOverview(); renderRules(); renderChanges(); renderFindings(); renderReplay();
  if (rerender) renderResolution(); renderControls();
  if (focusId) $(focusId)?.focus?.();
}
function openResolution(slot) {
  if (!snapshot || !editable() || !canResolve() || pending || stateUnconfirmed || composition) return;
  const old = snapshot.dispositions.find(value => slotName(value) === slotName(slot));
  composition = {field: slot.field, property: slot.property, classification: old?.kind ?? '', reasonCode: old?.reasonCode ?? '',
    reason: old?.reason ?? '', selection: old?.evidence ? {start: old.evidence.start, end: old.evidence.end} : null,
    condition: null, touched: false, evidenceInvalid: false, error: ''};
  renderResolution(); renderControls(); $('resolutionClassification').focus();
}
function cancelResolution() {
  if (!composition || manualSession() && (stateUnconfirmed || pending?.resolution)) return;
  const slot = composition, touched = composition.touched; composition = null;
  $('resolutionStatus').textContent = touched ? 'Composition discarded. Apply and validate the retained draft before fresh approval.' : 'Missing-rule composer closed without changing the review.';
  if (touched) {structuredDraft = null; $('draftEditor').value = snapshot.draftText; markDraftEdited();}
  else render();
  renderResolution(); renderControls();
  $(touched ? 'applyDraft' : `resolve-${slot.field}-${slot.property}`)?.focus?.();
}
function editComposition(path, change, focusId, fallback) {
  if (!composition || pending?.resolution || manualSession() && stateUnconfirmed) return;
  const candidate = {condition: JSON.parse(JSON.stringify(composition.condition))};
  try {
    let parent = candidate, key = 'condition';
    for (const part of path) {parent = parent[key]; key = part;}
    parent[key] = change(parent[key]); draftBounds({rules: [candidate]}, true);
    composition.condition = candidate.condition; touchComposition(focusId);
  } catch (error) {composition.error = error.message; renderResolution(); renderControls(); $(fallback)?.focus?.();}
}
// Textarea values normalize CR/CRLF to LF. Map display selection boundaries
// back to the immutable original UTF-16 offsets; never normalize the quote.
function policySelectionView(policy) {
  let text = ''; const offsets = [0];
  for (let i = 0; i < policy.length;) {
    const char = policy[i++];
    if (char === '\r') {if (policy[i] === '\n') i++; text += '\n';} else text += char;
    offsets.push(i);
  }
  return {text, offsets};
}
function renderResolution() {
  $('resolutionPanel').hidden = !composition; $('resolutionFields').replaceChildren();
  if (!composition) return;
  const c = composition;
  for (const id of ['resolutionClassification', 'resolutionPolicy', 'useResolutionEvidence', 'clearResolutionEvidence', 'resolutionReasonCode', 'resolutionReasonText']) $(id).disabled = !!pending?.resolution || manualSession() && stateUnconfirmed;
  $('cancelResolution').disabled = manualSession() && (stateUnconfirmed || !!pending?.resolution);
  $('resolutionTitle').textContent = `Resolve missing rule: ${c.field} · ${c.property}`;
  $('resolutionPolicy').value = policySelectionView(snapshot.family.policy).text; $('resolutionClassification').value = c.classification;
  $('resolutionEvidence').hidden = !['rule', 'ambiguous'].includes(c.classification);
  $('resolutionReason').hidden = !['unsupported', 'ambiguous'].includes(c.classification);
  $('resolutionReasonCode').replaceChildren();
  for (const [value, text] of [['', 'Choose a reason…'], ...(c.classification === 'ambiguous' ? [['ambiguous', 'Cannot choose one faithful interpretation']]
    : [['not-stated', 'Policy does not state this property'], ['outside-grammar', 'Cannot represent it in the supported grammar']])]) {
    const option = element('option', text); option.value = value; $('resolutionReasonCode').append(option);
  }
  $('resolutionReasonCode').value = c.reasonCode; $('resolutionReasonText').value = c.reason;
  $('resolutionQuote').textContent = c.selection ? snapshot.family.policy.slice(c.selection.start, c.selection.end) : 'No evidence selected.';
  $('resolutionOffsets').textContent = c.selection ? `Exact original policy selection: UTF-16 [${c.selection.start}, ${c.selection.end}), including original line endings. Text grounding is not proof of meaning.` : 'Use keyboard selection (Shift + arrows) or a pointer in the read-only policy, then choose Use selected passage.';
  if (c.classification === 'rule') $('resolutionFields').append(conditionEditor('composer', c.condition, {incomplete: true, onChange: editComposition, property: c.property}));
  $('resolutionError').textContent = c.error; $('resolutionError').hidden = !c.error;
  $('resolutionGuidance').textContent = c.classification === 'rule'
    ? 'Choose every predicate input explicitly. Apply validates the complete draft. Requiredness assumes the field is shown.'
    : c.classification ? 'This records why the rule is unchecked. It adds no condition; the result remains unknown.' : 'Choose what the policy supports. No condition has been invented.';
}
function selectCompositionEvidence() {
  if (!composition || pending?.resolution || manualSession() && stateUnconfirmed || !['rule', 'ambiguous'].includes(composition.classification)) return;
  const textarea = $('resolutionPolicy'), policy = snapshot.family.policy, view = policySelectionView(policy);
  const start = view.offsets[textarea.selectionStart], end = view.offsets[textarea.selectionEnd], quote = policy.slice(start, end);
  if (textarea.value !== view.text || !Number.isInteger(start) || !Number.isInteger(end) || start >= end || !quote.trim() || !quote.isWellFormed()) {
    composition.error = 'Select a nonempty passage without splitting a Unicode character.';
  } else if (policy.indexOf(quote) !== start || policy.indexOf(quote, start + 1) !== -1) {
    composition.error = 'Select more surrounding text: this passage must occur exactly once.';
  } else {composition.selection = {start, end}; composition.evidenceInvalid = false; touchComposition('useResolutionEvidence'); return;}
  const error = composition.error; composition.selection = null; touchComposition(null, false); composition.evidenceInvalid = true; composition.error = error;
  renderResolution(); renderControls(); $('useResolutionEvidence').focus();
}
function renderActor() {
  $('reviewActorPanel').hidden = isLive();
  const locked = snapshot?.actor?.basis === 'server-simulation';
  if (locked) {$('reviewActor').value = 'agent-simulation'; $('reviewHumanAttestation').checked = false;}
  const kind = $('reviewActor').value || 'unattributed-local';
  $('reviewHumanLabel').hidden = kind !== 'self-reported-human';
  const unavailable = !snapshot || locked || !!pending || isLive();
  $('reviewActor').disabled = unavailable; $('reviewHumanAttestation').disabled = unavailable;
  $('startActorReview').disabled = unavailable || kind === 'self-reported-human' && !$('reviewHumanAttestation').checked;
  $('reviewActorStatus').textContent = snapshot?.actor?.claim ?? 'Load an example before choosing a review context. The current context is not yet confirmed.';
}
function derivationText(slot, brief = false) {
  if (manualSession()) return `Independently authored rule. ${snapshot.actor.claim}${brief ? '' : ' No model-success or edit-history claim.'}`;
  const label = {'matches-original': provenanceKind() === 'synthetic-omission-demonstration' ? 'Original authored demo proposal retained' : provenanceKind() === 'local-mock-transport' ? 'Original mock proposal retained' : 'Model-proposed rule retained',
    'locally-modified': provenanceKind() === 'synthetic-omission-demonstration' ? 'Locally modified authored demo proposal' : provenanceKind() === 'local-mock-transport' ? 'Locally modified mock proposal' : 'Locally modified model proposal', 'locally-added': 'Locally added rule', removed: 'Original rule removed', omitted: 'No executable rule'}[slot.derivation];
  return `${label}. ${snapshot.actor.claim}${brief ? '' : ' Final-draft comparison, not an edit history.'}`;
}

const invalidRuleReasons = {
  'invalid-final-json': 'The response is not valid JSON in the supported rule format.',
  'invalid-wire-schema': 'The response does not match the supported rule format.',
  'invalid-normalized-schema': 'The response could not be converted to supported rules.',
  'quote-not-found': 'A quoted passage does not occur exactly in the policy.',
  'quote-not-unique': 'A quoted passage occurs more than once, so its source is unclear.',
  'quote-not-well-formed': 'A quoted passage contains an incomplete Unicode character.',
};
const wireDiagnosticMessages = Object.freeze({
  'missing-rules-member': 'The response is missing the required rules member.',
  'root-shape': 'The response has an unsupported top-level structure.',
  'rule-shape': 'A rule has missing or unsupported members.',
  'duplicate-slot': 'A target/property is listed more than once.',
  'unsupported-rule-property': 'A rule uses an unsupported property. Only visible and required are supported. Check the source policy and form before authoring a separate interpretation.',
  'unsupported-condition-operator': 'A condition uses an unsupported operator. Check the source policy before authoring a separate interpretation; an exact quote alone does not establish the intended rule.',
  'condition-driver-not-declared': 'A condition refers to a field that is not a declared independent driver. Check the form and driver list, and clarify the source policy if the intended condition is unclear.',
  'condition-value-outside-domain': "A condition uses a value outside its driver's declared domain. Check the declared domain and clarify the source policy before authoring a separate interpretation.",
});
function wireDiagnosticText(parsed) {
  try {
    if (!snapshot || !isNew() || manualSession() || dirty || stateUnconfirmed || pending || manualOperation
      || pendingLive() || liveOperation?.busy || liveDismissal || !liveEvidence() || snapshot.variant !== 'supplied'
      || snapshot.reviewVersion !== 4 || snapshot.state !== 'invalid' || snapshot.recording?.provenance?.contractVersion !== 'quote-extraction-v3'
      || !validatedInput || snapshot.suppliedInput?.inputId !== validatedInput.inputId
      || snapshot.draftText !== snapshot.recording?.rawFinalText) return '';
    for (const result of [parsed, snapshot.originalParsed]) {
      if (result?.contractVersion !== 'quote-extraction-v3' || result.status !== 'invalid'
        || result.strictJsonValid !== true || result.wireSchemaValid !== false || result.error !== 'invalid-wire-schema') return '';
    }
    const value = snapshot.validationDiagnostic;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
    const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
    const names = ['kind', 'version', 'revision', 'state', 'code'];
    if (keys.length !== names.length || keys.some(key => typeof key !== 'string' || !names.includes(key)
      || !descriptors[key].enumerable || !Object.hasOwn(descriptors[key], 'value'))) return '';
    const detail = Object.fromEntries(names.map(name => [name, descriptors[name].value]));
    if (detail.kind !== 'current-wire-rejection-detail' || detail.version !== 1 || detail.state !== 'observed'
      || !Number.isSafeInteger(detail.revision) || detail.revision < 0 || detail.revision !== snapshot.revision
      || typeof detail.code !== 'string' || !Object.hasOwn(wireDiagnosticMessages, detail.code)) return '';
    return ` Structural detail: ${wireDiagnosticMessages[detail.code]}`;
  } catch { return ''; } // Optional display never disrupts the retained result.
}
function refreshWireDiagnostic() {
  if (snapshot?.validationDiagnostic && !manualSession() && !dirty && snapshot.parsed?.status === 'invalid') {
    $('reviewValidation').textContent = invalidRuleMessage(snapshot.parsed);
  }
}
function invalidRuleMessage(parsed) {
  if (manualSession()) return `Independent draft is invalid: ${parsed.error || 'unsupported authored rule'}. Correct it, then apply and review it again. The linked extraction, if any, is unchanged.`;
  const reason = invalidRuleReasons[parsed.error] ?? 'The response could not be validated as a supported rule set.';
  const recovery = editable() ? 'Correct the draft, then Apply and validate draft.'
    : `${isLive() ? 'Choose another input or example.' : 'Choose another recording.'} This original response cannot be edited or approved.`;
  return `Invalid extraction: ${reason} ${recovery} Error code: ${parsed.error || 'unsupported-response'}. No correction or author-reference fallback has been applied.${wireDiagnosticText(parsed)}`;
}
function renderRules() {
  const approval = approved() && !stateUnconfirmed ? `${snapshot.sessionId}/${snapshot.approval.approvalHash}` : null;
  const sameApproval = approval && approval === ruleEvidenceApproval;
  const focusedSummary = sameApproval && [...ruleEvidenceNodes.values()].some(node => node.children[0] === document.activeElement)
    ? document.activeElement.id : null;
  ruleEvidenceOpen = sameApproval ? new Map([...ruleEvidenceNodes].map(([key, node]) => [key, !!node.open])) : new Map();
  ruleEvidenceNodes = new Map(); ruleEvidenceApproval = approval;
  $('reviewRules').replaceChildren();
  $('reviewCoverage').replaceChildren();
  const parsed = snapshot.parsed;
  $('reviewValidation').className = parsed.status === 'invalid' && !dirty ? 'error' : 'subtle';
  if (dirty) {
    $('reviewValidation').textContent = 'Apply and validate this draft before reviewing its proposed rules or coverage.';
    if (structuredDraft) for (const [index, rule] of structuredDraft.rules.entries()) {
      const card = element('article', '', 'rule-card'); card.dataset.target = `${rule.field}/${rule.property}`;
      card.append(element('h3', `${rule.field} · ${rule.property}`), element('blockquote', rule.quote));
      appendEditor(card, index, rule); $('reviewRules').append(card);
    }
    return;
  }
  if (parsed.status !== 'valid') {
    $('reviewValidation').textContent = manualEmpty() ? 'Empty independent draft. Use a missing-rule action below to author the first rule from exact policy evidence.' : parsed.status === 'abstain'
      ? 'No rules proposed: the extraction abstained.'
      : invalidRuleMessage(parsed);
  } else {
    $('reviewValidation').textContent = 'Validated structure and exact quote occurrence. Semantic interpretation still requires your review.';
    for (const [index, rule] of parsed.normalizedResult.rules.entries()) {
      const card = element('article', '', 'rule-card');
      card.dataset.target = `${rule.field}/${rule.property}`; card.id = ruleCardId(rule); card.tabIndex = -1;
      card.append(element('h3', `${rule.field} · ${rule.property}`), element('blockquote', rule.source.quote));
      const lineage = (manualSession() ? snapshot.manualProvenance : snapshot.reviewProvenance)?.slots.find(slot => slotName(slot) === slotName(rule));
      if (lineage) card.append(element('p', derivationText(lineage, !!approval), 'rule-attribution'));
      if (approval) card.append(element('p', 'Approved · original-form review only', 'rule-approval'));
      const evidence = approval ? element('details', '', 'approved-rule-evidence') : card;
      if (approval) {
        evidence.append(element('summary', 'Inspect examples and full rule provenance'));
        retainRuleDisclosure(evidence, `${card.id}-evidence`);
        if (lineage) evidence.append(element('p', derivationText(lineage), 'rule-attribution'));
      }
      appendBehavior(card, rule, snapshot.behavior?.rules.find(item => item.target === `${rule.field}/${rule.property}`), evidence,
        approval ? `${card.id}-assignments` : null);
      const ast = element('details'); ast.append(element('summary', 'Advanced: condition JSON'), element('pre', json(rule.condition)));
      if (approval) retainRuleDisclosure(ast, `${card.id}-condition`);
      evidence.append(ast);
      // Keep correction reachable without opening the supplemental evidence.
      if (approval) card.append(evidence);
      if (editable() && !composition) appendEditor(card, index, rule, approval ? `${card.id}-editor` : null);
      evidence.append(element('p', `Exact policy occurrence: UTF-16 offsets [${rule.source.start}, ${rule.source.end}). Occurrence does not establish entailment.`, 'subtle'));
      $('reviewRules').append(card);
    }
    const details = element('details'), normalized = element('pre', json(parsed.normalizedResult));
    normalized.id = 'normalizedRules';
    details.append(element('summary', 'Inspect the validated normalized rule AST'), normalized);
    $('reviewRules').append(details);
  }
  const table = element('table', '', 'coverage-table'); table.role = 'table';
  const caption = element('caption', parsed.status === 'valid' ? 'Coverage of the current validated proposed rules' : 'No valid proposed rule set is available for checking');
  const head = element('thead'), headRow = element('tr');
  head.role = 'rowgroup'; headRow.role = 'row';
  for (const value of ['Target', 'Property', 'Coverage']) { const cell = element('th', value); cell.scope = 'col'; cell.role = 'columnheader'; headRow.append(cell); }
  head.append(headRow);
  const body = element('tbody');
  body.role = 'rowgroup';
  for (const slot of snapshot.coverage) {
    const row = element('tr'); row.role = 'row';
    row.dataset.field = slot.field; row.dataset.property = slot.property; row.dataset.present = String(slot.present);
    const name = element('th'); name.scope = 'row'; name.role = 'rowheader';
    const mobileLabel = value => {const label = element('span', value, 'coverage-label'); label.ariaHidden = 'true'; return label;};
    name.append(mobileLabel('Target'), element('span', slot.field));
    const disposition = snapshot.dispositions?.find(value => slotName(value) === slotName(slot));
    const unavailable = parsed.status !== 'valid' && !manualEmpty();
    const status = element('td', unavailable ? parsed.status === 'abstain' ? 'Unavailable · no rules proposed' : 'Unavailable · response not validated'
      : slot.present ? 'Present · review interpretation' : disposition ? `${disposition.kind} · not checked. ${disposition.reason}` : 'Omitted · not checked · unresolved', unavailable ? 'unavailable' : slot.present ? '' : 'omitted');
    status.role = 'cell'; status.className = `${status.className || ''} coverage-status`.trim();
    if (slot.present) {const link = element('a', 'Inspect rule'); link.href = `#${ruleCardId(slot)}`; status.append(link);}
    else if (editable() && (parsed.status === 'valid' || manualEmpty())) {
      const resolve = element('button', disposition ? 'Change why this is unchecked' : 'Resolve missing rule', 'secondary'); resolve.type = 'button'; resolve.id = `resolve-${slot.field}-${slot.property}`;
      resolve.disabled = !!pending || stateUnconfirmed || !!composition; resolve.addEventListener('click', () => openResolution(slot)); status.append(resolve);
    }
    const property = element('td'); property.role = 'cell'; property.append(mobileLabel('Property'), element('span', slot.property));
    row.append(name, property, status);
    body.append(row);
  }
  table.append(caption, head, body); $('reviewCoverage').append(table);
  if (focusedSummary) focusVisible($(focusedSummary));
}
function renderChanges() {
  $('reviewChanges').replaceChildren();
  if (manualSession()) {
    $('reviewChanges').append(element('p', 'Independent authored predicates have no model baseline. Review their current prediction tables and exact evidence above; missing slots remain unknown.', 'subtle'));
    for (const disposition of snapshot.dispositions ?? []) $('reviewChanges').append(element('p', `${slotName(disposition)}: ${disposition.kind}, unknown and not checked. ${disposition.reason}`, 'unchecked-disposition'));
    return;
  }
  if (dirty) { $('reviewChanges').append(element('p', 'Apply the draft to compute its target/property before-and-after changes.', 'subtle')); return; }
  if (!snapshot.edited && !snapshot.dispositions?.length) { $('reviewChanges').append(element('p', `Using the original ${syntheticEvidence() ? 'authored synthetic proposal' : liveEvidence() ? 'extraction response' : 'recorded response'}. No local edits have been applied.`, 'subtle')); return; }
  $('reviewChanges').append(element('p', `Compared with the original ${syntheticEvidence() ? 'synthetic proposal' : liveEvidence() ? 'extraction' : 'recording'}.`, 'subtle'));
  if (snapshot.parsed.status !== 'valid') {
    $('reviewChanges').append(element('p', 'The applied draft is not valid. No changed rule set can be approved or analyzed.', 'error'));
    return;
  }
  for (const disposition of snapshot.dispositions ?? []) $('reviewChanges').append(element('p', `${slotName(disposition)}: ${disposition.kind}, unknown and not checked. ${disposition.reason}`, 'unchecked-disposition'));
  const unchanged = element('details', '', 'unchanged-behavior');
  unchanged.append(element('summary', `${snapshot.behavior?.changes.filter(change => !change.changedRows.length).length ?? 0} rules with unchanged predictions · inspect full evidence`));
  if (snapshot.behavior) for (const change of snapshot.behavior.changes) {
    const card = element('section', '', 'behavior-change'); card.dataset.target = change.target;
    const property = change.target.split('/')[1], behavior = snapshot.behavior;
    const columns = [{label: 'Original prediction', property, values: change.original}, {label: 'Edited prediction', property, values: change.current}];
    const firstDriver = behavior.rules.find(rule => rule.target === change.target)?.influences[0]?.field ?? null;
    card.append(element('h4', `${change.target}: ${change.changedRows.length} of ${behavior.rows.length} assignments changed (rule predictions)`));
    if (property === 'required') card.append(element('p', 'Assuming this field is shown; visibility is reviewed separately. These counts describe rule predictions, not executed form states. Hidden-field combinations are included; the form checker compares requiredness only while the field is visible.', 'subtle'));
    if (change.original === null || change.current === null) card.append(element('p', 'A missing rule is unknown and not checked, never false.', 'subtle'));
    if (change.changedRows.length) card.append(behaviorTable(behavior, change.changedRows.slice(0, 4), columns, 'Examples that distinguish original and edited predictions', {firstDriver, examples: true}));
    if (change.changedRows.length) fullBehaviorTable(card, behavior, change.changedRows, columns, `All ${change.changedRows.length} changed assignments`, firstDriver);
    fullBehaviorTable(card, behavior, behavior.rows.map((_, i) => i), columns, `Complete before/after table: ${behavior.rows.length} assignments`, firstDriver);
    (change.changedRows.length ? $('reviewChanges') : unchanged).append(card);
  }
  if (unchanged.children.length > 1) $('reviewChanges').append(unchanged);
  if (!snapshot.changes.length) $('reviewChanges').append(element('p', 'Draft text changed; the server reports no target/property rule changes.', 'subtle'));
  for (const change of snapshot.changes) {
    const card = element('section', '', 'rule-change'); card.dataset.target = change.target;
    const columns = element('div', '', 'columns');
    const before = element('div'), after = element('div');
    before.append(element('h4', syntheticEvidence() ? 'Original authored rule' : liveEvidence() ? 'Original extracted rule' : 'Original recorded rule'), element('pre', json(change.original)));
    after.append(element('h4', 'Current edited rule'), element('pre', json(change.current)));
    columns.append(before, after); card.append(element('h4', change.target), columns);
    $('reviewChanges').append(card);
  }
}
function jumpTo(id) {
  const target = $(id);
  if (availableFocus(target)) { target.focus(); target.scrollIntoView?.({block: 'start'}); }
}
function originalBlock() {
  if (editable()) return null;
  const reason = snapshot.originalParsed.status === 'abstain' ? 'The original response abstained and contains no rules to review.' : 'The original response is invalid.';
  return `${reason} Approval, analysis, replay and export of this response are blocked. ${isNew() ? 'Start a separate independent draft from exact policy evidence above, or choose another input.' : isLive() ? 'Choose another input or example.' : 'Choose another recording.'}`;
}
function renderOverview() {
  const blocked = originalBlock(), coverage = snapshot.reviewCoverage;
  const changed = snapshot.behavior?.changes.filter(change => change.changedRows.length).length ?? 0;
  $('reviewOverviewCounts').textContent = blocked || (stateUnconfirmed ? 'Server state is unconfirmed. Recover the review before relying on its coverage or changed predictions.' : dirty ? 'Unapplied edits. Apply and validate before reviewing the coverage or changed predictions.'
    : manualEmpty() ? 'Empty independent draft. Author at least one rule and decide every other slot before approval; no model rule has been copied.'
    : snapshot.parsed.status !== 'valid' ? 'The applied draft is invalid. Correct it and validate again.'
    : `${coverage.present} rules present; ${coverage.unchecked.length} check${coverage.unchecked.length === 1 ? ' remains' : 's remain'} unchecked; ${coverage.unresolved.length} missing rule${coverage.unresolved.length === 1 ? ' needs' : 's need'} a decision. ${changed} rule${changed === 1 ? ' has' : 's have'} changed predictions.`);
  $('reviewNavRecheck').hidden = !snapshot.suppliedInput;
  $('reviewNavPolicyImpact').hidden = !snapshot.suppliedInput;
  $('reviewNavRecheckStatus').hidden = !snapshot.suppliedInput;
  $('reviewReplayScope').hidden = !snapshot.suppliedInput;
  $('reviewJumpSource').hidden = !blocked;
  $('reviewJumpSource').textContent = isNew() && blocked ? 'Go to independent authoring' : isLive() ? 'Choose another input or example' : 'Choose another recording';
  $('reviewJumpSource').href = isNew() && blocked ? '#manualStart' : isLive() ? '#reviewSource' : '#reviewRecording';
}
function currentOperationalCoverage(report) {
  const value = !dirty && report ? snapshot.operationalCoverage : null;
  if (!value || value.kind !== 'finite-rule-applicability' || value.version !== 1 || value.familyId !== snapshot.family.id
    || value.surveySha256 !== report.surveySha256 || value.rulesSha256 !== report.rulesSha256 || value.totalStates !== report.statesChecked
    || !Array.isArray(value.rules) || !value.rules.length || !Array.isArray(value.uncheckedSlots)
    || value.domainScope?.kind !== 'declared-finite-domains' || !Array.isArray(value.domainScope.integerDrivers)) return null;
  const integers = ['totalStates','conditionTrueStates','comparedStates','skippedHiddenStates','conditionTrueComparedStates','mismatchStates'];
  if (value.rules.some(row => integers.some(key => !Number.isSafeInteger(row[key]) || row[key] < 0)
    || row.totalStates !== value.totalStates || row.conditionTrueStates > row.totalStates
    || row.comparedStates + row.skippedHiddenStates !== row.totalStates || row.conditionTrueComparedStates > row.comparedStates
    || row.conditionTrueComparedStates > row.conditionTrueStates || row.comparedStates - row.conditionTrueComparedStates > row.totalStates - row.conditionTrueStates
    || row.mismatchStates > row.comparedStates)) return null;
  return value;
}
function renderOperationalCoverage(report, coverage) {
  const area = $('operationalCoverage'); area.replaceChildren(); $('operationalCoveragePanel').hidden = !report;
  if (!report) return;
  if (!coverage) { area.append(element('p', 'Operational comparison counts are unavailable for this result.', 'subtle')); return; }
  area.append(element('p', 'Predicate truth covers every complete declared driver assignment. Comparisons use actual form behavior: visibility is always compared; requiredness is compared only while the target is shown. A predicate can intentionally be always false.', 'subtle'));
  const neverCompared = coverage.rules.filter(row => row.comparedStates === 0);
  if (neverCompared.length) area.append(element('p', `Not compared: ${neverCompared.map(row => `${row.field}/${row.property}`).join(', ')}. Each target stayed hidden in every declared assignment, so these requiredness rules received no comparisons. This is not evidence that those rules are correct or incorrect.`, 'coverage-caution'));
  const wrap = element('div', '', 'behavior-table-wrap'), table = element('table', '', 'behavior-table applicability-table');
  wrap.tabIndex = 0; wrap.role = 'region'; wrap.ariaLabel = 'Rule comparison counts; scroll horizontally if needed';
  table.append(element('caption', 'Operational coverage of each approved rule over complete declared driver assignments'));
  const header = element('tr');
  for (const label of ['Rule', 'Predicate true / all', 'Compared / all', 'Skipped: hidden', 'Mismatches']) { const cell = element('th', label); cell.scope = 'col'; header.append(cell); }
  const head = element('thead'); head.append(header); table.append(head); const body = element('tbody');
  for (const row of coverage.rules) {
    const tr = element('tr'), name = element('th', `${row.field}: ${row.property === 'visible' ? 'when shown' : 'when required'}`); name.scope = 'row';
    const truth = element('td', `${row.conditionTrueStates} / ${row.totalStates}`);
    truth.append(element('div', row.conditionTrueStates === 0 ? 'Always false within these inputs' : row.conditionTrueStates === row.totalStates ? 'Always true within these inputs' : 'Varies within these inputs', 'coverage-detail'));
    const compared = element('td', `${row.comparedStates} / ${row.totalStates}`);
    compared.append(element('div', row.comparedStates ? `${row.conditionTrueComparedStates} expected true in these comparisons` : 'No comparisons', 'coverage-detail'));
    tr.append(name, truth, compared, element('td', String(row.skippedHiddenStates)), element('td', String(row.mismatchStates))); body.append(tr);
  }
  table.append(body); wrap.append(table); area.append(element('p', 'Scroll sideways for all counts. The rule column stays visible.', 'behavior-scroll-hint'), wrap);
  area.append(element('p', `${coverage.uncheckedSlots.length} target/property slots have no approved predicate and remain unknown. Their reviewed reasons are in “Missing and unchecked rules” above. These counts do not establish policy truth or whole-form correctness.`, 'subtle'));
  if (coverage.domainScope.integerDrivers.length) area.append(element('p', `Declared integer-driver scope: ${coverage.domainScope.integerDrivers.join(', ')}. Only the declared integers are counted; fractional answers are outside this diagnostic.`, 'subtle'));
}
function renderFindings() {
  const computation = displayedComputation();
  const analysisUnavailable = computation?.operation === 'analysis' && computation.status !== 'complete';
  const report = dirty || stateUnconfirmed || analysisUnavailable ? null : snapshot.report;
  const notRun = !report && !dirty && !stateUnconfirmed && !computation;
  const emptyCount = notRun ? 'Not run' : computation?.operation === 'recheck' && !dirty && !stateUnconfirmed ? 'No result' : '—';
  $('reviewAnalysisStatus').textContent = report ? 'Original-form analysis is complete. These counts apply only to the original form.'
    : notRun ? 'Original-form analysis has not run.' : 'No current completed original-form analysis result is available.';
  $('reviewStateCount').textContent = report?.statesChecked ?? emptyCount;
  $('reviewNativeCount').textContent = report ? report.native.errorCount + report.native.warningCount : emptyCount;
  $('reviewFindingCount').textContent = report ? report.findings.length : emptyCount;
  const blocked = originalBlock(), operational = currentOperationalCoverage(report), noneCompared = !!operational && operational.rules.every(row => row.comparedStates === 0);
  $('reviewFindingHeading').textContent = analysisUnavailable ? computation.status === 'incomplete' ? 'Analysis incomplete' : computation.status === 'uncertain' ? 'Analysis result unconfirmed' : 'Analysis pending' : blocked ? 'Analysis blocked for this original response' : !report ? approved() ? notRun ? 'Original-form analysis has not run' : 'No completed original-form analysis result' : 'Analysis requires explicit approval'
    : noneCompared ? 'No rule comparisons were applicable' : report.findings.length ? 'Form behavior disagrees with reviewed rules' : 'No discrepancy against the reviewed rules';
  const scope = !dirty ? snapshot.reviewCoverage : null;
  $('reviewScopeStatus').textContent = blocked || (scope ? `${scope.unchecked.length ? 'Partial check' : 'Bounded predicate check'}: ${scope.present} rules present; ${scope.unchecked.length} checks unchecked${scope.unchecked.length ? ': ' + scope.unchecked.join(', ') : ''}. This is not complete policy verification.` : 'No approved form result is available for this draft.');
  $('reviewFindings').replaceChildren();
  if (report && !report.findings.length) {
    const result = element('div', '', noneCompared ? 'coverage-caution' : 'clean');
    result.append(element('strong', noneCompared ? 'No rule comparisons were applicable' : 'No discrepancy against the reviewed rules'), element('p', noneCompared
      ? 'All present rules concern requiredness of targets that stayed hidden. No conclusion about those rules follows from zero discrepancies. Missing slots remain unknown.'
      : operational ? 'All comparisons made matched the reviewed predicates. Requiredness is compared only when the form actually shows the target. Missing slots remain unknown.'
      : 'No discrepancy was reported. Operational comparison counts are unavailable; this is not a guarantee about the policy or unsupported form behavior.'));
    $('reviewFindings').append(result);
  }
  renderOperationalCoverage(report, operational);
  report?.findings.forEach((finding, index) => {
    const card = element('div', '', `finding${selected === index ? ' selected' : ''}`);
    const button = element('button', `${finding.field.replaceAll('_', ' ')} · ${finding.property}`);
    button.type = 'button'; button.id = `reviewFinding-${index}`; button.disabled = computationBusy();
    button.addEventListener('click', () => {
      if (button.disabled) return;
      selected = index; generation++; replayMessage = null; clearError(); render();
    });
    const states = element('div', '', 'states');
    states.append(element('span', `Reviewed rule: ${propertyState(finding.property, finding.expected)}`), element('span', `Form: ${propertyState(finding.property, finding.observed)}`, 'observed'));
    card.append(button, element('blockquote', finding.source.quote), states);
    $('reviewFindings').append(card);
  });
}
function renderReplay() {
  const finding = currentFinding();
  const blocked = originalBlock();
  $('reviewReplayExplanation').textContent = blocked || (finding ? 'The minimal condition guarantees this original-form discrepancy against the reviewed rules for every remaining in-domain answer. The complete path is replayed in SurveyJS.' : snapshot.report && !dirty ? 'No discrepancy was found in the original form against these reviewed rules, so no original-form replay case is available.' : 'An original-form replay is available after original-form analysis finds a discrepancy against the reviewed rules.');
  $('reviewReplayArea').replaceChildren(); $('reviewReplayResult').replaceChildren();
  if (finding) {
    const entries = Object.entries(finding.minimalAnswers);
    for (const [key, value] of entries) $('reviewReplayArea').append(element('span', `${key} = ${fmt(value)}`, 'condition'));
    if (!entries.length) $('reviewReplayArea').append(element('span', 'All driver answers', 'condition'));
    $('reviewReplayArea').append(element('p', `Minimum ${entries.length} constrained answer${entries.length === 1 ? '' : 's'} · holds across ${finding.guaranteedCompletions} complete states`, 'subtle'));
    const path = element('ol', '', 'path');
    for (const step of finding.steps) path.append(element('li', `${step.field}: ${fmt(step.value)}`));
    $('reviewReplayArea').append(path);
  } else {
    $('reviewReplayArea').append(element('p', blocked || (snapshot.report && !dirty
      ? 'No original-form discrepancy is available to replay for this reviewed rule set.'
      : 'Approve and analyze the original form to select an original-form discrepancy.'), 'subtle'));
  }
  if (replayMessage) $('reviewReplayResult').append(element('div', replayMessage.text, replayMessage.kind));
}
function renderControls() {
  refreshWireDiagnostic();
  const isPending = !!pending || computationBusy() || !!manualOperation || (isLive() && !!liveOperation?.busy), canReview = valid() && editable() && !stateUnconfirmed;
  $('reviewRetry').disabled = isPending;
  $('draftEditor').disabled = !editable() || !!composition || historicalEvidence();
  $('editorDetails').hidden = historicalEvidence();
  const addRuleOption = $('resolutionClassification').querySelector?.('option[value=rule]');
  if (addRuleOption) {addRuleOption.disabled = historicalEvidence(); addRuleOption.hidden = historicalEvidence();}
  $('editorNote').textContent = !editable()
    ? liveEvidence() ? 'The original extraction is invalid or abstained. Editing, corrections and fallback rules are blocked for this response.' : 'The original recording is invalid or abstained. Editing, corrections and fallback rules are blocked for this recording.'
    : dirty ? 'Unapplied edit: approval and results are cleared immediately.' : manualSession() ? 'Independent draft. The linked failed extraction, if any, stays unchanged and is not made valid by authorship.' : 'The original raw response above is retained unchanged.';
  $('applyDraft').disabled = isPending || stateUnconfirmed || !editable() || !dirty || !!composition && !resolutionReady();
  $('discardDraft').disabled = stateUnconfirmed || !editable() || !dirty;
  $('reviewInterpretation').disabled = isPending || !canReview;
  $('reviewCompleteness').disabled = isPending || !canReview || !!snapshot.reviewCoverage?.unresolved.length;
  $('approveReview').disabled = isPending || !canReview || approved() || !!snapshot.reviewCoverage?.unresolved.length
    || !$('reviewInterpretation').checked || !$('reviewCompleteness').checked;
  $('analyzeReview').disabled = isPending || !approved();
  $('reviewReplay').disabled = isPending || !approved() || !currentFinding();
  $('reviewExport').disabled = isPending || !approved() || !currentFinding() || historicalEvidence();
  $('reviewExport').hidden = historicalEvidence();
  $('specificationExportPanel').hidden = !snapshot.suppliedInput;
  $('specificationExport').disabled = isPending || !approved() || !snapshot.suppliedInput;
  for (const [id, action, label] of [['applyDraft', 'draft', 'Apply and validate draft'], ['approveReview', 'approve', 'Approve reviewed rules'], ['analyzeReview', 'analyze', 'Analyze approved rules'], ['reviewReplay', 'replay', 'Replay in SurveyJS'], ['reviewExport', 'export', 'Download reviewed replay case'], ['specificationExport', 'export-specification', 'Download approved specification']]) {
    $(id).textContent = pending?.action === action ? `${label}…` : label;
  }
  if (composition) $('applyDraft').textContent = pending?.action === 'draft' ? 'Validating resolution…' : 'Apply missing-rule resolution';
  const unchecked = snapshot.reviewCoverage?.unchecked.length ?? 0, unresolved = snapshot.reviewCoverage?.unresolved.length ?? 0;
  const excluded = (snapshot.reviewCoverage?.unchecked ?? []).map(value => {
    const [name, property] = value.split('/');
    const label = snapshot.family.fields.find(field => field.name === name)?.label || name;
    return `${label} (${name}): ${property === 'visible' ? 'when shown' : 'when an answer is required'}`;
  }).join('; ');
  $('coverageAttestationText').textContent = unresolved ? `Decide how to handle ${unresolved} missing rule(s) before confirming the review scope.`
    : unchecked ? `I reviewed the present rules and ${unchecked} checks that will remain unchecked: ${excluded}. Only the present rules will be checked.`
    : 'I reviewed every rule about when fields are shown and answers are required. This does not establish policy correctness.';
  if (unchecked) $('approveReview').textContent = pending?.action === 'approve' ? 'Approving partial check…' : `Approve partial check (${unchecked} check${unchecked === 1 ? '' : 's'} unchecked)`;
  if (approved()) $('analyzeReview').textContent = unchecked ? `Analyze approved rules (${unchecked} check${unchecked === 1 ? '' : 's'} unchecked)` : 'Analyze approved rules';
  renderActor();
  $('reviewState').textContent = stage(); $('reviewState').dataset.state = stage();
  $('reviewRevision').textContent = `${snapshot.revision}${stateUnconfirmed ? ' (last confirmed)' : ''}`;
  $('reviewStateDetail').textContent = computationBusy() ? 'The local computation has no confirmed final result. Recover its state or cancel this exact operation below.' : stateUnconfirmed ? manualSession() ? 'Independent state is unconfirmed. Recover this manual session; no extraction will be repeated.' : isLive() ? 'Server state is unconfirmed. Recover the current live request explicitly; approval and results have been cleared.' : 'Server state is unconfirmed. Restart review with the current draft; approval and results have been cleared.' : stateDetails[stage()] ?? 'Review this recorded response.';
  $('rulesHash').textContent = valid() ? snapshot.rulesSha256 : 'Not available for this draft';
  $('approvalHash').textContent = approved() ? snapshot.approval.approvalHash : 'Not approved';
  for (const [id, action] of [['reviewExportStatus','export'],['specificationExportStatus','export-specification'],['recheckExportStatus','export-recheck']]) {
    const message = exportMessage && (exportMessage.action ?? 'export') === action ? exportMessage : null;
    $(id).textContent = message?.text ?? ''; $(id).className = message?.kind ?? 'subtle'; $(id).hidden = !message;
  }
  window.formRehearsalRecheck?.update({snapshot, approved: approved(), busy: isPending, dirty, unconfirmed: stateUnconfirmed, practiceRevision: authoredPracticeRevision});
  window.formRehearsalPolicyImpact?.update({snapshot, approved: approved(), busy: isPending, dirty, unconfirmed: stateUnconfirmed, retainedPrior: retainedPracticePrior()});
  renderPractice();
  renderError(); renderComputation();
  if (isLive()) renderLive();
}
function render() {
  if (!snapshot) return;
  setSourcePresentation();
  const focused = document.activeElement, focusedId = focused?.id;
  $('reviewTitle').textContent = snapshot.family.title;
  $('reviewSessionId').textContent = 'Review session: '+snapshot.sessionId;
  $('reviewPolicy').textContent = snapshot.family.policy;
  $('reviewFields').textContent = json(snapshot.family.fields);
  $('reviewSurvey').textContent = json(snapshot.survey);
  $('rawResponse').textContent = manualSession() ? snapshot.priorExtraction?.recording.rawFinalText ?? 'No extraction is linked. This draft started empty.' : snapshot.recording.rawFinalText;
  $('reviewRawSummary').textContent = historicalEvidence() ? 'Exact historical assistant content · unchanged; current normalization below' : syntheticEvidence() ? 'Original raw v3 proposal · unchanged' : 'Original raw v3 response · unchanged';
  $('reviewEvidenceLabel').textContent = historicalEvidence() ? 'Saved r5' : liveEvidence() ? provenanceKind() === 'local-mock-transport' ? 'Local mock' : 'Live response' : provenanceKind() === 'synthetic-omission-demonstration' ? 'Synthetic demo' : 'Recorded';
  $('reviewEvidenceDetail').textContent = historicalEvidence() ? 'Apertus capture · current local review' : liveEvidence() ? provenanceKind() === 'local-mock-transport' ? 'Test plumbing · no provider evidence' : 'Explicit extraction · review required' : provenanceKind() === 'synthetic-omission-demonstration' ? 'Authored omission fixture · no model or participant result' : 'Apertus response · no live call';
  $('reviewOriginalHeading').textContent = liveEvidence() ? '02 / ORIGINAL EXTRACTION' : provenanceKind() === 'synthetic-omission-demonstration' ? '02 / ORIGINAL SYNTHETIC PROPOSAL' : '02 / ORIGINAL RECORDING';
  $('reviewEditorSummary').textContent = 'Advanced: edit the full proposed rule JSON';
  $('originalValidation').textContent = `Original ${syntheticEvidence() ? 'synthetic proposal' : liveEvidence() ? 'extraction' : 'recording'} validation: ${snapshot.originalParsed?.status}${snapshot.originalParsed?.error ? ` (${snapshot.originalParsed.error})` : ''}.`;
  if (manualSession()) {
    $('reviewRawSummary').textContent = snapshot.priorExtraction ? 'Linked original raw response · unchanged' : 'No model seed';
    $('reviewEvidenceLabel').textContent = 'Independent authored';$('reviewEvidenceDetail').textContent = 'Local rules · not model extraction success';
    $('reviewOriginalHeading').textContent = '02 / INDEPENDENT AUTHORSHIP';
    $('originalValidation').textContent = snapshot.priorExtraction ? `Linked extraction remains ${snapshot.priorExtraction.originalParsed.status}${snapshot.priorExtraction.originalParsed.error ? ` (${snapshot.priorExtraction.originalParsed.error})` : ''}. It cannot be approved as a model response.` : 'No extraction linked. Manual authorship makes no claim about other requests.';
    $('reviewEditorSummary').textContent = 'Advanced: edit independent authored rule JSON';
  }
  $('draftFormatNote').textContent = manualSession() ? 'Use the independent-rules-v1 draft shown below. Each rule needs a target, property, bounded condition and exact unique quote. This schema is not a model response.' : 'Use the v3 JSON shape with quote strings. Applying a draft validates syntax, supported predicates and exact unique quotes.';
  $('draftEditorLabel').textContent = manualSession() ? 'Independent authored draft JSON' : 'Proposed v3 JSON';
  renderOverview(); renderProvenance(); renderRules(); renderChanges(); renderFindings(); renderReplay(); renderResolution(); renderControls();
  // Preserve the user's current control when a same-view render replaces it.
  // Capture it here, rather than before an asynchronous request.
  const replacement = focusedId ? $(focusedId) : null;
  if (replacement && replacement !== focused && availableFocus(replacement)) focusCondition(focusedId, focusedId);
  announceReviewView(snapshot.sessionId);
}
async function start({preserveDraft = false} = {}) {
  if (isLive() || !recordings.length || !$('reviewRecording').value) return;
  moveLoadingFocus('Loading the original recorded response…');
  announceReviewView('');
  const savedDraft = preserveDraft ? (snapshot && editable() ? $('draftEditor').value : recoveryDraft) : null;
  recoveryDraft = savedDraft; clearComputationView();
  const token = ++navigation; generation++; startController?.abort(); startController = new AbortController();
  snapshot = null; pending = null; dirty = false; structuredDraft = null; composition = null; selected = 0; replayMessage = null; stateUnconfirmed = false; clearError(); clearAttestations();
  setSourcePresentation(); renderActor();
  $('reviewWorkspace').hidden = true; $('reviewRetry').hidden = true; $('reviewRetry').disabled = true;
  $('startActorReview').disabled = true;
  const kind = $('reviewActor').value || 'unattributed-local';
  const declared = kind !== 'self-reported-human' || $('reviewHumanAttestation').checked;
  const body = {recordingId: $('reviewRecording').value, variant: historicalSelection() ? 'supplied' : document.querySelector('[name=reviewVariant]:checked').value,
    ...(declared ? {actorKind: kind, humanAttestation: kind === 'self-reported-human'} : {})};
  try {
    const data = await post('start', body, startController.signal);
    if (token !== navigation) return;
    snapshot = data; $('draftEditor').value = savedDraft ?? snapshot.draftText;
    // Recovery creates a new session. Retained text is explicitly unapplied and
    // can never inherit the uncertain action's approval or analysis.
    dirty = savedDraft !== null && editable(); recoveryDraft = null; render();
    $('reviewWorkspace').hidden = false; finishLoadingFocus();
  } catch (error) {
    if (token !== navigation || error.name === 'AbortError') return;
    setLoading(error.message, true); $('reviewRetry').textContent = 'Retry loading recording'; $('reviewRetry').hidden = false; $('reviewRetry').disabled = false; finishLoadingFocus(true);
  }
}
function resolutionCommitted(actual, token, body) {
  if (!token.resolution || actual.revision !== body.expectedRevision + 1 || actual.approval !== null || actual.report !== null
    || !(['valid'].includes(actual.parsed?.status) || actual.kind === 'independent-manual' && actual.parsed?.status === 'empty') || actual.policySha256 !== body.policySha256 || json(actual.actor) !== json(token.resolutionBase.actor)) return false;
  const r = token.resolution, before = token.resolutionBase;
  const others = before.dispositions.filter(value => slotName(value) !== slotName(r));
  if (r.classification === 'rule') {
    const quote = before.policy.slice(r.selection.start, r.selection.end);
    const expected = {...before.wire, rules: [...before.wire.rules, {field: r.field, property: r.property, condition: r.condition, quote}]};
    return json(actual.parsed.rawResult) === json(expected) && json(actual.dispositions) === json(others);
  }
  const after = actual.dispositions.find(value => slotName(value) === slotName(r));
  return actual.draftText === before.draftText && !!after && after.kind === r.classification && after.reasonCode === r.reasonCode && after.reason === r.reason
    && (r.selection === null ? after.evidence === null : after.evidence?.start === r.selection.start && after.evidence?.end === r.selection.end)
    && json(actual.dispositions.filter(value => slotName(value) !== slotName(r))) === json(others);
}
// Start responses may remain open while the bounded local job runs. These
// controls read state independently; they never repeat a start or cancel-latest.
function clearComputationView() {
  if (computationAttempt) computationAttempt.retired = true;
  computationAttempt = null; computationControl = null; computationRecovery = false; computationMessage = '';
  $('reviewComputationPanel').hidden = true;
}
function displayedComputation() {
  return computationAttempt ? {...computationAttempt, status: computationAttempt.uncertain ? 'uncertain' : 'pending'} : snapshot?.computation;
}
function computationBusy() {
  return !!computationAttempt || computationRecovery || snapshot?.computation?.status === 'pending';
}
function computationRecord(value) {
  return value?.kind === 'bounded-review-computation' && value.version === 1 && typeof value.jobId === 'string'
    && ['analysis', 'replay', 'recheck'].includes(value.operation) && ['pending', 'complete', 'incomplete', 'invalid'].includes(value.status)
    && Number.isSafeInteger(value.startingRevision) && typeof value.approvalHash === 'string';
}
const computationReasons = {
  cancelled: 'It was cancelled.', timeout: 'It reached the local time limit.',
  'worker-failed': 'The local worker stopped before finishing.', 'invalid-result': 'The local worker result was rejected.',
  stale: 'Its approved inputs changed before completion.', shutdown: 'The local server stopped the computation.',
};
function renderComputation() {
  const c = displayedComputation(), label = c?.operation === 'replay' ? 'Replay' : c?.operation === 'recheck' ? 'Recheck' : 'Analysis';
  const active = computationBusy(), incomplete = c?.status === 'incomplete', invalid = c?.status === 'invalid';
  $('reviewComputationPanel').hidden = !c && !computationRecovery && !computationMessage
    || !active && c?.operation === 'replay' && c.findingIndex !== selected;
  const message = computationMessage || (invalid ? 'Invalid revised form. No result was produced. See Revised-form status and results.' : dirty && !active ? 'Current edits have no approved computation result.' : incomplete
    ? `${label} incomplete. ${computationReasons[c.reason] || 'The local computation did not finish.'} ${c.operation === 'replay' ? 'The earlier completed analysis is still shown; this replay has no new result.' : c.operation === 'recheck' ? 'No revised-form result is available; this is not a clean check.' : 'No analysis result is available; this is not a clean check.'} Choose ${c.operation === 'replay' ? 'Replay' : c.operation === 'recheck' ? 'Recheck revised form' : 'Analyze'} explicitly to try again.`
    : active ? `${label} ${c?.status === 'uncertain' ? 'result is unconfirmed' : 'pending'}. Recover checks the same operation without restarting it. Leaving this view may leave the bounded server computation running.`
    : c?.operation === 'recheck' ? `${window.formRehearsalRecheck?.downloadable() && !dirty && !stateUnconfirmed
      ? 'Recheck complete for the current revised form. Original approval does not attest the replacement form.'
      : 'An earlier revised-form recheck completed. No current revised-form result is available; recheck the current bytes.'} ${$('reviewAnalysisStatus').textContent}`
    : `${label} complete for the original form.`);
  $('reviewComputationStatus').textContent = message;
  $('reviewComputationStatus').className = incomplete || invalid || computationRecovery ? 'error' : 'subtle';
  $('computationRecover').hidden = !active;
  $('computationCancel').hidden = !active;
  $('computationRecover').disabled = !!computationControl;
  $('computationCancel').disabled = !!computationControl || computationRecovery && !computationAttempt;
  $('computationRecover').textContent = computationControl?.action === 'recover' ? 'Recovering computation…' : 'Recover computation';
  $('computationCancel').textContent = computationControl?.action === 'cancel' ? 'Cancelling this computation…' : 'Cancel this computation';
}
function sameComputationView(token) {
  return !token.retired && token.navigation === navigation && token.sessionId === snapshot?.sessionId;
}
function startNotConfirmed(actual, token) {
  return actual?.sessionId === token.sessionId && actual.revision === token.startingRevision
    && (!actual.computation || actual.computation.startingRevision < token.startingRevision);
}
function matchesComputation(c, token) {
  return computationRecord(c) && c.operation === token.operation && c.startingRevision === token.startingRevision
    && c.approvalHash === token.approvalHash && (!token.jobId || c.jobId === token.jobId)
    && (c.operation !== 'replay' || c.findingIndex === token.findingIndex)
    && (c.operation !== 'recheck' || c.replacementFormText === token.formText
      && (!c.recheckResult || c.recheckResult.formText === token.formText));
}
function retireComputation(token) {
  token.retired = true;
  if (computationAttempt === token) computationAttempt = null;
  if (pending === token) pending = null;
}
function computationChanged(token) {
  retireComputation(token); computationRecovery = true;
  snapshot.computation = null; snapshot.approval = null; snapshot.report = null; snapshot.operationalCoverage = null;
  stateUnconfirmed = true; clearAttestations(); replayMessage = null;
  computationMessage = 'This response belongs to a different operation. Nothing was cancelled. Choose Recover computation to inspect the current operation before cancelling it.';
}
function acceptComputation(actual, token, replay, recovered = false, rejected = false) {
  if (!sameComputationView(token)) return false;
  if (actual?.sessionId !== token.sessionId || !Number.isSafeInteger(actual.revision)) throw new Error('Unexpected computation session');
  if (!rejected && actual.computation && !matchesComputation(actual.computation, token)) {computationChanged(token);return false;}
  if (actual.revision < snapshot.revision) return false;
  const c = rejected ? null : actual.computation;
  snapshot.revision = actual.revision; stateUnconfirmed = false;
  const current = token.generation === generation && !dirty;
  if (current) { snapshot = actual; $('draftEditor').value = actual.draftText; }
  else snapshot.computation = c ?? null;
  computationRecovery = false; computationMessage = rejected
    ? `${token.operation === 'replay' ? 'Replay' : token.operation === 'recheck' ? 'Recheck' : 'Analysis'} did not start. Server state is unchanged; try again explicitly when local capacity is available.` : '';
  if (c?.status === 'pending') {
    token.jobId = c.jobId; token.uncertain = false; computationAttempt = token;
  } else {
    retireComputation(token);
    if (current && token.operation === 'analysis' && !rejected) {selected = 0; replayMessage = null;}
    if (current && token.operation === 'replay' && selected === token.findingIndex) {
      const result = c?.replayResult ?? replay, finding = currentFinding(), states = result?.states?.[finding?.field];
      replayMessage = rejected ? {kind: 'error', text: computationMessage} : c?.status === 'incomplete' ? {kind: 'error', text: `Replay incomplete. ${computationReasons[c.reason] || 'The local computation did not finish.'} The earlier completed analysis remains available.`}
        : result?.reproduced && states ? {kind: 'success', text: `Reproduced against the reviewed rules. ${finding.field}: ${propertyState('visible', states.visible).toLowerCase()}, ${propertyState('required', states.required).toLowerCase()}. The witness is bound to the displayed approval and input hashes.`}
        : {kind: 'error', text: recovered ? 'Replay response recovered without a reproducible result. Choose Replay explicitly to try again.' : 'This discrepancy did not reproduce against the reviewed rules.'};
    }
  }
  return true;
}
function unconfirmedComputation(token, message) {
  if (!sameComputationView(token)) return;
  token.uncertain = true; computationAttempt = token; computationRecovery = true;
  stateUnconfirmed = true; snapshot.approval = null;
  if (token.operation === 'analysis') {snapshot.report = null;snapshot.operationalCoverage = null;}
  clearAttestations();
  computationMessage = `${token.operation === 'replay' ? 'Replay' : token.operation === 'analysis' ? 'Analysis' : token.operation === 'recheck' ? 'Recheck' : 'Computation'} result is unconfirmed. ${message} Recover computation checks the same operation; no action was retried.`;
}
async function performComputation(action) {
  const token = {action, operation: action === 'analyze' ? 'analysis' : action === 'recheck' ? 'recheck' : 'replay', navigation, generation,
    sessionId: snapshot.sessionId, startingRevision: snapshot.revision, approvalHash: snapshot.approval.approvalHash,
    ...(action === 'replay' ? {findingIndex: selected} : action === 'recheck' ? window.formRehearsalRecheck.capture() : {})};
  if (action === 'recheck') window.formRehearsalRecheck.begin(token);
  const body = {sessionId: token.sessionId, expectedRevision: token.startingRevision, approvalHash: token.approvalHash,
    ...(action === 'replay' ? {finding: selected} : action === 'recheck' ? {formText: token.formText} : {})};
  pending = token; computationAttempt = token; computationRecovery = false; computationMessage = ''; clearError(); replayMessage = null;
  if (action === 'analyze') {snapshot.report = null;snapshot.operationalCoverage = null;}
  else if (action === 'replay') replayMessage = {kind: 'subtle', text: 'Replaying a fresh form instance against the reviewed rules…'};
  const focusRegion = $(action === 'replay' ? 'reviewReplayResult' : action === 'recheck' ? 'recheckStatus' : 'reviewComputationStatus');
  const button = $(action === 'analyze' ? 'analyzeReview' : action === 'recheck' ? 'recheckRun' : 'reviewReplay');
  const focus = document.activeElement === button;
  render();
  if (focus) {focusRegion.focus();token.focusRevision = focusRevision;}
  try {
    const data = await post(action, body);
    acceptComputation(action === 'replay' ? data.snapshot : data, token, data.replay);
  } catch (error) {
    if (!sameComputationView(token)) return;
    let recovered = false;
    try {
      const actual = await post('state', {sessionId: token.sessionId});
      // A lost response can precede admission. Old state is not evidence that
      // this start has settled, even if it contains an earlier completed job.
      const unchanged = startNotConfirmed(actual, token);
      if (!error.responseUncertain || !unchanged) recovered = acceptComputation(actual, token, null, true,
        !error.responseUncertain && unchanged && actual.approval?.approvalHash === token.approvalHash);
    } catch { /* A deliberate recovery remains available; never repeat start. */ }
    if (token.navigation !== navigation || token.sessionId !== snapshot?.sessionId) return;
    if (!recovered && !token.retired) unconfirmedComputation(token, error.message);
    if (recovered && token.generation === generation) currentError = `${error.message} Server state recovered at revision ${snapshot.revision}; no action was retried.`;
  } finally {
    if (pending === token) pending = null;
    if (token.navigation === navigation && token.sessionId === snapshot?.sessionId) {
      render();
      if (focus && document.activeElement === focusRegion && focusRevision === token.focusRevision && !button.disabled) button.focus();
    }
  }
}
async function recoverComputation(cancel) {
  if (!snapshot || computationControl || (cancel ? $('computationCancel') : $('computationRecover')).disabled) return;
  reviewActivity++;
  const c = snapshot.computation;
  // After a correlation failure a later explicit Recover may inspect the
  // current operation. Cancel is never permitted from that unbound view.
  let token = computationAttempt ?? {navigation, generation, sessionId: snapshot.sessionId,
    ...(computationRecord(c) ? {operation: c.operation, startingRevision: c.startingRevision, approvalHash: c.approvalHash,
      jobId: c.jobId, findingIndex: c.findingIndex, formText: c.replacementFormText} : {unbound: true})};
  const focus = document.activeElement === $(cancel ? 'computationCancel' : 'computationRecover');
  const control = {action: cancel ? 'cancel' : 'recover', token}; computationControl = control; renderComputation();
  if (focus) $('reviewComputationStatus').focus();
  try {
    const actual = await post('state', {sessionId: token.sessionId});
    if (computationControl !== control || !sameComputationView(token)) return;
    if (token.unbound) {
      if (actual.sessionId !== token.sessionId || !computationRecord(actual.computation)) throw new Error('No recoverable computation is recorded for this session.');
      const current = actual.computation;
      Object.assign(token, {operation: current.operation, startingRevision: current.startingRevision, approvalHash: current.approvalHash,
        jobId: current.jobId, findingIndex: current.findingIndex, formText: current.replacementFormText, unbound: false});
    }
    if (startNotConfirmed(actual, token)) {
      computationMessage = 'The server has not confirmed this start. Recover again to check its state; nothing was cancelled.';
      return;
    }
    if (!acceptComputation(actual, token, null, true)) return;
    currentError = '';
    if (cancel && actual.computation?.status === 'pending' && sameComputationView(token)) {
      const stopped = await post('cancel-computation', {sessionId: token.sessionId, expectedRevision: actual.revision, jobId: actual.computation.jobId});
      acceptComputation(stopped, token, null, true);
    }
  } catch (error) {
    if (!sameComputationView(token) || computationControl !== control) return;
    // Completion can win a cancellation race or its response can be lost.
    // One state read recovers the exact job; it never repeats the cancellation.
    let recovered = false;
    if (cancel) {
      try { recovered = acceptComputation(await post('state', {sessionId: token.sessionId}), token, null, true); }
      catch { /* Preserve uncertainty below. */ }
    }
    if (!recovered && !token.retired) unconfirmedComputation(token, 'Its state could not be confirmed.');
    if (recovered && !token.retired) computationMessage = 'Cancellation is unconfirmed. The same operation is still pending; recover its state or explicitly cancel it again.';
  } finally {
    if (computationControl === control) {computationControl = null;render();}
  }
}

async function perform(action) {
  if (!snapshot || pending) return;
  const buttonId = {draft: 'applyDraft', approve: 'approveReview', analyze: 'analyzeReview', replay: 'reviewReplay', export: 'reviewExport', 'export-specification': 'specificationExport', recheck: 'recheckRun', 'export-recheck': 'recheckDownload'}[action];
  if (!buttonId || $(buttonId).disabled) return;
  reviewActivity++;
  if (action === 'analyze' || action === 'replay' || action === 'recheck') return performComputation(action);
  const isDownload = ['export','export-specification','export-recheck'].includes(action);
  const downloadLabel = action === 'export-specification' ? 'approved specification' : action === 'export-recheck' ? 'revised-form result' : 'reviewed replay case';
  const focusRegion = document.activeElement === $(buttonId)
    ? isDownload ? $(action === 'export-specification' ? 'specificationExportStatus' : action === 'export-recheck' ? 'recheckExportStatus' : 'reviewExportStatus') : action === 'draft' && composition ? $('resolutionStatus') : null : null;
  const token = {action, navigation, generation, sessionId: snapshot.sessionId, resolution: action === 'draft' && composition ? resolutionBody() : null};
  if (action === 'export-recheck') token.recheckInput = window.formRehearsalRecheck.capture();
  if (token.resolution) token.resolutionBase = JSON.parse(json({actor:snapshot.actor,policy:snapshot.family.policy,wire:snapshot.parsed.rawResult,dispositions:snapshot.dispositions,draftText:snapshot.draftText}));
  pending = token; clearError();
  const body = {sessionId: snapshot.sessionId, expectedRevision: snapshot.revision};
  if (action === 'draft') {
    if (token.resolution) Object.assign(body, {resolution: token.resolution, policySha256: snapshot.policySha256});
    else body.draftText = $('draftEditor').value;
  }
  else if (action === 'approve') Object.assign(body, {rulesSha256: snapshot.rulesSha256, reviewedInterpretation: $('reviewInterpretation').checked, reviewedCoverage: $('reviewCompleteness').checked});
  else {
    body.approvalHash = snapshot.approval.approvalHash;
    if (action === 'export') body.finding = selected;
    if (action === 'export-recheck') Object.assign(body, {jobId: snapshot.computation.jobId, resultSha256: snapshot.computation.recheckResult.resultSha256, formText: token.recheckInput.formText});
  }
  if (isDownload) exportMessage = {action,kind: 'subtle', text: `Preparing the ${downloadLabel} for download…`};
  renderReplay(); if (composition) renderResolution(); renderControls();
  // A disabled pending button cannot reliably retain focus. Keep it on the
  // stable status region, then return only if the user has not moved elsewhere.
  if (focusRegion) { focusRegion.focus(); token.focusRevision = focusRevision; }
  try {
    const response = await post(action, body, undefined, action === 'export-specification');
    const data = action === 'export-specification' ? response.data : response;
    if (token.navigation !== navigation || token.sessionId !== snapshot?.sessionId) return;
    const next = isDownload ? null : data;
    // A completed mutation may advance the server even when typing/selection
    // invalidated its display. Absorb only its revision so the latest draft can
    // be applied safely; never let stale approval, report or replay become visible.
    if (next && Number.isInteger(next.revision)) snapshot.revision = Math.max(snapshot.revision, next.revision);
    if (token.generation !== generation || token.recheckInput && !window.formRehearsalRecheck.matches(token.recheckInput)) return;
    if (isDownload) {
      if (action === 'export-specification') retainPracticeExport(data, response.exactText);
      const url = URL.createObjectURL(new Blob([action === 'export-specification' ? response.exactText : json(data)], {type: 'application/json'}));
      const link = element('a'); link.href = url; link.download = action === 'export-specification' ? `${snapshot.family.id}-approved-specification.json` : action === 'export-recheck' ? `${snapshot.family.id}-recheck-result.json` : `${snapshot.family.id}-${snapshot.variant}-review-witness.json`;
      document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      exportMessage = {action,kind: 'subtle', text: `Download requested. Check your browser’s downloads for the ${downloadLabel}.`};
    } else {
      snapshot = next;
      if (action === 'draft') { if (token.resolution) {$('draftEditor').value = next.draftText; $('resolutionStatus').textContent = token.resolution.classification === 'rule' ? 'Locally added rule validated. Review its predictions, quote and attribution before approving.' : 'Reason saved. This rule remains unknown and unchecked.';} composition = null; dirty = false; structuredDraft = null; selected = 0; replayMessage = null; clearAttestations(); }
      if (action === 'approve') { selected = 0; replayMessage = null; }
    }
  } catch (error) {
    if (token.navigation !== navigation || token.sessionId !== snapshot?.sessionId) return;
    // A response can be lost after a mutation commits. Read authoritative state
    // once; never repeat the mutation automatically or guess its revision.
    let reconciled = false;
    try {
      const actual = await post('state', {sessionId: token.sessionId});
      if (token.navigation !== navigation || token.sessionId !== snapshot?.sessionId) return;
      if (actual.sessionId !== token.sessionId) throw new Error('Unexpected review session');
      snapshot.revision = Math.max(snapshot.revision, actual.revision);
      if (token.generation === generation && resolutionCommitted(actual, token, body)) {
        snapshot = actual; composition = null; dirty = false; structuredDraft = null; selected = 0; replayMessage = null; clearAttestations();
        $('draftEditor').value = actual.draftText;
        $('resolutionStatus').textContent = 'The resolution was applied. Server state recovered without repeating it; review the result before fresh approval.';
      } else if (token.generation === generation && !dirty) snapshot = actual;
      reconciled = true;
    } catch { /* Explicit fresh-session recovery remains available below. */ }
    if (token.navigation !== navigation || token.sessionId !== snapshot?.sessionId) return;
    if (!reconciled) {
      stateUnconfirmed = true; snapshot.approval = null; snapshot.report = null; clearAttestations();
      if (manualSession() && token.resolution) manualResolutionRecovery = {generation: token.generation,
        token: JSON.parse(json({resolution: token.resolution, resolutionBase: token.resolutionBase})), body: JSON.parse(json(body))};
      snapshot.state = snapshot.parsed.status === 'valid' ? 'review-needed' : snapshot.state;
      replayMessage = null;
    }
    if (token.generation !== generation && reconciled) return;
    currentError = token.generation !== generation ? 'The earlier request could not be confirmed. Your latest draft is retained.' : error.message;
    if (error.responseUncertain) currentError += reconciled
      ? ` Server state recovered at revision ${snapshot.revision}; no action was retried.`
      : manualSession() ? ' Current independent state could not be confirmed. Recover the independent draft state; no extraction is repeated.' : isLive() ? ' Current state could not be confirmed. Use Recover result to check this live request; no extraction will be repeated.' : ' Current state could not be confirmed. Restart review with the current draft to recover safely.';
    if (action === 'draft' && token.resolution && composition && token.generation === generation) composition.error = currentError;
    // Keep feedback next to Download, but never attach an old export failure to
    // a newer finding, edit or navigation. The global unconfirmed-state guard
    // remains visible even when its local action message is no longer current.
    if (isDownload && token.generation === generation && (!token.recheckInput || window.formRehearsalRecheck.matches(token.recheckInput))) {
      const recovery = reconciled ? `Choose Download ${downloadLabel} to try again.`
        : manualSession() ? 'Use Recover independent draft state to confirm this same manual session before downloading.' : isLive() ? 'Use Recover result above to confirm this same live request before downloading. No extraction is repeated.'
        : 'Use Restart review with current draft above, then apply, review, approve and analyze again before downloading.';
      exportMessage = {action,kind: 'error', text: `Download failed. ${currentError} ${recovery}`};
    }
  } finally {
    if (pending === token) {
      const restoreFocus = focusRegion && document.activeElement === focusRegion && focusRevision === token.focusRevision
        && token.navigation === navigation && token.generation === generation && token.sessionId === snapshot?.sessionId;
      pending = null; render();
      if (restoreFocus) {
        const target = token.resolution && !dirty && token.resolution.classification === 'rule' ? $(ruleCardId(token.resolution)) : $(buttonId);
        if (target && !target.disabled) target.focus();
      }
    }
  }
}
$('draftEditor').addEventListener('input', () => {
  if (!snapshot || !editable()) return;
  structuredDraft = null; markDraftEdited();
});
$('discardDraft').addEventListener('click', () => {
  if (composition) {cancelResolution(); return;}
  if (!snapshot || $('discardDraft').disabled) return;
  $('draftEditor').value = snapshot.draftText;
  structuredDraft = snapshot.parsed.status === 'valid' ? JSON.parse(JSON.stringify(snapshot.parsed.rawResult)) : null;
  // Discard never revives old approval; even the restored draft needs revalidation.
  markDraftEdited();
});
for (const id of ['reviewInterpretation', 'reviewCompleteness']) $(id).addEventListener('change', () => {
  if (snapshot?.approval) { generation++; snapshot.approval = null; snapshot.report = null; snapshot.state = 'review-needed'; replayMessage = null; clearError(); render(); }
  else renderControls();
});
// This disclosure only navigates. It neither starts work nor changes review state.
for (const [id, target] of [
  ['reviewNavPolicy', 'reviewTitle'], ['reviewNavRules', 'reviewRulesHeading'],
  ['reviewNavCoverage', 'reviewCoverageHeading'], ['reviewNavApproval', 'reviewApprovalHeading'],
  ['reviewNavAnalysis', 'reviewFindingHeading'], ['reviewNavReplay', 'reviewReplayHeading'],
  ['reviewNavPolicyImpact', 'policyImpactHeading'],
  ['reviewNavRecheck', 'recheckHeading'], ['reviewNavRecheckStatus', 'recheckStatus'],
  ['reviewReplayRecheckLink', 'recheckStatus'],
]) {
  $(id).addEventListener('click', event => {
    event.preventDefault?.();
    if (!availableFocus($(id)) || !availableFocus($(target))) return;
    $('reviewNavigation').open = false;
    jumpTo(target);
  });
}
$('reviewNavigation').addEventListener('focusout', event => {
  // Tab/Shift+Tab can leave the menu without leaving a sticky overlay behind.
  if (event.relatedTarget && !$('reviewNavigation').contains(event.relatedTarget)) $('reviewNavigation').open = false;
});
$('reviewNavigation').addEventListener('keydown', event => {
  if (event.key !== 'Escape' || !$('reviewNavigation').open) return;
  event.preventDefault(); $('reviewNavigation').open = false;
  focusVisible($('reviewNavigationSummary'));
});
for (const [id, target] of [['reviewJumpRules', 'reviewRulesHeading'], ['reviewJumpCoverage', 'reviewCoverageHeading'], ['reviewJumpChanges', 'reviewChangesHeading'], ['reviewJumpApproval', 'reviewApprovalHeading'], ['reviewJumpSource', null]]) {
  $(id).addEventListener('click', event => {event.preventDefault?.(); jumpTo(target ?? (isNew() && originalBlock() ? 'manualStart' : isLive() ? 'reviewSource' : 'reviewRecording'));});
}
$('applyDraft').addEventListener('click', () => perform('draft'));
$('approveReview').addEventListener('click', () => perform('approve'));
$('analyzeReview').addEventListener('click', () => perform('analyze'));
$('reviewReplay').addEventListener('click', () => perform('replay'));
$('computationRecover').addEventListener('click', () => recoverComputation(false));
$('computationCancel').addEventListener('click', () => recoverComputation(true));
$('reviewExport').addEventListener('click', () => perform('export'));
$('specificationExport').addEventListener('click', () => perform('export-specification'));
$('recheckRun').addEventListener('click', () => perform('recheck'));
$('recheckDownload').addEventListener('click', () => perform('export-recheck'));
window.addEventListener('recheck-input-edited', () => {reviewActivity++; if (exportMessage?.action === 'export-recheck') exportMessage = null; if (snapshot) renderControls();});
$('reviewRecording').addEventListener('change', start);
$('reviewActor').addEventListener('change', () => {$('reviewHumanAttestation').checked = false; renderActor();});
$('reviewHumanAttestation').addEventListener('change', renderActor);
$('startActorReview').addEventListener('click', () => {if (!$('startActorReview').disabled) return start();});
$('resolutionClassification').addEventListener('change', () => {if (!composition || pending?.resolution) return; composition.classification = $('resolutionClassification').value; composition.evidenceInvalid = false; composition.reasonCode = ''; if (composition.classification === 'unsupported') composition.selection = null; touchComposition('resolutionClassification');});
$('resolutionReasonCode').addEventListener('change', () => {if (!composition || pending?.resolution) return; composition.reasonCode = $('resolutionReasonCode').value; touchComposition('resolutionReasonCode');});
$('resolutionReasonText').addEventListener('input', () => {if (!composition || pending?.resolution) return; composition.reason = $('resolutionReasonText').value; touchComposition(null, false);});
$('useResolutionEvidence').addEventListener('click', selectCompositionEvidence);
$('clearResolutionEvidence').addEventListener('click', () => {if (!composition || pending?.resolution) return; composition.selection = null; composition.evidenceInvalid = false; touchComposition('clearResolutionEvidence');});
$('cancelResolution').addEventListener('click', cancelResolution);
$('reviewSource').addEventListener('change', chooseSource);
$('practiceStart')?.addEventListener('click', beginPractice);
$('practiceOwnInput')?.addEventListener('click', ownInputs);
$('practiceDraftLoad')?.addEventListener('click', () => {
  if ($('practiceDraftLoad').disabled || !practiceMatches() || !manualEmpty()) return;
  $('draftEditor').value = practice.preset[practice.stage].draftText;
  structuredDraft = null; markDraftEdited();
  practiceMessage = 'Authored draft loaded into the editor only. Apply and validate it explicitly, then review its evidence and the missing access-visibility rule.';
  $('editorDetails').open = true; renderPractice(); focusVisible($('draftEditor'));
});
$('practiceAmendment')?.addEventListener('click', () => {
  if ($('practiceAmendment').disabled || !practiceMatches() || practice.stage !== 'old' || !practice.retained) return;
  fillPracticeStage('amended');
});
$('practiceReset')?.addEventListener('click', () => {
  if (!practice && !practiceLoad) return;
  resetPractice('Practice reset. Retained bytes, review, attestations and comparison were cleared.');
  clearReviewView(); invalidateInput();
  for (const id of rawInputIds) $(id).value = '';
  renderInput(); renderLive();
});
window.addEventListener('practice-prior-cleared', () => {
  if (!practice) return;
  practice.retained = null;
  practiceMessage = 'Comparison and retained old bytes cleared. Start the practice again to retain a fresh old review; cancellation cannot restore an earlier comparison.';
  renderPractice();
});
for (const id of rawInputIds) $(id).addEventListener('input', editInput);
$('validateInput').addEventListener('click', validateInput);
$('manualStart').addEventListener('click', startManual);
$('manualActor').addEventListener('change', () => {$('manualHumanAttestation').checked = false;renderManualStart();});
$('manualHumanAttestation').addEventListener('change', renderManualStart);
$('reviewLiveFamily').addEventListener('change', changeLiveSelection);
document.querySelectorAll('[name=reviewVariant]').forEach(node => node.addEventListener('change', () => isLive() ? changeLiveSelection() : start()));
$('liveExtract').addEventListener('click', extractLive);
$('liveRecover').addEventListener('click', recoverLive);
$('liveCancel').addEventListener('click', () => { dismissLive(); clearReviewView(); liveMessage = ''; renderLive(); });
$('liveAcknowledge').addEventListener('click', () => { liveDismissal = null; persistLive(null); liveMessage = ''; liveMessageError = false; renderLive(); void loadLiveConfig(); });
$('liveConfigRetry').addEventListener('click', () => { if (!$('liveConfigRetry').disabled) return loadLiveConfig(); });
$('reviewRetry').addEventListener('click', () => {
  if ($('reviewRetry').disabled) return;
  if (manualSession()) return recoverManual();
  if (isLive()) return recoverLive();
  if (recordings.length) return start({preserveDraft: !!currentError || recoveryDraft !== null});
  return bootstrap();
});
async function bootstrap() {
  moveLoadingFocus('Loading the saved recordings…');
  const token = ++navigation;
  catalogControls(false); $('reviewRetry').hidden = true; $('reviewRetry').disabled = true; $('reviewRecording').replaceChildren();
  try {
    const response = await fetch('/api/recordings');
    if (!response.ok) throw new Error('Could not load the saved recordings. Check the local server and retry.');
    const data = await response.json();
    if (!Array.isArray(data) || !data.length) throw new Error('No saved recordings are available. Check the local server and retry.');
    if (token !== navigation || isLive()) return;
    recordings = data;
    for (const recording of recordings) { const option = element('option', recording.title); option.value = recording.id; $('reviewRecording').append(option); }
    const requestedRecording = new URLSearchParams(location.search).get('recording');
    if (recordings.some(item => item.id === requestedRecording)) $('reviewRecording').value = requestedRecording;
    catalogControls(true); await start();
  } catch (error) {
    if (token !== navigation || isLive()) return;
    recordings = []; catalogControls(false); $('reviewRecording').replaceChildren();
    setLoading(error.message, true); $('reviewRetry').textContent = 'Retry loading recordings'; $('reviewRetry').hidden = false; $('reviewRetry').disabled = false; finishLoadingFocus(true);
  }
}
// A bfcache restore must not resurrect approved live results. Normal Back/Forward
// reloads already start blank; a restored document receives the same boundary.
window.addEventListener('pageshow', event => {
  if (!event.persisted) return;
  resetPractice('A restored page never restores retained practice approvals. Start practice again explicitly.');
  if (!isLive()) { if (computationBusy()) void start({preserveDraft: true}); return; }
  if (isNew()) {
    // A restored page must not resurrect reviewed results or auto-resubmit.
    // Keep only an unresolved request identity for deliberate recovery.
    const unresolved = pendingLive() ? liveOperation : null;
    clearReviewView(); invalidateInput('This restored page needs local validation again, or explicit recovery of the unresolved request.');
    for (const id of rawInputIds) $(id).value = '';
    if (unresolved) {
      unresolved.controller?.abort();
      liveOperation = {requestId: unresolved.requestId, familyId: unresolved.familyId, variant: unresolved.variant,
        inputId: unresolved.inputId, navigation, status: 'uncertain', busy: false};
      liveMessage = 'An earlier request has an unconfirmed result. Recover it explicitly or discard it; navigation never sends it again.';
    } else { liveOperation = null; liveMessage = ''; }
    liveMessageError = false; renderLive(); void loadLiveConfig(); return;
  }
  dismissLive(); clearReviewView(); liveMessage = ''; liveMessageError = false;
  renderLive(); void loadLiveConfig();
});
// Releasing admission does not discard a captured review or provider operation.
window.addEventListener('lifecycle-release',event=>{
  const released=event.detail;
  if (practice?.retained && (released.sessionId === practice.retained.sessionId || released.inputId === practice.retained.inputId)) {
    practice.retained = null; window.formRehearsalPolicyImpact?.reset();
    practiceMessage = 'The old practice source was released. Its retained bytes and comparison were cleared. Start practice again to compare.'; renderPractice();
  }
  if (practice && (released.sessionId && released.sessionId === snapshot?.sessionId || released.inputId && released.inputId === validatedInput?.inputId))
    resetPractice('Practice cleared because its active source was released.');
  if(released.sessionId)releasedSessionIds.add(released.sessionId);
  if(released.inputId){
    inputReleaseEpoch++;inputReleaseEvents.set(released.inputId,inputReleaseEpoch);
    if(released.leaseId)releasedInputLeases.add(released.inputId+'/'+released.leaseId);
    if(validLeaseOrder(released)){
      const key=orderKey(released.inputId,released);releasedLeaseOrder.set(key,Math.max(released.leaseRevision,releasedLeaseOrder.get(key)??0));
    }else unknownOrderReleaseEvents.set(released.inputId,inputReleaseEpoch);
  }
  const releasesCurrent=released.inputId&&released.inputId===validatedInput?.inputId&&
    (released.leaseId===inputLeaseId||admissionReleased(released.inputId,inputLeaseOrder)||!inputLeaseId||!released.leaseId);
  if(released.inputId&&(released.inputId!==validatedInput?.inputId||releasesCurrent))releasedInputIds.add(released.inputId);
  if(releasesCurrent){
    invalidateInput('Input released. Validate the complete raw inputs before a new start. Already-running extraction retains its captured input and reserved review capacity.');
    renderInput();renderLive();
  }
  if(released.sessionId&&released.sessionId===snapshot?.sessionId){
    clearReviewView();
    $('reviewLoading').hidden=false;
    $('reviewLoading').textContent='Review released. Its local draft, approval and results are no longer available. Choose a fresh review to continue.';
  }
});
window.addEventListener('pagehide', () => resetPractice());

setSourcePresentation(); renderActor(); restoreLive();
if (isLive()) { $('reviewLoading').hidden = true; renderLive(); await loadLiveConfig(); }
else await bootstrap();
