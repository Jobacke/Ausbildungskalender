/**
 * Authentication & User Management Module
 * Manages user logins, lock screens, and PIN security (salted SHA-256 hashes).
 */

import * as storage from './storage.js?v=1.1.0';
import * as ui from './ui.js?v=1.1.0';

let currentUser = null;
let autoLockTimer = null;
const AUTO_LOCK_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes inactivity

/**
 * Computes SHA-256 hash of a PIN salted with the username
 */
export async function hashPin(username, pin) {
  const saltedMsg = `${username.toLowerCase()}:${pin}`;
  const msgUint8 = new TextEncoder().encode(saltedMsg);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export function getCurrentUser() {
  return currentUser;
}

export function isLoggedIn() {
  return currentUser !== null;
}

/**
 * Log out / Lock application
 */
export function lockApp() {
  currentUser = null;
  stopAutoLockCountdown();
  
  // Show auth view, hide app shell
  const appShell = document.getElementById('app-shell');
  const authView = document.getElementById('auth-view');
  
  appShell.classList.add('hidden');
  appShell.classList.remove('active');
  
  authView.classList.remove('hidden');
  authView.classList.add('active');
  
  // Clear entered PIN buffer
  resetPinEntry();
  
  // Show user selection list
  renderUserSelection();
}

/**
 * Successful login handler
 */
function loginAs(user) {
  currentUser = user;
  
  // Update UI avatar and name
  document.getElementById('user-avatar').textContent = user.username.substring(0, 2).toUpperCase();
  document.getElementById('user-display-name').textContent = user.username;
  
  // View transition
  const appShell = document.getElementById('app-shell');
  const authView = document.getElementById('auth-view');
  
  authView.classList.remove('active');
  authView.classList.add('hidden');
  
  appShell.classList.remove('hidden');
  appShell.classList.add('active');
  
  ui.showToast(`Herzlich willkommen, ${user.username}!`, 'success');
  
  // Trigger calendar render (will be handled by main app bootstrap via custom event)
  window.dispatchEvent(new CustomEvent('app-login-success'));
  
  // Start inactivity timer
  resetAutoLockCountdown();
}

/**
 * Adds event listeners to detect user activity and reset auto-lock
 */
export function resetAutoLockCountdown() {
  if (autoLockTimer) {
    clearTimeout(autoLockTimer);
  }
  
  if (isLoggedIn()) {
    autoLockTimer = setTimeout(() => {
      lockApp();
      ui.showToast('Automatische Abmeldung wegen Inaktivität.', 'warning');
    }, AUTO_LOCK_TIMEOUT_MS);
  }
}

function stopAutoLockCountdown() {
  if (autoLockTimer) {
    clearTimeout(autoLockTimer);
    autoLockTimer = null;
  }
}

// Attach activity listeners to reset auto-lock
export function initAutoLockListeners() {
  const activityEvents = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart'];
  activityEvents.forEach(eventName => {
    document.addEventListener(eventName, resetAutoLockCountdown, { passive: true });
  });
}

/**
 * Render user selection lists on lock screen
 */
export function renderUserSelection() {
  const users = storage.getUsers();
  const usersGrid = document.getElementById('users-grid');
  const onboardingDiv = document.getElementById('auth-onboarding');
  const selectionDiv = document.getElementById('auth-users-selection');
  const authSubtitle = document.getElementById('auth-subtitle');
  const pinEntryDiv = document.getElementById('auth-pin-entry');

  pinEntryDiv.classList.add('hidden');

  if (users.length === 0) {
    // Show onboarding form
    selectionDiv.classList.add('hidden');
    onboardingDiv.classList.remove('hidden');
    authSubtitle.textContent = 'Willkommen zum Ausbildungskalender';
  } else {
    // Show user choices
    onboardingDiv.classList.add('hidden');
    selectionDiv.classList.remove('hidden');
    authSubtitle.textContent = 'Wählen Sie Ihren Account aus';
    
    usersGrid.innerHTML = '';
    users.forEach(user => {
      const card = document.createElement('div');
      card.className = 'user-card';
      
      const avatar = document.createElement('div');
      avatar.className = 'user-avatar-large';
      avatar.textContent = user.username.substring(0, 2).toUpperCase();
      
      const name = document.createElement('span');
      name.textContent = user.username;
      
      card.appendChild(avatar);
      card.appendChild(name);
      
      card.addEventListener('click', () => {
        showPinScreenFor(user);
      });
      
      usersGrid.appendChild(card);
    });
  }
}

// PIN Entry logic state
let selectedUser = null;
let currentPinBuffer = '';

function showPinScreenFor(user) {
  selectedUser = user;
  currentPinBuffer = '';
  
  // Transition views
  document.getElementById('auth-users-selection').classList.add('hidden');
  const pinEntryDiv = document.getElementById('auth-pin-entry');
  pinEntryDiv.classList.remove('hidden');
  
  // Update display values
  document.getElementById('selected-user-name').textContent = user.username;
  document.getElementById('selected-user-avatar').textContent = user.username.substring(0, 2).toUpperCase();
  
  resetPinDots();
  
  // Focus hidden input for physical keyboard usage
  const hiddenInput = document.getElementById('pin-hidden-input');
  hiddenInput.value = '';
  hiddenInput.removeAttribute('readonly');
  hiddenInput.focus();
}

function resetPinEntry() {
  selectedUser = null;
  currentPinBuffer = '';
  resetPinDots();
  const hiddenInput = document.getElementById('pin-hidden-input');
  hiddenInput.value = '';
  hiddenInput.setAttribute('readonly', 'true');
}

function resetPinDots() {
  const dots = document.querySelectorAll('.pin-dot');
  dots.forEach(dot => dot.classList.remove('filled'));
}

function updatePinDots() {
  const dots = document.querySelectorAll('.pin-dot');
  dots.forEach((dot, index) => {
    if (index < currentPinBuffer.length) {
      dot.classList.add('filled');
    } else {
      dot.classList.remove('filled');
    }
  });
}

/**
 * Verifies the PIN buffer against the selected user
 */
async function verifyPinAttempt() {
  if (!selectedUser) return;
  
  const hash = await hashPin(selectedUser.username, currentPinBuffer);
  
  if (hash === selectedUser.pinHash) {
    // Correct! Log in
    loginAs(selectedUser);
  } else {
    // Incorrect! Shake and clear
    const pinDisplay = document.querySelector('.pin-display');
    pinDisplay.classList.add('shake-anim');
    
    // Add visual indicator of incorrect pin (red dots)
    const dots = document.querySelectorAll('.pin-dot');
    dots.forEach(dot => dot.style.borderColor = 'var(--danger)');
    
    ui.showToast('Falsche PIN. Bitte versuchen Sie es erneut.', 'danger');
    
    setTimeout(() => {
      currentPinBuffer = '';
      resetPinDots();
      pinDisplay.classList.remove('shake-anim');
      dots.forEach(dot => dot.removeAttribute('style'));
      
      const hiddenInput = document.getElementById('pin-hidden-input');
      hiddenInput.value = '';
    }, 600);
  }
}

/**
 * Appends a digit to the PIN buffer
 */
async function handlePinInput(char) {
  if (currentPinBuffer.length >= 6) return;
  if (!/^[0-9]$/.test(char)) return;
  
  currentPinBuffer += char;
  updatePinDots();
  
  // Auto-verify as soon as we have at least 4 digits
  if (currentPinBuffer.length >= 4) {
    // We check it. Since PINs can be 4, 5, or 6 digits, we compute hash.
    // If it matches, we log in immediately.
    const hash = await hashPin(selectedUser.username, currentPinBuffer);
    if (hash === selectedUser.pinHash) {
      verifyPinAttempt();
    } else if (currentPinBuffer.length === 6) {
      // If we hit maximum 6 digits and it didn't match, verify to trigger failure feedback
      verifyPinAttempt();
    }
  }
}

function handlePinBackspace() {
  if (currentPinBuffer.length > 0) {
    currentPinBuffer = currentPinBuffer.slice(0, -1);
    updatePinDots();
  }
}

/**
 * Initializes Authentication screen listeners
 */
export function initAuthListeners() {
  // Back to user list
  document.getElementById('auth-back-to-users').addEventListener('click', () => {
    resetPinEntry();
    renderUserSelection();
  });

  // Numeric keypad listeners
  const keys = document.querySelectorAll('.pin-key');
  keys.forEach(key => {
    key.addEventListener('click', () => {
      if (!selectedUser) return;
      const val = key.getAttribute('data-value');
      
      if (val === 'clear') {
        currentPinBuffer = '';
        updatePinDots();
        document.getElementById('pin-hidden-input').value = '';
      } else if (val === 'backspace') {
        handlePinBackspace();
        document.getElementById('pin-hidden-input').value = currentPinBuffer;
      } else {
        handlePinInput(val);
        document.getElementById('pin-hidden-input').value = currentPinBuffer;
      }
    });
  });

  // Physical keyboard support
  const hiddenInput = document.getElementById('pin-hidden-input');
  hiddenInput.addEventListener('input', (e) => {
    const val = e.target.value;
    if (val.length < currentPinBuffer.length) {
      handlePinBackspace();
    } else if (val.length > currentPinBuffer.length) {
      const char = val.charAt(val.length - 1);
      handlePinInput(char);
    }
  });

  // Refocus input if user clicks anywhere on the PIN entry card
  document.getElementById('auth-pin-entry').addEventListener('click', () => {
    if (selectedUser) {
      hiddenInput.focus();
    }
  });

  // Onboarding Form (create first user)
  document.getElementById('onboarding-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('onboard-username').value.trim();
    const pin = document.getElementById('onboard-pin').value;
    const pinConfirm = document.getElementById('onboard-pin-confirm').value;

    if (!username) {
      ui.showToast('Bitte geben Sie einen Benutzernamen ein.', 'warning');
      return;
    }

    if (pin.length < 4 || pin.length > 6) {
      ui.showToast('Die PIN muss zwischen 4 und 6 Ziffern lang sein.', 'warning');
      return;
    }

    if (pin !== pinConfirm) {
      ui.showToast('Die PIN-Bestätigung stimmt nicht überein.', 'warning');
      return;
    }

    ui.showLoader('Ersten Benutzer anlegen...');
    try {
      const hash = await hashPin(username, pin);
      const newUser = {
        id: `usr-${Date.now()}`,
        username: username,
        pinHash: hash
      };
      
      storage.setUsers([newUser]);
      await storage.forceSyncNow(); // immediate save
      
      ui.hideLoader();
      ui.showToast('Benutzer erfolgreich angelegt!', 'success');
      
      // Log in directly
      loginAs(newUser);
    } catch (err) {
      ui.hideLoader();
      ui.showToast(`Fehler beim Erstellen des Benutzers: ${err.message}`, 'danger');
    }
  });

  // Toggle repository connection views
  document.getElementById('auth-show-connect-btn').addEventListener('click', () => {
    document.getElementById('onboarding-welcome-view').classList.add('hidden');
    document.getElementById('onboarding-connect-view').classList.remove('hidden');
  });

  document.getElementById('auth-hide-connect-btn').addEventListener('click', () => {
    document.getElementById('onboarding-connect-view').classList.add('hidden');
    document.getElementById('onboarding-welcome-view').classList.remove('hidden');
  });

  // Connect existing repository form
  document.getElementById('onboarding-connect-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const token = document.getElementById('onboard-gh-token').value.trim();
    const repo = document.getElementById('onboard-gh-repo').value.trim();
    const branch = document.getElementById('onboard-gh-branch').value.trim() || 'main';
    const path = document.getElementById('onboard-gh-path').value.trim() || 'data.json';

    if (!token || !repo) {
      ui.showToast('GitHub Token und Repository sind erforderlich.', 'warning');
      return;
    }

    ui.showLoader('Verbindung mit GitHub wird hergestellt...');
    try {
      const github = await import('./github.js?v=1.1.0');
      const res = await github.testConnection({ token, repo, branch, path });

      // Save connection config
      github.saveConfig({ token, repo, branch, path });

      // Fetch database (loads users & appointments from GitHub)
      const db = await storage.initDatabase();

      ui.hideLoader();

      if (db.users && db.users.length > 0) {
        ui.showToast('Erfolgreich verbunden! Wählen Sie Ihren Benutzer aus.', 'success');
        // Reset view visibility within onboarding card
        document.getElementById('onboarding-connect-view').classList.add('hidden');
        document.getElementById('onboarding-welcome-view').classList.remove('hidden');
        // Transition back to user card grid screen
        renderUserSelection();
      } else {
        ui.showToast('Erfolgreich verbunden! Keine bestehenden Benutzer gefunden. Bitte legen Sie den ersten Benutzer an.', 'info');
        document.getElementById('onboarding-connect-view').classList.add('hidden');
        document.getElementById('onboarding-welcome-view').classList.remove('hidden');
      }
    } catch (err) {
      ui.hideLoader();
      ui.showToast(`Verbindungsfehler: ${err.message}`, 'danger');
    }
  });

  // Admin Create User Form
  document.getElementById('create-user-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('new-username').value.trim();
    const pin = document.getElementById('new-user-pin').value;
    const pinConfirm = document.getElementById('new-user-pin-confirm').value;

    if (!username) {
      ui.showToast('Benutzernamen eingeben.', 'warning');
      return;
    }

    // Check if user already exists
    const users = storage.getUsers();
    if (users.some(u => u.username.toLowerCase() === username.toLowerCase())) {
      ui.showToast('Ein Benutzer mit diesem Namen existiert bereits.', 'warning');
      return;
    }

    if (pin.length < 4 || pin.length > 6) {
      ui.showToast('Die PIN muss 4-6 Ziffern lang sein.', 'warning');
      return;
    }

    if (pin !== pinConfirm) {
      ui.showToast('Die PINs stimmen nicht überein.', 'warning');
      return;
    }

    ui.showLoader('Benutzer wird angelegt...');
    try {
      const hash = await hashPin(username, pin);
      const newUser = {
        id: `usr-${Date.now()}`,
        username: username,
        pinHash: hash
      };
      
      storage.setUsers([...users, newUser]);
      e.target.reset();
      
      ui.hideLoader();
      ui.showToast(`Benutzer ${username} wurde erfolgreich angelegt.`, 'success');
      renderUsersTable();
    } catch (err) {
      ui.hideLoader();
      ui.showToast('Fehler beim Erstellen.', 'danger');
    }
  });

  // Admin Change Own PIN Form
  document.getElementById('change-pin-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentUser) return;

    const currentPin = document.getElementById('current-pin').value;
    const newPin = document.getElementById('new-pin').value;
    const newPinConfirm = document.getElementById('new-pin-confirm').value;

    const verifyHash = await hashPin(currentUser.username, currentPin);
    if (verifyHash !== currentUser.pinHash) {
      ui.showToast('Die aktuelle PIN ist falsch.', 'danger');
      return;
    }

    if (newPin.length < 4 || newPin.length > 6) {
      ui.showToast('Die neue PIN muss 4-6 Ziffern enthalten.', 'warning');
      return;
    }

    if (newPin !== newPinConfirm) {
      ui.showToast('Die neuen PINs stimmen nicht überein.', 'warning');
      return;
    }

    ui.showLoader('PIN wird geändert...');
    try {
      const newHash = await hashPin(currentUser.username, newPin);
      
      const users = storage.getUsers();
      const updatedUsers = users.map(u => {
        if (u.id === currentUser.id) {
          u.pinHash = newHash;
          currentUser = u; // update in memory reference
        }
        return u;
      });

      storage.setUsers(updatedUsers);
      e.target.reset();
      
      ui.hideLoader();
      ui.showToast('Ihre PIN wurde erfolgreich geändert.', 'success');
    } catch (err) {
      ui.hideLoader();
      ui.showToast('Fehler beim Ändern der PIN.', 'danger');
    }
  });

  // Add key shake animation stylesheet styles
  const styleEl = document.createElement('style');
  styleEl.textContent = `
    @keyframes shake {
      0%, 100% { transform: translateX(0); }
      20%, 60% { transform: translateX(-6px); }
      40%, 80% { transform: translateX(6px); }
    }
    .shake-anim {
      animation: shake 0.3s cubic-bezier(.36,.07,.19,.97) both;
    }
  `;
  document.head.appendChild(styleEl);
}

