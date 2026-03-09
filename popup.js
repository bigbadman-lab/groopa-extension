// Groopa popup script

const statusEl = document.getElementById('status-text');
const openSettingsBtn = document.getElementById('open-settings');

// Set status message
statusEl.textContent = 'Extension is active. Visit a Facebook group to monitor.';

// Open options page when button is clicked
openSettingsBtn.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});
