const FIELDS = ['serverUrl', 'token', 'callerName'];
const DEFAULTS = { serverUrl: 'http://127.0.0.1:8000', token: 'local-dev-token', callerName: '' };

const statusEl = document.getElementById('status');
const savedEl = document.getElementById('saved');

function setStatus(className, title, detail) {
  statusEl.className = className;
  statusEl.replaceChildren();
  const strong = document.createElement('b');
  strong.textContent = title;
  statusEl.append(strong, document.createTextNode(detail));
}

/** Ask the background worker, which is the only thing that talks to the server. */
function ask(message) {
  return new Promise((resolve) => chrome.runtime.sendMessage(message, resolve));
}

async function refreshStatus() {
  setStatus('', 'Checking the server…', '');

  // A missing host permission looks identical to a dead server from here, so
  // name it explicitly rather than sending the user to check a server that is
  // running perfectly well.
  const stored = await chrome.storage.sync.get(DEFAULTS);
  try {
    const url = new URL(stored.serverUrl);
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)
        && !(await chrome.permissions.contains({ origins: [`${url.origin}/*`] }))) {
      return setStatus('bad', 'Permission needed',
        `Chrome has not been allowed to reach ${url.origin}. Press Save, then Grant access.`);
    }
  } catch (error) { /* an invalid address is reported by the health check below */ }

  const response = await ask({ type: 'health' });

  if (!response || !response.ok) {
    return setStatus('bad', 'Cannot reach the server',
      (response && response.error) || 'Check the address below, and that the server is running.');
  }
  const health = response.data;
  const model = health.model_pass && health.model_pass !== 'off'
    ? ` Model pass: ${health.model_pass}.` : ' Detection is rules only.';

  if (health.dials_real_phones) {
    setStatus('live', 'Live — this can dial real phones',
      `Every call still needs you to press the button that names the number.${model}`);
  } else {
    setStatus('ok', 'Connected — fixture mode',
      `Nothing can be dialled. Recorded outcomes are replayed instead.${model}`);
  }
}

async function load() {
  const stored = await chrome.storage.sync.get(DEFAULTS);
  FIELDS.forEach((field) => { document.getElementById(field).value = stored[field] || ''; });
  refreshStatus();
}

async function grantButton(origin) {
  const wrap = document.getElementById('saved');
  wrap.className = 'warn';
  wrap.replaceChildren(document.createTextNode('This address needs permission. '));
  const button = document.createElement('button');
  button.textContent = `Grant access to ${origin}`;
  button.style.marginTop = '8px';
  button.addEventListener('click', async () => {
    // A dedicated click is a clean user gesture. Settings are already saved, so
    // even if Chrome's dialog dismisses this popup nothing is lost.
    try {
      if (await chrome.permissions.request({ origins: [`${origin}/*`] })) {
        wrap.className = '';
        wrap.textContent = 'Granted.';
        refreshStatus();
        return;
      }
    } catch (error) { /* popup dismissed; reopening will show the button again */ }
    wrap.className = 'warn';
    wrap.textContent = 'Not granted. Reopen this popup and try again.';
  });
  wrap.appendChild(button);
}

document.getElementById('save').addEventListener('click', async () => {
  const values = {};
  FIELDS.forEach((field) => { values[field] = document.getElementById(field).value.trim(); });
  const savedNode = document.getElementById('saved');
  savedNode.className = '';
  savedNode.textContent = '';

  let url;
  try {
    url = new URL(values.serverUrl);
  } catch (error) {
    savedNode.className = 'warn';
    savedNode.textContent = 'That is not a valid address.';
    return;
  }

  // Same rule the background worker enforces, stated here so it is refused at
  // the point it is typed rather than silently failing on the first request.
  const isLocal = ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocal)) {
    savedNode.className = 'warn';
    savedNode.textContent =
      'Use https for a remote server, or http only on this machine. '
      + 'Your token and the thread are not sent over plaintext to another host.';
    return;
  }

  // Persist BEFORE anything that can close this popup. Chrome's permission
  // dialog dismisses the popup, so a save that waited on it never ran and the
  // address silently stayed at the default.
  await chrome.storage.sync.set(values);
  savedNode.textContent = 'Saved.';

  const loopback = ['127.0.0.1', 'localhost'].includes(url.hostname);
  if (!loopback && !(await chrome.permissions.contains({ origins: [`${url.origin}/*`] }))) {
    return grantButton(url.origin);
  }
  refreshStatus();
});

load();
