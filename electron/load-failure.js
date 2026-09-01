const api = window.bigbrainLoadFailure;
const details = document.querySelector('#details');
const personal = document.querySelector('#personal');
const choose = document.querySelector('#choose');
const reload = document.querySelector('#reload');
const buttons = [personal, choose, reload].filter(Boolean);

function setButtonsDisabled(disabled) {
  buttons.forEach((button) => { button.disabled = disabled; });
}

async function runAction(button, pendingLabel, action) {
  setButtonsDisabled(true);
  button.textContent = pendingLabel;
  try {
    await action();
  } catch {
    details.textContent = 'That action failed. Try another option or reopen BigBrain.';
    setButtonsDisabled(false);
    button.textContent = pendingLabel.replace('…', '') || 'Try again';
  }
}

if (!api) {
  details.textContent = 'BigBrain could not load its recovery controls. Close the app and open it again.';
  setButtonsDisabled(true);
} else {
  api.state()
    .then((result) => {
      details.textContent = result?.message || 'The dashboard did not finish loading.';
    })
    .catch(() => {
      details.textContent = 'The dashboard did not finish loading.';
    });

  personal.addEventListener('click', () => runAction(personal, 'Opening Personal Brain…', api.openPersonalBrain));
  choose.addEventListener('click', () => runAction(choose, 'Opening brain chooser…', api.chooseBrain));
  reload.addEventListener('click', () => runAction(reload, 'Retrying…', api.reload));
}
