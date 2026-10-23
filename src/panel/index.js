import { initializePanel } from './app.js';
initializePanel().catch((error) => {
  const banner = document.querySelector('#app-error');
  banner.textContent = `Could not open your saved workspace. ${error.message}`;
  banner.hidden = false;
});