/**
 * Render user administration table
 */
export function renderUsersTable() {
  const users = storage.getUsers();
  const tableBody = document.getElementById('users-table-body');
  tableBody.innerHTML = '';

  users.forEach(user => {
    const tr = document.createElement('tr');
    
    // User name
    const tdUser = document.createElement('td');
    tdUser.style.fontWeight = '600';
    tdUser.textContent = user.username;
    
    // Role / ID
    const tdRole = document.createElement('td');
    tdRole.className = 'text-muted-light';
    tdRole.textContent = user.id === currentUser?.id ? 'Aktueller Benutzer' : 'Benutzer';
    
    // Action
    const tdAction = document.createElement('td');
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn btn-danger btn-sm';
    deleteBtn.textContent = 'Löschen';
    
    // Cannot delete yourself
    if (user.id === currentUser?.id) {
      deleteBtn.disabled = true;
      deleteBtn.style.opacity = '0.5';
      deleteBtn.style.cursor = 'not-allowed';
    } else {
      deleteBtn.addEventListener('click', () => {
        if (confirm(`Möchten Sie den Benutzer "${user.username}" wirklich löschen?`)) {
          const updatedUsers = users.filter(u => u.id !== user.id);
          storage.setUsers(updatedUsers);
          ui.showToast(`Benutzer ${user.username} gelöscht.`, 'success');
          renderUsersTable();
        }
      });
    }
    
    tdAction.appendChild(deleteBtn);
    tr.appendChild(tdUser);
    tr.appendChild(tdRole);
    tr.appendChild(tdAction);
    tableBody.appendChild(tr);
  });
}
