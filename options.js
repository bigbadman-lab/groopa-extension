// Groopa options page — save/load settings with chrome.storage.sync

const soundCheckbox = document.getElementById('sound-enabled');
const saveBtn = document.getElementById('save-btn');
const saveMessage = document.getElementById('save-message');

// Load saved setting when page opens
chrome.storage.sync.get(['soundEnabled'], (result) => {
  soundCheckbox.checked = result.soundEnabled !== false;
});

// Save when user clicks Save
saveBtn.addEventListener('click', () => {
  const soundEnabled = soundCheckbox.checked;
  chrome.storage.sync.set({ soundEnabled }, () => {
    saveMessage.style.display = 'block';
    setTimeout(() => {
      saveMessage.style.display = 'none';
    }, 2000);
  });
});
