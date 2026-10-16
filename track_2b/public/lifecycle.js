// Advisory countdowns only. Every release is checked again by the server.
const $ = id => document.getElementById(id);
let inventory = null, receivedAt = 0, busy = false, releaseButtons = [], reviewMarkers = [];
let currentReviewId = $('reviewWorkspace')?.dataset.sessionId ?? '';
const status = message => {if ($('lifecycleStatus').textContent !== message) $('lifecycleStatus').textContent = message;};
const node = (tag, text) => {const value = document.createElement(tag); value.textContent = text; return value;};
const focusable = value => value && value.isConnected !== false && !value.disabled && !value.hidden && !value.closest?.('[hidden]');
const focus = value => {if (focusable(value)) value.focus?.();};
function holdFocus(control) {
  if (document.activeElement !== control) return false;
  focus($('lifecycleStatus')); return document.activeElement === $('lifecycleStatus');
}
function syncCurrentReview() {
  for (const {marker, id} of reviewMarkers) {
    const message = id === currentReviewId ? 'Current review in this tab. Export anything you need before releasing it.' : '';
    if (marker.textContent !== message) marker.textContent = message;
    marker.hidden = !message;
  }
}
window.addEventListener('review-view-changed', event => {currentReviewId = event.detail.sessionId ?? ''; syncCurrentReview();});
const reviewStates = {
  authoring: 'Independent draft', 'review-needed': 'Needs review', approved: 'Approved rules',
  analyzed: 'Analysis complete', replayed: 'Replay complete', abstained: 'Extraction abstained', invalid: 'Invalid proposal',
  analyzing: 'Analysis in progress', replaying: 'Replay in progress',
  'analysis-incomplete': 'Analysis incomplete', 'replay-incomplete': 'Replay incomplete',
};
async function refresh() {
  if (busy) return;
  busy = true; status('Refreshing capacity and expiry…');
  let resume = null;
  const held = holdFocus($('lifecycleRefresh')); $('lifecycleRefresh').disabled = true;
  try {
    const response = await fetch('/api/lifecycle', {cache: 'no-store'}), data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Capacity unavailable');
    inventory = data; receivedAt = performance.now(); resume = render();
    status('Server snapshot refreshed. Available slots and remaining times are advisory; other tabs may renew, create or release items.');
  } catch (error) {status('Capacity refresh failed: ' + error.message + '. The last displayed snapshot may be out of date. Refresh to try again.');}
  finally {
    busy = false; $('lifecycleRefresh').disabled = false;
    if ((held || resume) && document.activeElement === $('lifecycleStatus')) focus(resume ?? $('lifecycleRefresh'));
  }
}
function render() {
  // Capture focus at render time: the user may have moved while a request ran.
  const oldButtons = releaseButtons, focused = document.activeElement;
  const oldIndex = oldButtons.indexOf(focused), oldKey = focused?.dataset.releaseKey;
  if (oldIndex >= 0) focus($('lifecycleStatus'));
  const area = $('lifecycleEntries'); area.replaceChildren(); releaseButtons = []; reviewMarkers = [];
  for (const kind of ['inputs', 'reviews']) {
    const group = inventory[kind], reserved = kind === 'reviews' ? group.reserved : 0;
    area.append(node('h3', kind === 'inputs' ? `Validated inputs: ${group.used}/${group.limit}` : `Reviews: ${group.used}/${group.limit}; protected provider reservations: ${reserved}`));
    area.append(node('p', `${Math.max(0, group.limit - group.used - reserved)} ${kind === 'inputs' ? 'input' : 'review'} slots available at this snapshot.`));
    if (!group.entries.length) area.append(node('p', `No ${kind === 'inputs' ? 'validated inputs' : 'reviews'} in this snapshot.`));
    for (const entry of group.entries) {
      const id = entry.inputId || entry.sessionId, row = node('div', ''); row.className = 'lifecycle-entry';
      row.append(node('p', `${kind === 'inputs' ? 'Input' : 'Review'} ${id}`));
      if (kind === 'reviews') {
        row.append(node('p', `State at last refresh: ${reviewStates[entry.state] ?? 'Unavailable'} · revision ${entry.revision}.`));
        const marker = node('p', ''); reviewMarkers.push({marker, id}); row.append(marker);
      }
      row.append(node('p', 'Expires at ' + new Date(entry.expiresAt).toISOString() + ' (server time at last refresh).'));
      const timing = node('p', ''); timing.dataset.remaining = String(entry.remainingMs); row.append(timing);
      const pending = kind === 'inputs' && inventory.pendingInputIds.includes(entry.inputId);
      if (pending) row.append(node('p', 'An extraction currently owns a captured copy of this input and a protected review reservation. Release will not cancel or free that reservation.'));
      if (entry.pendingComputation) row.append(node('p', 'Local computation pending; releasing this review cancels it.'));
      const button = node('button', 'Release this ' + (kind === 'inputs' ? 'input' : 'review'));
      button.type = 'button'; button.className = 'secondary'; button.dataset.releaseKey = kind + '/' + id;
      button.addEventListener('click', async () => {
        if (busy) return;
        const warning = kind === 'inputs'
          ? `Release input ${id}? Future starts require validation again. Any already-running extraction keeps its captured input and reserved review capacity. No cancellation, budget refund or retry occurs.`
          : `Release ${id === currentReviewId ? 'the current ' : ''}review ${id}? Its local draft, approval and results will be lost, and any pending local computation will be cancelled. Export any result or approved specification you need before releasing. No provider budget is refunded and nothing is retried.`;
        if (!window.confirm(warning)) return;
        busy = true; status('Releasing ' + (kind === 'inputs' ? 'input ' : 'review ') + id + '…');
        const held = holdFocus(button), index = releaseButtons.indexOf(button);
        let released = false, resume = null;
        button.disabled = true; $('lifecycleRefresh').disabled = true;
        try {
          const body = kind === 'inputs' ? {inputId: id, leaseId: entry.leaseId} : {sessionId: id, expectedRevision: entry.revision};
          const response = await fetch(kind === 'inputs' ? '/api/input/release' : '/api/review/release', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
          const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Release rejected');
          if (data?.released !== true || (kind === 'inputs'
            ? data.inputId !== id || data.leaseId !== entry.leaseId || data.leaseEpoch !== entry.leaseEpoch || data.leaseRevision !== entry.leaseRevision
              || typeof data.leaseEpoch !== 'string' || !data.leaseEpoch || !Number.isSafeInteger(data.leaseRevision) || data.leaseRevision < 1
            : data.sessionId !== id)) throw new Error('The release acknowledgment did not match this item');
          group.entries = group.entries.filter(value => value !== entry); group.used--; released = true; resume = render();
          window.dispatchEvent(new CustomEvent('lifecycle-release', {detail: {...body, ...(kind === 'inputs' ? {leaseEpoch: data.leaseEpoch, leaseRevision: data.leaseRevision} : {})}}));
          status('Released ' + id + '. ' + (kind === 'inputs' ? 'Validated input removed. ' : 'Review draft, approval and results removed. ')
            + (pending ? 'Its protected extraction reservation remains; review capacity was not freed. ' : '')
            + 'Refresh to check current capacity across tabs. No provider request or budget refund was made.');
        } catch (error) {status('Release could not be confirmed: ' + error.message + '. The item is retained here. Refresh capacity to inspect the server; no automatic retry was made.');}
        finally {
          busy = false; button.disabled = false; $('lifecycleRefresh').disabled = false;
          if ((held || resume) && document.activeElement === $('lifecycleStatus')) focus(resume ?? (released ? releaseButtons[index] ?? releaseButtons[index - 1] ?? $('lifecycleRefresh') : button));
        }
      });
      releaseButtons.push(button); row.append(button); area.append(row);
    }
  }
  syncCurrentReview(); tick();
  const resume = oldIndex >= 0 ? releaseButtons.find(button => button.dataset.releaseKey === oldKey) ?? releaseButtons[oldIndex] ?? releaseButtons[oldIndex - 1] ?? $('lifecycleRefresh') : null;
  focus(resume); return resume;
}
function tick() {
  // Countdown text is deliberately outside the live status region.
  for (const item of document.querySelectorAll('[data-remaining]')) {
    const ms = Math.max(0, Number(item.dataset.remaining) - (performance.now() - receivedAt));
    item.textContent = ms > 0 ? `Approximately ${Math.ceil(ms / 1000)} seconds remaining at this snapshot. Refresh to check renewals.` : 'Expiry reached on this snapshot; refresh to check the server.';
  }
}
$('lifecycleRefresh').addEventListener('click', refresh);
setInterval(tick, 1000);
void refresh();
