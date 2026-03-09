// Groopa popup script — read settings and show status

const statusEl = document.getElementById('status-text');
const openSettingsBtn = document.getElementById('open-settings');

// Load saved values and update status
chrome.storage.sync.get(['isPaidUser', 'keywords', 'soundEnabled'], (result) => {
  const isPaidUser = result.isPaidUser === true;
  const keywords = result.keywords || [];
  const soundEnabled = result.soundEnabled !== false;
  const keywordCount = Array.isArray(keywords) ? keywords.length : 0;

  if (!isPaidUser) {
    statusEl.textContent = 'No paid access enabled';
  } else {
    const soundText = soundEnabled ? 'Sound on' : 'Sound off';
    statusEl.textContent = `Paid active • ${keywordCount} keyword${keywordCount === 1 ? '' : 's'} • ${soundText}`;
  }
});

// Open options page when button is clicked
openSettingsBtn.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});
