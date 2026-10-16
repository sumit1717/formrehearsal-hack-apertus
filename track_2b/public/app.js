const mode = new URLSearchParams(location.search).get('mode') === 'reference' ? 'reference' : 'review';
document.getElementById('mode').value = mode;
document.getElementById(`${mode}Root`).hidden = false;
document.getElementById('mode').addEventListener('change', event => {
  const nextMode = event.target.value === 'reference' ? 'reference' : 'review';
  event.target.value = mode;
  if (nextMode === mode || mode === 'review' && window.formRehearsalReview?.confirmLeave() === false) return;
  const url = new URL(location.href);
  url.searchParams.set('mode', nextMode);
  location.assign(url);
});
await import(mode === 'reference' ? './reference.js' : './review.js');
