/**
 * Data Storage & Synchronization Manager
 * Manages the in-memory calendar database, localStorage cache, and debounced GitHub updates.
 */

import * as github from './github.js?v=1.1.4';

// Global in-memory state
let db = {
  version: 1,
  users: [],
  appointmentTypes: [
    { id: 'dienst', name: 'Dienst', color: '#3b82f6' },
    { id: 'schulung', name: 'Schulung', color: '#f59e0b' },
    { id: 'urlaub', name: 'Urlaub', color: '#10b981' },
    { id: 'krank', name: 'Krank', color: '#ef4444' },
    { id: 'freizeit', name: 'Freizeit', color: '#6b7280' },
    { id: 'schule', name: 'Schule', color: '#8b5cf6' }
  ],
  appointments: [],
  studentCodes: []
};

// Debounce timer for saving to GitHub
let githubSaveTimeout = null;

// Callbacks for UI updates
let onSyncStateChange = null;

export function registerSyncStateCallback(cb) {
  onSyncStateChange = cb;
}

function updateSyncStatus(status, errorMsg = '') {
  if (onSyncStateChange) {
    onSyncStateChange(status, errorMsg);
  }
}

/**
 * Initializes database from local storage, then syncs with GitHub if configured.
 */
export async function initDatabase() {
  // 1. Load from localStorage cache
  const cachedData = localStorage.getItem('ak_calendar_db');
  if (cachedData) {
    try {
      db = { ...db, ...JSON.parse(cachedData) };
    } catch (e) {
      console.error('Failed to parse cached database from localStorage', e);
    }
  }

  // 2. Check if GitHub is configured
  github.initConfig();
  if (github.isConfigured()) {
    updateSyncStatus('syncing');
    try {
      const githubData = await github.fetchData();
      if (githubData) {
        // GitHub data is the source of truth
        db = { ...db, ...githubData };
        saveLocal();
        updateSyncStatus('synced');
      } else {
        // File does not exist on GitHub yet. Push our local state.
        updateSyncStatus('syncing');
        await github.saveData(db);
        updateSyncStatus('synced');
      }
    } catch (e) {
      console.error('Error syncing with GitHub on startup', e);
      updateSyncStatus('error', e.message || 'GitHub-Ladefehler');
    }
  } else {
    updateSyncStatus('not-configured');
  }

  return db;
}

/**
 * Saves database to localStorage immediately
 */
function saveLocal() {
  localStorage.setItem('ak_calendar_db', JSON.stringify(db));
}

/**
 * Schedules a write to GitHub with a debounce of 1.5 seconds to group multiple changes.
 */
export function scheduleGitHubSync() {
  saveLocal();

  if (!github.isConfigured()) {
    updateSyncStatus('not-configured');
    return;
  }

  updateSyncStatus('syncing');

  if (githubSaveTimeout) {
    clearTimeout(githubSaveTimeout);
  }

  githubSaveTimeout = setTimeout(async () => {
    try {
      await github.saveData(db);
      updateSyncStatus('synced');
    } catch (e) {
      console.error('Error saving data to GitHub', e);
      updateSyncStatus('error', e.message || 'GitHub-Speicherfehler');
    }
  }, 1500);
}

/**
 * Triggers an immediate sync (forces writing to GitHub right away)
 */
export async function forceSyncNow() {
  saveLocal();
  if (githubSaveTimeout) {
    clearTimeout(githubSaveTimeout);
  }

  if (!github.isConfigured()) {
    updateSyncStatus('not-configured');
    return;
  }

  updateSyncStatus('syncing');
  try {
    await github.saveData(db);
    updateSyncStatus('synced');
  } catch (e) {
    console.error('Error in forced GitHub sync', e);
    updateSyncStatus('error', e.message || 'GitHub-Speicherfehler');
    throw e;
  }
}

/**
 * Replace entire database (used for importing JSON backups)
 */
export function importDatabase(newData) {
  if (!newData || typeof newData !== 'object') {
    throw new Error('Ungültige Datenstruktur.');
  }
  
  // Basic validation
  if (!Array.isArray(newData.users) || !Array.isArray(newData.appointments)) {
    throw new Error('Die JSON-Datei entspricht nicht dem erwarteten Ausbildungskalender-Format.');
  }

  const rawStudentCodes = newData.studentCodes || [];
  const normalizedStudentCodes = rawStudentCodes.map(item => {
    if (typeof item === 'string') {
      return item.toUpperCase();
    }
    return (item.code || '').toUpperCase();
  }).filter(Boolean);

  db = {
    version: newData.version || 1,
    users: newData.users,
    studentCodes: normalizedStudentCodes,
    appointmentTypes: newData.appointmentTypes || db.appointmentTypes,
    appointments: newData.appointments
  };

  scheduleGitHubSync();
  return db;
}

export function getDatabase() {
  return db;
}

// --- Getter and Setter helpers for individual lists ---

export function getUsers() {
  return db.users;
}

export function setUsers(usersList) {
  db.users = usersList;
  scheduleGitHubSync();
}

export function getAppointmentTypes() {
  return db.appointmentTypes;
}

export function setAppointmentTypes(typesList) {
  db.appointmentTypes = typesList;
  scheduleGitHubSync();
}

export function getAppointments() {
  return db.appointments;
}

export function setAppointments(apptList) {
  db.appointments = apptList;
  scheduleGitHubSync();
}

export function getStudentCodes() {
  const codes = db.studentCodes || [];
  return codes.map(item => {
    if (typeof item === 'string') {
      return item.toUpperCase();
    }
    return (item.code || '').toUpperCase();
  }).filter(Boolean);
}

export function setStudentCodes(codesList) {
  db.studentCodes = codesList;
  scheduleGitHubSync();
}
