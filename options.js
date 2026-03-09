// Groopa options page — save/load settings with chrome.storage.sync

const paidCheckbox = document.getElementById('paid-user');
const keywordsTextarea = document.getElementById('keywords');
const soundCheckbox = document.getElementById('sound-enabled');
const saveBtn = document.getElementById('save-btn');
const saveMessage = document.getElementById('save-message');

// Load saved values when page opens
chrome.storage.sync.get(['isPaidUser', 'keywords', 'soundEnabled'], (result) => {
  paidCheckbox.checked = result.isPaidUser === true;
  const keywords = result.keywords || [];
  keywordsTextarea.value = Array.isArray(keywords) ? keywords.join('\n') : '';
  soundCheckbox.checked = result.soundEnabled !== false;
});

// Save when user clicks Save Settings
saveBtn.addEventListener('click', () => {
  const isPaidUser = paidCheckbox.checked;
  const keywordsText = keywordsTextarea.value || '';
  const keywords = keywordsText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const soundEnabled = soundCheckbox.checked;

  chrome.storage.sync.set({ isPaidUser, keywords, soundEnabled }, () => {
    saveMessage.style.display = 'block';
    setTimeout(() => {
      saveMessage.style.display = 'none';
    }, 2000);
  });
});
