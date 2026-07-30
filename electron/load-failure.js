const api = window.bigbrainLoadFailure;
const details = document.querySelector('#details');
const reload = document.querySelector('#reload');

if (!api) {
  details.textContent = 'BigBrain could not load its recovery controls. Close the app and open it again.';
  reload.disabled = true;
} else {
  api.state()
    .then((result) => {
      details.textContent = result?.message || 'The dashboard did not finish loading.';
    })
    .catch(() => {
      details.textContent = 'The dashboard did not finish loading.';
    });

  reload.addEventListener('click', async () => {
    reload.disabled = true;
    reload.textContent = 'Reloading…';
    try {
      await api.reload();
    } catch {
      details.textContent = 'Reloading failed. Close BigBrain and open it again.';
      reload.disabled = false;
      reload.textContent = 'Try again';
    }
  });
}
