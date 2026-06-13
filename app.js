/**
 * Application Entry Point and Orchestrator
 * Bootstraps the application, registers events, and syncs status indicators.
 */

import * as storage from './modules/storage.js?v=1.1.4';
import * as auth from './modules/auth.js?v=1.1.4';
import * as calendar from './modules/calendar.js?v=1.1.4';
import * as ui from './modules/ui.js?v=1.1.4';
import * as github from './modules/github.js?v=1.1.4';

// Bind sync indicator elements
const syncIndicator = document.getElementById('github-sync-indicator');
const syncText = document.getElementById('sync-status-text');
const syncSpinner = syncIndicator.querySelector('.sync-spinner');

/**
 * Updates the visual sync status badge in the header
 */
function handleSyncStateChange(state, errorMsg = '') {
  // Clear classes
  syncIndicator.className = 'sync-indicator';
  syncSpinner.classList.add('hidden');
  
  if (state === 'not-configured') {
    syncIndicator.classList.add('not-configured');
    syncText.textContent = 'Lokal';
    syncIndicator.setAttribute('title', 'GitHub Sync nicht eingerichtet');
  } else if (state === 'synced') {
    syncIndicator.classList.add('synced');
    syncText.textContent = 'Synchronisiert';
    syncIndicator.setAttribute('title', 'Erfolgreich mit GitHub synchronisiert');
  } else if (state === 'syncing') {
    syncIndicator.classList.add('syncing');
    syncSpinner.classList.remove('hidden');
    syncText.textContent = 'Synchronisiere...';
    syncIndicator.setAttribute('title', 'Daten werden auf GitHub übertragen');
  } else if (state === 'error') {
    syncIndicator.classList.add('error');
    syncText.textContent = 'Sync-Fehler';
    syncIndicator.setAttribute('title', errorMsg || 'Verbindung zu GitHub fehlgeschlagen');
  }
}

/**
 * Initializes the application on load
 */
async function bootstrap() {
  ui.showLoader('Ausbildungskalender wird geladen...');
  
  try {
    // 1. Register sync state callback immediately to catch load events
    storage.registerSyncStateCallback(handleSyncStateChange);
    
    // 1b. Check for auto-configuration parameters in URL
    const urlParams = new URLSearchParams(window.location.search);
    const importToken = urlParams.get('gh_token');
    const importRepo = urlParams.get('gh_repo');
    const importBranch = urlParams.get('gh_branch') || 'main';
    const importPath = urlParams.get('gh_path') || 'data.json';

    if (importToken && importRepo) {
      github.saveConfig({
        token: importToken,
        repo: importRepo,
        branch: importBranch,
        path: importPath
      });
      
      // Clean URL parameters immediately for security & clean address bar
      const cleanUrl = window.location.protocol + "//" + window.location.host + window.location.pathname;
      window.history.replaceState({}, document.title, cleanUrl);
    }

    // 2. Load configurations and files from cache/github
    await storage.initDatabase();
    
    // 3. Initialize UI event bindings
    ui.initUIListeners();
    auth.initAuthListeners();
    auth.initAutoLockListeners();
    
    ui.hideLoader();

    // 4. Initial check for users to trigger lock or onboarding screens
    auth.renderUserSelection();
    auth.lockApp();
    
  } catch (err) {
    ui.hideLoader();
    console.error('Critical initialization error:', err);
    ui.showToast('Kritischer Fehler beim Starten der App.', 'danger');
  }
}

// Global hook: When login succeeds, render dashboard contents
window.addEventListener('app-login-success', () => {
  // Populate datalists and drop-downs
  ui.refreshFormSelects();
  
  // Re-render sidebar filters lists
  calendar.renderRosterFilterList();
  calendar.renderStudentFilterList();
  calendar.renderTypeFilterList();
  
  // Draw current calendar view
  calendar.renderCalendar();
});

// Global hook: When GitHub configurations change, adjust status indicators
window.addEventListener('github-config-changed', () => {
  if (github.isConfigured()) {
    handleSyncStateChange('syncing');
    storage.forceSyncNow()
      .then(() => {
        calendar.renderCalendar();
        ui.refreshFormSelects();
      })
      .catch(() => {});
  } else {
    handleSyncStateChange('not-configured');
  }
});

// Run bootstrap
document.addEventListener('DOMContentLoaded', bootstrap);
