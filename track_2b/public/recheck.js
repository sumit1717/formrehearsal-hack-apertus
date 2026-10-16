// Dedicated revised-form view. Form checks use the same-origin isolated
// server worker. No provider, third-party resource or automatic retry is used.
(() => {
  const $ = id => document.getElementById(id);
  if (!$('recheckPanel')) return;
  const node = (tag, text, className = '') => {
    const value = document.createElement(tag); value.textContent = text;
    if (className) value.className = className; return value;
  };
  let view = null, sessionId = null, epoch = 0, attempt = null, fileRead = 0, expiryTimer = null;
  let inputMessage = '', inputError = false, uploadedText = null, uploadedValue = null, fileReading = false;
  let formDownload = null, formExportMessage = '', formExportError = false;
  let revisionOrigin = null;
  const sourceBinding = s => JSON.stringify([s?.suppliedInput?.inputId, s?.suppliedInput?.rawInputs?.policyText,
    s?.suppliedInput?.rawInputs?.formText, s?.suppliedInput?.rawInputs?.driverText]);
  const historical = () => view?.snapshot?.recording?.provenance?.kind === 'historical-apertus-input-recording-r5-v1';
  const text = () => uploadedText !== null && uploadedValue === $('recheckFormText').value ? uploadedText : $('recheckFormText').value;
  function exampleRevision() {
    const s = view?.snapshot, candidate = view?.practiceRevision?.();
    if (!candidate || !view.approved || view.dirty || view.unconfirmed || view.busy
      || !Number.isFinite(candidate.expiresAt) || Date.now() >= candidate.expiresAt || candidate.sessionId !== s?.sessionId
      || candidate.revision !== s.revision || candidate.approvalHash !== s.approval?.approvalHash
      || sourceBinding({suppliedInput: candidate}) !== sourceBinding(s)) return null;
    return candidate;
  }
  function renderExample() {
    const example = exampleRevision();
    if ($('recheckExampleControl')) $('recheckExampleControl').hidden = !example;
    if ($('recheckExample')) $('recheckExample').disabled = !example;
    if ($('recheckRevisionOrigin')) {
      $('recheckRevisionOrigin').hidden = !revisionOrigin;
      $('recheckRevisionOrigin').textContent = !revisionOrigin ? '' : revisionOrigin.edited
        ? 'Edited from the source-authored equipment example. Editing, even then reverting, requires a fresh check. This does not attest your changes or the policy interpretation.'
        : 'Source-authored equipment example loaded into the editor. Not generated from your review. Only a fresh completed recheck can establish a checked result for these bytes.';
    }
  }
  const matches = token => !!token && token.epoch === epoch && token.formText === text();
  const current = () => {
    const s = view?.snapshot, c = s?.computation, r = c?.recheckResult;
    return !!attempt && matches(attempt) && s?.sessionId === attempt.sessionId
      && attempt.sourceBinding === sourceBinding(s)
      && c?.operation === 'recheck' && c.startingRevision === attempt.startingRevision
      && c.approvalHash === attempt.approvalHash && s.approval?.approvalHash === attempt.approvalHash
      && (!attempt.jobId || c.jobId === attempt.jobId)
      && (!r || r.formText === text()) && Date.now() < c.sourceExpiresAt;
  };
  const downloadable = () => current() && !view?.dirty && !view?.unconfirmed
    && view.snapshot.computation.status === 'complete' && !!view.snapshot.computation.recheckResult;
  // This is a raw form download, separate from the server-exported result envelope.
  // Require every supplied source/result pin, then re-hash the bytes at click time.
  function checkedResult() {
    if (!downloadable() || !view.approved || view.busy || fileReading || inputError) return null;
    const s = view.snapshot, c = s.computation, r = c.recheckResult, spec = r.specification;
    const original = spec?.reviewBasis?.suppliedInput, result = r.computation;
    const isHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
    if (!original || !result || sourceBinding({suppliedInput: original}) !== sourceBinding(s)
      || spec.reviewBasis.review?.approvalHash !== c.approvalHash
      || result.originalInputId !== original.inputId || result.attestation !== 'not-user-attested'
      || c.replacementFormText !== text() || r.formText !== text()
      || !isHash(c.replacementFormTextSha256) || c.replacementFormTextSha256 !== result.hashes?.formTextSha256
      || !isHash(c.specificationSha256) || c.specificationSha256 !== spec.specificationSha256
      || c.specificationSha256 !== result.specificationSha256 || !isHash(r.resultSha256)
      || !isHash(original.hashes?.formTextSha256)) return null;
    return {s, c, r, original};
  }
  // Span reader for already validated JSON. Values below are sliced from the
  // exact submitted source, so escape spelling, false, and absence stay distinct.
  function propertyChanges(originalText, replacementText, fields) {
    function parse(raw) {
      JSON.parse(raw); let at = 0, count = 0;
      const ws = () => {while (/\s/.test(raw[at] ?? '!')) at++;};
      const quoted = () => {const start = at++; while (at < raw.length) {
        if (raw[at] === '\\') {at += 2; continue;}
        if (raw[at++] === '"') return raw.slice(start, at);
      } throw new Error('Invalid JSON string');};
      const value = depth => {
        if (depth > 16 || ++count > 2048) throw new Error('Form exceeds the supported structural limit');
        ws(); const start = at, result = {children: new Map()};
        if (raw[at] === '{' || raw[at] === '[') {
          const object = raw[at++] === '{', end = object ? '}' : ']'; let index = 0; ws();
          while (raw[at] !== end) {
            const key = object ? JSON.parse(quoted()) : index++; ws(); if (object) at++;
            if (result.children.has(key)) throw new Error('Duplicate form property');
            result.children.set(key, value(depth + 1)); ws();
            if (raw[at] !== ',') break; at++; ws();
          }
          if (raw[at++] !== end) throw new Error('Invalid JSON structure');
        } else if (raw[at] === '"') quoted();
        else {while (at < raw.length && !/[\s,}\]]/.test(raw[at])) at++;}
        result.raw = raw.slice(start, at); return result;
      };
      const root = value(0), elements = root.children.get('elements')
        ?? root.children.get('pages')?.children.get(0)?.children.get('elements');
      if (!elements) throw new Error('Supported form questions are missing');
      return new Map([...elements.children.values()].map(question =>
        [JSON.parse(question.children.get('name').raw), question.children]));
    }
    const before = parse(originalText), after = parse(replacementText), changes = [];
    for (const field of fields.filter(field => field.role === 'target')) {
      const oldQuestion = before.get(field.name), newQuestion = after.get(field.name);
      if (!oldQuestion || !newQuestion) throw new Error('Target context changed');
      for (const property of ['visibleIf', 'requiredIf', 'visible', 'isRequired']) {
        const oldValue = oldQuestion.get(property), newValue = newQuestion.get(property);
        if (oldValue?.raw === newValue?.raw) continue;
        changes.push({field, property, before: oldValue?.raw, after: newValue?.raw});
      }
    }
    return changes;
  }
  function renderChanges(binding) {
    const section = node('section', ''), heading = node('h3', 'Review the form changes');
    heading.id = 'recheckChangesHeading'; section.append(heading,
      node('p', 'Exact target-property values from your original and checked replacement JSON. Missing means the property is absent, not false. These are supplied edits; no repair was generated or applied.', 'subtle'));
    try {
      const changes = propertyChanges(binding.original.rawInputs.formText, binding.r.formText, binding.original.family.fields);
      if (!changes.length) section.append(node('p', 'No target-property values changed. Formatting elsewhere may still differ.'));
      for (const change of changes) {
        const kind = change.before === undefined ? 'Added' : change.after === undefined ? 'Removed' : 'Changed';
        const detail = node('div', '', 'recheck-property-change');
        detail.append(node('h4', `${change.field.label || change.field.name} / ${change.property}: ${kind}`),
          node('p', `Target: ${change.field.name}`), node('p', 'Before'),
          node('pre', change.before === undefined ? '(missing property)' : change.before), node('p', 'After'),
          node('pre', change.after === undefined ? '(removed property; now missing)' : change.after));
        section.append(detail);
      }
    } catch {section.append(node('p', 'The exact property diff is unavailable. Inspect the original and checked form JSON directly.', 'error'));}
    $('recheckResults').append(section);
  }
  function retire(message = 'Revised form edited. Recheck these exact bytes to see a new result.', {preserveText = false} = {}) {
    // Expiry and a replacement-file attempt invalidate the result, not the
    // previous file's bytes. Only an editor change adopts normalized text.
    if (!preserveText) uploadedText = uploadedValue = null;
    fileReading = false;
    epoch++; fileRead++; inputMessage = message; inputError = false;
    formDownload = null; formExportMessage = ''; formExportError = false;
    clearTimeout(expiryTimer); expiryTimer = null; render();
    window.dispatchEvent(new CustomEvent('recheck-input-edited', {detail: null}));
  }
  function render() {
    const focused = document.activeElement, resultFocus = $('recheckResults').contains?.(focused), focusedId = focused?.id;
    const s = view?.snapshot, c = s?.computation, enabled = !!view?.approved && !view?.unconfirmed;
    renderExample();
    $('recheckPanel').hidden = !s?.suppliedInput;
    $('recheckRun').disabled = !enabled || !!view?.busy || fileReading || inputError || !text().trim();
    const retained = $('recheckRetained');
    if (retained) {
      retained.hidden = !inputError || !text().trim();
      retained.disabled = retained.hidden || !enabled || !!view?.busy || fileReading;
    }
    $('recheckOriginal').disabled = !enabled || !!view?.busy;
    $('recheckOriginal').textContent = historical() ? 'Restore exact historical original' : 'Copy original form to revise';
    if ($('recheckHistoricalControl')) $('recheckHistoricalControl').hidden = !historical();
    if ($('recheckSeeded')) $('recheckSeeded').disabled = !historical() || !enabled || !!view?.busy;
    $('recheckFile').disabled = !enabled;
    $('recheckFormText').disabled = !enabled;
    $('recheckDownload').disabled = true;
    if ($('recheckFormDownload')) $('recheckFormDownload').disabled = !checkedResult() || !!formDownload;
    if ($('recheckFormExportStatus')) {
      $('recheckFormExportStatus').textContent = formExportMessage;
      $('recheckFormExportStatus').className = formExportError ? 'error' : 'subtle';
      $('recheckFormExportStatus').hidden = !formExportMessage;
    }
    $('recheckResults').replaceChildren();
    let message = inputMessage || (enabled ? 'Paste or select a revised form. Checking stays on this local server.' : 'Approve the exact supplied-input rules to recheck a revised form.');
    let error = inputError;
    if (current() && !view?.dirty && !view?.unconfirmed) {
      if (c.status === 'invalid') {message = 'Invalid revised form: ' + c.validationError + ' No result is available.'; error = true;}
      else if (c.status === 'incomplete') {message = 'Recheck incomplete. No revised-form result is available; this is not a clean check. Recover or explicitly run another check.'; error = true;}
      else if (c.status === 'pending') message = 'Checking this revised form locally. Use Recover computation or Cancel this computation above if needed.';
      else if (c.status === 'complete' && c.recheckResult) {
        const r = c.recheckResult, result = r.computation;
        const labels = {'discrepancies': `${result.findings.length} revised-form discrepancy result${result.findings.length === 1 ? '' : 's'}`,
          'no-discrepancies-partial': 'No discrepancies in a partial check',
          'no-discrepancies-covered-slots': 'No discrepancies in the declared covered slots'};
        message = 'Revised-form recheck complete. ' + (result.status === 'no-discrepancies-partial' ? 'Checked repair: partial. ' : '')
          + labels[result.status] + '. Replacement form is not user-attested. Original approval still belongs to the original form.';
        $('recheckResults').append(node('h3', result.status === 'no-discrepancies-partial' ? 'Checked repair: partial' : 'Revised-form result: ' + labels[result.status]),
          node('p', `${result.statesChecked} complete driver assignments checked. ${result.findings.length} discrepanc${result.findings.length === 1 ? 'y' : 'ies'} across ${result.coverage.present} covered target/property slots. ${result.coverage.unchecked.length} target/property slots remain unchecked. This does not establish policy truth or whole-form correctness.`, 'subtle'));
        if (result.coverage.unchecked.length) $('recheckResults').append(node('p', 'Unchecked: ' + result.coverage.unchecked.join(', '), 'recheck-partial'));
        for (const [index, finding] of result.findings.entries()) {
          const detail = node('details', ''), summary = node('summary', `${finding.field} / ${finding.property}: expected ${finding.expected}, observed ${finding.observed}`);
          summary.id = 'recheckFinding-' + index;
          detail.append(summary,
            node('p', `${finding.violatingStates} mismatching assignment(s). The minimum answer set guarantees the discrepancy across ${finding.guaranteedCompletions} completion(s).`),
            node('pre', JSON.stringify({minimalAnswers: finding.minimalAnswers, completeExample: finding.answers, source: finding.source}, null, 2)));
          $('recheckResults').append(detail);
        }
        const checked = checkedResult();
        if (checked) renderChanges(checked);
        const binding = node('details', ''), bindingSummary = node('summary', 'Exact result and original approval bindings');
        bindingSummary.id = 'recheckBindings'; binding.append(bindingSummary,
          node('pre', JSON.stringify({originalReviewSession: s.sessionId, originalReviewRevision: c.startingRevision,
            originalApproval: c.approvalHash, approvedSpecification: c.specificationSha256,
            originalInput: s.suppliedInput.inputId, originalFormBytes: s.suppliedInput.hashes?.formTextSha256,
            replacementInput: result.inputId, replacementBytes: c.replacementFormTextSha256,
            result: r.resultSha256, attestation: result.attestation}, null, 2)));
        $('recheckResults').append(binding);
        $('recheckDownload').disabled = !enabled || !!view?.busy;
        if (!expiryTimer) expiryTimer = setTimeout(() => {
          expiryTimer = null; retire('The result’s source-review lifetime elapsed. Recover the review state or start a fresh review before rechecking.', {preserveText: true});
        }, Math.max(1, c.sourceExpiresAt - Date.now()));
      }
    } else if (view?.busy && attempt && matches(attempt)) message = 'Checking this revised form locally. Recover or cancel the same operation above; no automatic retry occurs.';
    else if (view?.busy && attempt && !matches(attempt)) message = 'Revised form edited while an earlier operation is unresolved. Its result cannot reappear here. Recover or cancel that exact operation above, then recheck.';
    $('recheckStatus').textContent = message;
    $('recheckStatus').className = error ? 'error' : 'subtle';
    if (resultFocus && !$('recheckPanel').hidden) (focusedId && $(focusedId) || $('recheckStatus')).focus();
  }
  function reset() {
    uploadedText = uploadedValue = null; fileReading = false;
    revisionOrigin = null;
    formDownload = null; formExportMessage = ''; formExportError = false;
    epoch++; fileRead++; attempt = null; sessionId = null; view = null;
    clearTimeout(expiryTimer); expiryTimer = null; inputMessage = ''; inputError = false;
    $('recheckFormText').value = ''; $('recheckFile').value = ''; render();
  }
  window.formRehearsalRecheck = Object.freeze({
    reset, matches, capture: () => ({epoch, formText: text()}),
    refreshPractice: renderExample,
    begin(token) {attempt = {...token, sourceBinding: sourceBinding(view?.snapshot)}; formDownload = null; formExportMessage = ''; formExportError = false; inputMessage = ''; inputError = false; clearTimeout(expiryTimer); expiryTimer = null;},
    update(value) {
      if (sessionId !== value.snapshot?.sessionId) {reset(); sessionId = value.snapshot?.sessionId;}
      if (revisionOrigin && revisionOrigin.sourceBinding !== sourceBinding(value.snapshot)) revisionOrigin = null;
      if (attempt && (value.dirty || attempt.sourceBinding !== sourceBinding(value.snapshot))) {
        attempt = null; formDownload = null; formExportMessage = '';
        if (value.dirty && !inputError) inputMessage = 'Review edited. Confirm an approved review, then explicitly recheck these exact form bytes.';
        clearTimeout(expiryTimer); expiryTimer = null;
      }
      view = value;
      if (!checkedResult()) {formDownload = null; formExportMessage = ''; formExportError = false;}
      render();
    },
    downloadable,
  });
  $('recheckFormDownload')?.addEventListener('click', async () => {
    const bound = checkedResult(); if (!bound || formDownload) return;
    const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
      ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
    const raw = bound.r.formText, resultText = JSON.stringify(canonical(bound.r));
    const scope = value => JSON.stringify([value.s.sessionId, value.s.revision, value.c.jobId, value.c.startingRevision,
      value.c.approvalHash, value.c.specificationSha256, value.c.replacementFormTextSha256, value.c.sourceExpiresAt, sourceBinding(value.s)]);
    const token = {epoch, scope: scope(bound), resultText}; formDownload = token;
    const stillCurrent = () => {
      const next = checkedResult();
      return formDownload === token && token.epoch === epoch && !!next && scope(next) === token.scope
        && JSON.stringify(canonical(next.r)) === token.resultText;
    };
    formExportMessage = 'Verifying the exact checked form bytes before download…'; formExportError = false; render();
    let url;
    try {
      const hash = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))]
        .map(byte => byte.toString(16).padStart(2, '0')).join('');
      const {resultSha256, ...resultPayload} = bound.r;
      const {specificationSha256, ...specificationPayload} = bound.r.specification;
      const hashes = await Promise.all([hash(raw), hash(bound.original.rawInputs.formText),
        hash(JSON.stringify(canonical(resultPayload))), hash(JSON.stringify(canonical(specificationPayload)))]);
      if (!stillCurrent()) return;
      if (hashes[0] !== bound.c.replacementFormTextSha256 || hashes[1] !== bound.original.hashes.formTextSha256
        || hashes[2] !== resultSha256 || hashes[3] !== specificationSha256)
        throw new Error('The form or result digest does not match this check. Run a fresh recheck.');
      // Blob uses transparent endings; the explicit UTF-8 bytes prevent any
      // platform newline conversion or accidental pretty-printing.
      url = URL.createObjectURL(new Blob([new TextEncoder().encode(raw)], {type: 'application/json'}));
      if (!stillCurrent()) return;
      const link = node('a', ''); link.href = url;
      link.download = `checked-form-${resultSha256.slice(0, 12)}.json`;
      document.body.append(link); link.click(); link.remove();
      const requestedURL = url; setTimeout(() => URL.revokeObjectURL(requestedURL), 1000); url = null;
      formExportMessage = `Download requested for the exact checked form JSON (result ${resultSha256}). Replacement remains not-user-attested; original approval belongs to the original form.`;
    } catch (error) {
      if (stillCurrent()) {formExportMessage = 'Checked form was not downloaded: ' + error.message; formExportError = true;}
    } finally {
      if (url) URL.revokeObjectURL(url);
      if (formDownload === token) {formDownload = null; render();}
    }
  });
  $('recheckFormText').addEventListener('input', () => {if (revisionOrigin) revisionOrigin.edited = true; retire();});
  $('recheckExample')?.addEventListener('click', () => {
    // A stale enabled DOM button is not authority. Read the owning review now.
    const candidate = exampleRevision(); if (!candidate) {render(); return;}
    const pin = JSON.stringify(candidate), before = text(), beforeEpoch = epoch;
    const original = view.snapshot.suppliedInput.rawInputs.formText;
    const untouchedExample = revisionOrigin && !revisionOrigin.edited && before === candidate.formText;
    if (before.trim() && before !== original && !untouchedExample
      && !window.confirm?.('Replace the current revised-form text with the source-authored equipment example? Unsaved edits in this editor will be discarded.')) return;
    // Confirmation can outlive the practice/session; never load into newer work.
    if (epoch !== beforeEpoch || text() !== before || JSON.stringify(exampleRevision()) !== pin) {render(); return;}
    $('recheckFile').value = ''; // Retired file callbacks return before clearing their picker.
    $('recheckFormText').value = candidate.formText;
    revisionOrigin = {edited: false, sourceBinding: sourceBinding(view.snapshot)};
    retire('Authored example revision loaded only. Inspect the two visibility expressions, then explicitly recheck. Changed reviewed predicates may produce a different result.');
    // Keep exact supplied UTF-8 bytes even if the textarea normalizes newlines.
    uploadedText = candidate.formText; uploadedValue = $('recheckFormText').value;
    render(); $('recheckFormText').focus();
  });
  $('recheckRetained')?.addEventListener('click', () => {
    if ($('recheckRetained').disabled || $('recheckRetained').hidden) return;
    // Dismiss only the rejected selection; retain current bytes and invalidate
    // every earlier operation. Running a new check remains a separate action.
    retire('Rejected file discarded. The previous form is unchanged. Explicitly recheck it to see a new result.', {preserveText: true});
    $('recheckRun').focus();
  });
  $('recheckOriginal').addEventListener('click', () => {
    if ($('recheckOriginal').disabled) return;
    const original = view.snapshot.suppliedInput.rawInputs.formText;
    revisionOrigin = null;
    $('recheckFormText').value = original;
    retire(historical() ? 'Exact historical original restored in the editor. Explicitly recheck it; the three omitted checks remain unchecked.' : 'Original form copied exactly. Edit only target visibility/requiredness logic, then recheck.');
    uploadedText = original; uploadedValue = $('recheckFormText').value; render();
    $('recheckFormText').focus();
  });
  $('recheckSeeded')?.addEventListener('click', () => {
    if ($('recheckSeeded').disabled || !historical()) return;
    const form = JSON.parse(view.snapshot.suppliedInput.rawInputs.formText), elements = form.pages?.[0]?.elements ?? form.elements;
    const target = elements.find(question => question.name === 'route_check');
    if (!target) return; // A mismatched source cannot receive this closed demonstration.
    revisionOrigin = null;
    target.visibleIf = '{permit} = true';
    $('recheckFormText').value = JSON.stringify(form, null, 2);
    retire('Newly authored seeded revision copied. The historical original and model response are unchanged. Explicitly recheck to see its discrepancy.');
    $('recheckFormText').focus();
  });
  $('recheckFile').addEventListener('change', async () => {
    const file = $('recheckFile').files?.[0]; if (!file) return;
    retire('Reading the selected local JSON file…', {preserveText: true}); const token = fileRead, owner = sessionId; fileReading = true; render();
    // File.arrayBuffer + fatal UTF-8 decode preserves CRLF/BOM and rejects invalid
    // encoding. No newline conversion or text repair before server validation.
    try {
      if (file.size > 32768) throw new Error('Choose a form of at most 32768 UTF-8 bytes.');
      const bytes = await file.arrayBuffer();
      if (token !== fileRead || owner !== sessionId) return;
      $('recheckFormText').value = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(bytes);
      // Textareas normalize CRLF visually. Keep the original bytes in a separate
      // capture until the user edits, rather than silently normalizing an upload.
      const raw = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(bytes);
      uploadedText = raw; uploadedValue = $('recheckFormText').value;
      revisionOrigin = null;
      inputMessage = 'Local form loaded. Its exact UTF-8 text will be checked; no provider receives it.'; inputError = false;
    } catch (error) {
      if (token !== fileRead || owner !== sessionId) return;
      inputMessage = 'File not loaded: ' + error.message
        + (text().trim() ? ' The previous form is unchanged. Choose Use previous form, then explicitly recheck.' : '');
      inputError = true;
    }
    fileReading = false; $('recheckFile').value = ''; render();
  });
  window.addEventListener('pagehide', () => window.formRehearsalRecheck.reset());
})();
