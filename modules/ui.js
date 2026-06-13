/**
 * UI Controls, Modals, Forms and Settings Module
 * Manages view transitions, toasts, modals, inputs, and database import/export flows.
 */

import * as storage from './storage.js?v=1.1.9';
import * as calendar from './calendar.js?v=1.1.9';

// Global state for appointment modal
let activeEditingAppt = null; // Hold reference if editing
let recurrenceChoicePromise = null; // Resolves when recurrence dialog choice is made

function timeToMinutes(timeStr) {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Toast Notification System
 */
export function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  
  const text = document.createElement('span');
  text.textContent = message;
  
  const closeBtn = document.createElement('button');
  closeBtn.className = 'toast-close';
  closeBtn.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor">
      <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
    </svg>
  `;
  closeBtn.addEventListener('click', () => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 200);
  });
  
  toast.appendChild(text);
  toast.appendChild(closeBtn);
  container.appendChild(toast);
  
  // Auto dismiss after 3.5s
  setTimeout(() => {
    if (toast.parentNode) {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(-10px)';
      toast.style.transition = 'all 0.25s ease';
      setTimeout(() => toast.remove(), 250);
    }
  }, 3500);
}

/**
 * Global Loader Controls
 */
export function showLoader(text = 'Laden...') {
  document.getElementById('loader-text').textContent = text;
  document.getElementById('global-loader').classList.remove('hidden');
}

export function hideLoader() {
  document.getElementById('global-loader').classList.add('hidden');
}

/**
 * Page Section Navigation
 */
export function initNavListeners() {
  const navBtns = document.querySelectorAll('.nav-btn');
  const sections = document.querySelectorAll('.app-section');

  navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-target');
      
      // Update buttons
      navBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      // Update sections
      sections.forEach(sec => {
        if (sec.id === targetId) {
          sec.classList.add('active');
        } else {
          sec.classList.remove('active');
        }
      });

      // Special action on tab switch
      if (targetId === 'calendar-section') {
        calendar.renderCalendar();
      } else if (targetId === 'users-section') {
        // Import auth dynamically to render table without cyclic load bottlenecks
        import('./auth.js?v=1.1.9').then(auth => auth.renderUsersTable());
      } else if (targetId === 'settings-section') {
        renderSettingsTypesEditor();
        renderSettingsStudentsEditor();
        populateGitHubForm();
      }
    });
  });
}

/**
 * Populate type option selects and datalists in forms
 */
export function refreshFormSelects() {
  const types = storage.getAppointmentTypes();
  const select = document.getElementById('appt-type');
  
  // Save selected value to restore it
  const currentVal = select.value;
  select.innerHTML = '';
  
  types.forEach(type => {
    const opt = document.createElement('option');
    opt.value = type.id;
    opt.textContent = type.name;
    select.appendChild(opt);
  });

  // If the currently edited appointment has a deleted type, append it as a temporary option
  if (activeEditingAppt && !types.some(t => t.id === activeEditingAppt.type)) {
    const opt = document.createElement('option');
    opt.value = activeEditingAppt.type;
    opt.textContent = '(Gelöschte Terminart)';
    select.appendChild(opt);
  }
  
  if (currentVal) {
    select.value = currentVal;
  } else if (activeEditingAppt) {
    select.value = activeEditingAppt.type;
  }

  // Populate student code select
  const studentSelect = document.getElementById('appt-roster-code');
  const studentCodes = storage.getStudentCodes();
  const currentStudentVal = studentSelect.value;
  studentSelect.innerHTML = '';

  if (studentCodes.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '-- Keine Schülerkürzel vorhanden --';
    studentSelect.appendChild(opt);
  } else {
    studentCodes.forEach(code => {
      const opt = document.createElement('option');
      opt.value = code;
      opt.textContent = code;
      studentSelect.appendChild(opt);
    });
  }

  // If the currently edited appointment has initials not present in the current student codes,
  // append it as a temporary option so it doesn't get lost
  if (activeEditingAppt && activeEditingAppt.rosterCode && !studentCodes.includes(activeEditingAppt.rosterCode)) {
    const opt = document.createElement('option');
    opt.value = activeEditingAppt.rosterCode;
    opt.textContent = `${activeEditingAppt.rosterCode} (Inaktiv/Alt)`;
    studentSelect.appendChild(opt);
  }

  if (currentStudentVal && (studentCodes.some(s => s.code === currentStudentVal) || (activeEditingAppt && activeEditingAppt.rosterCode === currentStudentVal))) {
    studentSelect.value = currentStudentVal;
  } else if (activeEditingAppt && activeEditingAppt.rosterCode) {
    studentSelect.value = activeEditingAppt.rosterCode;
  }
}

/**
 * Populate GitHub settings form from active config
 */
function populateGitHubForm() {
  import('./github.js?v=1.1.9').then(github => {
    const cfg = github.getConfig();
    const tokenEl = document.getElementById('gh-token');
    const repoEl = document.getElementById('gh-repo');
    const branchEl = document.getElementById('gh-branch');
    const pathEl = document.getElementById('gh-path');
    
    if (tokenEl) tokenEl.value = cfg.token || '';
    if (repoEl) repoEl.value = cfg.repo || '';
    if (branchEl) branchEl.value = cfg.branch || 'main';
    if (pathEl) pathEl.value = cfg.path || 'data.json';

    // Show/hide copy share link section based on active configuration
    const shareWrapper = document.getElementById('gh-share-wrapper');
    if (shareWrapper) {
      if (github.isConfigured()) {
        shareWrapper.classList.remove('hidden');
      } else {
        shareWrapper.classList.add('hidden');
      }
    }
  });
}

/**
 * Renders the editable list of categories/colors in Settings
 */
/**
 * Creates a DOM row for editing an appointment type, including name, color and a delete button
 */
function createTypeSettingRow(type) {
  const row = document.createElement('div');
  row.className = 'type-setting-row';

  const inputName = document.createElement('input');
  inputName.type = 'text';
  inputName.value = type.name;
  inputName.className = 'type-name-input';
  inputName.dataset.id = type.id;
  inputName.placeholder = 'z.B. Bereitschaft';

  const colorPickerWrapper = document.createElement('div');
  colorPickerWrapper.className = 'type-color-picker';

  const picker = document.createElement('input');
  picker.type = 'color';
  picker.value = type.color;
  picker.className = 'type-color-input';
  picker.dataset.id = type.id;

  colorPickerWrapper.appendChild(picker);
  row.appendChild(inputName);
  row.appendChild(colorPickerWrapper);

  // Delete button
  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'btn-icon btn-delete-type';
  deleteBtn.style.color = 'var(--danger)';
  deleteBtn.title = 'Terminart löschen';
  deleteBtn.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" style="width: 18px; height: 18px;">
      <polyline points="3 6 5 6 21 6"></polyline>
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
      <line x1="10" y1="11" x2="10" y2="17"></line>
      <line x1="14" y1="11" x2="14" y2="17"></line>
    </svg>
  `;
  deleteBtn.addEventListener('click', () => {
    row.remove();
  });
  row.appendChild(deleteBtn);

  return row;
}

/**
 * Renders the editable list of categories/colors in Settings
 */
function renderSettingsTypesEditor() {
  const types = storage.getAppointmentTypes();
  const container = document.getElementById('settings-types-list');
  container.innerHTML = '';

  types.forEach(type => {
    const row = createTypeSettingRow(type);
    container.appendChild(row);
  });
}

/**
 * Prompts user with "This instance only" vs "Whole series" modal
 */
function promptRecurrenceChoice(dateStr) {
  const modal = document.getElementById('recurrence-choice-modal');
  modal.classList.add('active');
  
  // Format Date for display
  const d = new Date(dateStr + 'T00:00:00');
  document.getElementById('recur-choice-date').textContent = d.toLocaleDateString('de-DE');

  return new Promise((resolve) => {
    recurrenceChoicePromise = resolve;
  });
}

function closeRecurrenceChoiceModal() {
  document.getElementById('recurrence-choice-modal').classList.remove('active');
  recurrenceChoicePromise = null;
}

/**
 * Opens Appointment Modal for creation
 */
export function openAppointmentModalForCreate(dateStr, startTime = '08:00', endTime = '16:00', preselectedStudentCode = '') {
  activeEditingAppt = null;
  
  document.getElementById('modal-title').textContent = 'Termin erstellen';
  document.getElementById('appointment-id').value = '';
  document.getElementById('appointment-series-id').value = '';
  
  // Defaults
  document.getElementById('appt-title').value = '';
  document.getElementById('appt-date').value = dateStr;
  
  // End date default same day
  const apptEndDateInput = document.getElementById('appt-end-date');
  apptEndDateInput.value = dateStr;

  document.getElementById('appt-start-time').value = startTime;
  document.getElementById('appt-end-time').value = endTime;
  
  refreshFormSelects();

  if (preselectedStudentCode) {
    document.getElementById('appt-roster-code').value = preselectedStudentCode;
  } else {
    document.getElementById('appt-roster-code').value = '';
  }
  
  // Default color radio selection
  document.querySelector('input[name="appt-color"][value="default"]').checked = true;
  document.getElementById('appt-color-custom-radio').checked = false;

  // Recurrence defaults
  const recurCheckbox = document.getElementById('appt-is-recurring');
  recurCheckbox.checked = false;
  
  const recurDetails = document.getElementById('recurrence-details');
  recurDetails.classList.add('hidden-slide');

  // Hide delete button
  document.getElementById('appt-delete-btn').classList.add('hidden');

  // Open modal
  document.getElementById('appointment-modal').classList.add('active');
}

/**
 * Opens Appointment Modal to edit existing
 */
export function openAppointmentModalForEdit(appt) {
  activeEditingAppt = appt;
  
  document.getElementById('modal-title').textContent = 'Termin bearbeiten';
  document.getElementById('appointment-id').value = appt.id;
  document.getElementById('appointment-series-id').value = appt.seriesId || '';
  
  document.getElementById('appt-title').value = appt.title;
  document.getElementById('appt-date').value = appt.date;
  document.getElementById('appt-end-date').value = appt.endDate || appt.date;
  
  document.getElementById('appt-start-time').value = appt.startTime;
  document.getElementById('appt-end-time').value = appt.endTime;
  document.getElementById('appt-roster-code').value = appt.rosterCode;
  
  refreshFormSelects();
  document.getElementById('appt-type').value = appt.type;

  // Color selection
  const colorRadios = document.querySelectorAll('input[name="appt-color"]');
  let matchedColor = false;

  colorRadios.forEach(radio => {
    if (radio.value === appt.color) {
      radio.checked = true;
      matchedColor = true;
    }
  });

  if (!appt.color) {
    document.querySelector('input[name="appt-color"][value="default"]').checked = true;
  } else if (!matchedColor) {
    // Custom color
    document.getElementById('appt-color-custom-radio').checked = true;
    document.getElementById('appt-color-custom-input').value = appt.color;
    document.querySelector('.custom-color-display').style.backgroundColor = appt.color;
  }

  // Recurrence
  const recurCheckbox = document.getElementById('appt-is-recurring');
  const recurDetails = document.getElementById('recurrence-details');
  const apptEndDateInput = document.getElementById('appt-end-date');
  const apptEndDateWrapper = document.getElementById('appt-end-date-wrapper');

  if (appt.recurrence && appt.recurrence.frequency !== 'none') {
    recurCheckbox.checked = true;
    recurDetails.classList.remove('hidden-slide');
    apptEndDateWrapper.classList.remove('hidden');
    
    // Set series values
    document.getElementById('recur-frequency').value = appt.recurrence.frequency;
    document.getElementById('recur-interval').value = appt.recurrence.interval || 1;
    
    // Series end date
    document.getElementById('recur-end-date').value = appt.recurrence.endDate || '';
    
    // Appt end date limit (duration offset of series)
    apptEndDateInput.value = appt.date; // root date
    
    // Populate weekly days if applicable
    const dayPills = document.querySelectorAll('.weekdays-selector input');
    dayPills.forEach(pill => {
      const val = parseInt(pill.value);
      pill.checked = appt.recurrence.daysOfWeek && appt.recurrence.daysOfWeek.includes(val);
    });
    
    document.getElementById('recur-days-weekly').style.display = appt.recurrence.frequency === 'weekly' ? 'block' : 'none';
  } else {
    recurCheckbox.checked = false;
    recurDetails.classList.add('hidden-slide');
    apptEndDateInput.value = appt.endDate || appt.date;
  }

  // Show delete button
  document.getElementById('appt-delete-btn').classList.remove('hidden');

  // Open modal
  document.getElementById('appointment-modal').classList.add('active');
}

function closeAppointmentModal() {
  document.getElementById('appointment-modal').classList.remove('active');
  activeEditingAppt = null;
}

/**
 * Initializes All Modal/Form event listeners
 */
export function initUIListeners() {
  // Navigation
  initNavListeners();


  document.getElementById('clear-student-filters').addEventListener('click', (e) => {
    e.stopPropagation();
    calendar.resetAllFilters();
  });
  document.getElementById('clear-type-filters').addEventListener('click', (e) => {
    e.stopPropagation();
    calendar.resetAllFilters();
  });

  // View mode switcher listener
  const viewRadios = document.querySelectorAll('input[name="calendar-view-mode"]');
  viewRadios.forEach(radio => {
    radio.addEventListener('change', (e) => {
      const mode = e.target.value;
      const customInputs = document.getElementById('custom-date-inputs');
      
      if (mode === 'custom') {
        customInputs.classList.remove('hidden-slide');
      } else {
        customInputs.classList.add('hidden-slide');
        calendar.setViewMode(mode);
      }
    });
  });

  // Apply custom date range
  document.getElementById('apply-custom-range').addEventListener('click', () => {
    const start = document.getElementById('custom-start-date').value;
    const end = document.getElementById('custom-end-date').value;
    
    if (!start || !end) {
      showToast('Bitte wählen Sie Start- und Enddatum aus.', 'warning');
      return;
    }
    
    if (new Date(start) > new Date(end)) {
      showToast('Das Startdatum darf nicht nach dem Enddatum liegen.', 'warning');
      return;
    }

    calendar.setCustomRange(start, end);
  });

  // Prev / Next / Today
  document.getElementById('cal-prev').addEventListener('click', () => calendar.shiftDate(-1));
  document.getElementById('cal-next').addEventListener('click', () => calendar.shiftDate(1));
  document.getElementById('cal-today').addEventListener('click', () => calendar.setDate(new Date()));

  // PDF / Drucken
  const exportPdfBtn = document.getElementById('export-pdf-btn');
  if (exportPdfBtn) {
    exportPdfBtn.addEventListener('click', () => {
      window.print();
    });
  }

  // Toggle Filters Drawer on Mobile
  const toggleFiltersBtn = document.getElementById('toggle-filters-btn');
  const closeFiltersBtn = document.getElementById('close-filters-btn');
  const sidebarFilters = document.getElementById('sidebar-filters');
  const drawerOverlay = document.getElementById('drawer-overlay');

  if (toggleFiltersBtn && sidebarFilters && drawerOverlay) {
    toggleFiltersBtn.addEventListener('click', () => {
      sidebarFilters.classList.add('active');
      drawerOverlay.classList.add('active');
    });
  }

  if (closeFiltersBtn && sidebarFilters && drawerOverlay) {
    closeFiltersBtn.addEventListener('click', () => {
      sidebarFilters.classList.remove('active');
      drawerOverlay.classList.remove('active');
    });
  }

  if (drawerOverlay && sidebarFilters) {
    drawerOverlay.addEventListener('click', () => {
      sidebarFilters.classList.remove('active');
      drawerOverlay.classList.remove('active');
    });
  }

  // Create Button clicks
  document.getElementById('add-appointment-btn').addEventListener('click', () => {
    const todayStr = calendar.formatDateString(new Date());
    openAppointmentModalForCreate(todayStr);
  });

  // Close Modals
  document.getElementById('modal-close').addEventListener('click', closeAppointmentModal);
  document.getElementById('appt-cancel-btn').addEventListener('click', closeAppointmentModal);

  // Custom color input visual synchronization
  const customColorInput = document.getElementById('appt-color-custom-input');
  customColorInput.addEventListener('input', (e) => {
    document.getElementById('appt-color-custom-radio').checked = true;
    document.querySelector('.custom-color-display').style.backgroundColor = e.target.value;
  });

  // Toggle recurrence section visibility
  const recurCheckbox = document.getElementById('appt-is-recurring');
  recurCheckbox.addEventListener('change', (e) => {
    const recurDetails = document.getElementById('recurrence-details');
    const apptEndDateWrapper = document.getElementById('appt-end-date-wrapper');
    
    if (e.target.checked) {
      recurDetails.classList.remove('hidden-slide');
      apptEndDateWrapper.classList.remove('hidden');
      document.getElementById('recur-days-weekly').style.display = 
        document.getElementById('recur-frequency').value === 'weekly' ? 'block' : 'none';
    } else {
      recurDetails.classList.add('hidden-slide');
      apptEndDateWrapper.classList.add('hidden');
    }
  });

  // Toggle recurrence days-of-week based on frequency
  document.getElementById('recur-frequency').addEventListener('change', (e) => {
    document.getElementById('recur-days-weekly').style.display = e.target.value === 'weekly' ? 'block' : 'none';
  });

  // --- Appointment Form Submit Handler ---
  document.getElementById('appointment-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const title = document.getElementById('appt-title').value.trim();
    const date = document.getElementById('appt-date').value;
    const endDate = document.getElementById('appt-end-date').value || date;
    const startTime = document.getElementById('appt-start-time').value;
    const endTime = document.getElementById('appt-end-time').value;
    const rosterCode = document.getElementById('appt-roster-code').value.trim().toUpperCase();
    const type = document.getElementById('appt-type').value;

    if (new Date(endDate + 'T00:00:00') < new Date(date + 'T00:00:00')) {
      showToast('Das Enddatum darf nicht vor dem Startdatum liegen.', 'warning');
      return;
    }

    if (timeToMinutes(startTime) >= timeToMinutes(endTime)) {
      showToast('Die Endzeit muss nach der Anfangszeit liegen.', 'warning');
      return;
    }

    // Color picker resolution
    const colorRadio = document.querySelector('input[name="appt-color"]:checked').value;
    const color = colorRadio === 'default' ? '' : (colorRadio === 'custom' ? customColorInput.value : colorRadio);

    // Recurrence resolution
    const isRec = recurCheckbox.checked;
    let recurrence = null;
    
    if (isRec) {
      const frequency = document.getElementById('recur-frequency').value;
      const interval = parseInt(document.getElementById('recur-interval').value) || 1;
      const endDate = document.getElementById('recur-end-date').value || null;
      
      let daysOfWeek = [];
      if (frequency === 'weekly') {
        const checkedDays = document.querySelectorAll('.weekdays-selector input:checked');
        checkedDays.forEach(cb => daysOfWeek.push(parseInt(cb.value)));
        
        if (daysOfWeek.length === 0) {
          showToast('Bitte wählen Sie mindestens einen Wochentag aus.', 'warning');
          return;
        }
      }

      recurrence = { frequency, interval, daysOfWeek, endDate };
    }

    const appts = storage.getAppointments();

    // Determine Action: CREATE vs EDIT
    if (!activeEditingAppt) {
      // CREATE NEW
      const newAppt = {
        id: `evt-${Date.now()}`,
        title, date, endDate, startTime, endTime, rosterCode, type, color,
        seriesId: isRec ? `ser-${Date.now()}` : null,
        recurrence,
        exceptions: []
      };

      storage.setAppointments([...appts, newAppt]);
      showToast('Termin erfolgreich erstellt.', 'success');
      closeAppointmentModal();
      calendar.renderCalendar();
      
    } else {
      // EDIT EXISTING
      const isSeries = activeEditingAppt.seriesId && activeEditingAppt.recurrence && activeEditingAppt.recurrence.frequency !== 'none';
      
      if (isSeries) {
        // Prompt series choice: single vs all
        const choice = await promptRecurrenceChoice(activeEditingAppt.instanceDate);
        closeRecurrenceChoiceModal();

        if (!choice) return; // Cancelled

        if (choice === 'single') {
          // 1. Add exception date to the original series object
          const updated = appts.map(appt => {
            if (appt.id === activeEditingAppt.originalId) {
              const exceptions = appt.exceptions || [];
              if (!exceptions.includes(activeEditingAppt.instanceDate)) {
                exceptions.push(activeEditingAppt.instanceDate);
              }
              appt.exceptions = exceptions;
            }
            return appt;
          });

          // 2. Create a new standalone appointment for that date with modified details
          const detachedAppt = {
            id: `evt-${Date.now()}`,
            title,
            date: activeEditingAppt.instanceDate, // on this specific occurrence date
            startTime, endTime, rosterCode, type, color,
            seriesId: activeEditingAppt.seriesId, // keep series reference but no recurrence
            recurrence: null,
            exceptions: []
          };

          storage.setAppointments([...updated, detachedAppt]);
          showToast('Dieser Termin wurde aus der Serie gelöst und geändert.', 'success');

        } else if (choice === 'all') {
          // Update the parent series object itself
          const updated = appts.map(appt => {
            if (appt.id === activeEditingAppt.originalId) {
              // Keep original ID and original start date, update details
              appt.title = title;
              appt.date = date; // moving start of series is allowed
              appt.startTime = startTime;
              appt.endTime = endTime;
              appt.rosterCode = rosterCode;
              appt.type = type;
              appt.color = color;
              appt.recurrence = recurrence;
              // If recurrence rules changed, might want to reset exceptions, let's keep it simple
            }
            return appt;
          });

          storage.setAppointments(updated);
          showToast('Die gesamte Terminserie wurde aktualisiert.', 'success');
        }
        
      } else {
        // Normal single appointment edit
        const updated = appts.map(appt => {
          if (appt.id === activeEditingAppt.id) {
            appt.title = title;
            appt.date = date;
            appt.endDate = endDate;
            appt.startTime = startTime;
            appt.endTime = endTime;
            appt.rosterCode = rosterCode;
            appt.type = type;
            appt.color = color;
            appt.recurrence = recurrence;
            appt.seriesId = isRec ? (appt.seriesId || `ser-${Date.now()}`) : null;
          }
          return appt;
        });

        storage.setAppointments(updated);
        showToast('Termin aktualisiert.', 'success');
      }

      closeAppointmentModal();
      calendar.renderCalendar();
    }
  });

  // --- Appointment Delete Button Handler ---
  document.getElementById('appt-delete-btn').addEventListener('click', async () => {
    if (!activeEditingAppt) return;
    
    const appts = storage.getAppointments();
    const isSeries = activeEditingAppt.seriesId && activeEditingAppt.recurrence && activeEditingAppt.recurrence.frequency !== 'none';

    if (isSeries) {
      // Choice prompt
      const choice = await promptRecurrenceChoice(activeEditingAppt.instanceDate);
      closeRecurrenceChoiceModal();

      if (!choice) return; // cancelled

      if (choice === 'single') {
        // Add exception to series
        const updated = appts.map(appt => {
          if (appt.id === activeEditingAppt.originalId) {
            const exceptions = appt.exceptions || [];
            if (!exceptions.includes(activeEditingAppt.instanceDate)) {
              exceptions.push(activeEditingAppt.instanceDate);
            }
            appt.exceptions = exceptions;
          }
          return appt;
        });

        storage.setAppointments(updated);
        showToast('Dieser Termin wurde aus der Serie gelöscht.', 'success');

      } else if (choice === 'all') {
        // Delete the parent series template fully
        const updated = appts.filter(appt => appt.id !== activeEditingAppt.originalId);
        storage.setAppointments(updated);
        showToast('Die gesamte Terminserie wurde gelöscht.', 'success');
      }

    } else {
      // Normal single appointment delete
      if (confirm('Möchten Sie diesen Termin wirklich löschen?')) {
        const updated = appts.filter(appt => appt.id !== activeEditingAppt.id);
        storage.setAppointments(updated);
        showToast('Termin gelöscht.', 'success');
      } else {
        return; // aborted
      }
    }

    closeAppointmentModal();
    calendar.renderCalendar();
  });

  // Recurrence choice modal clicks resolvers
  document.getElementById('recur-choice-single').addEventListener('click', () => {
    if (recurrenceChoicePromise) recurrenceChoicePromise('single');
  });
  document.getElementById('recur-choice-all').addEventListener('click', () => {
    if (recurrenceChoicePromise) recurrenceChoicePromise('all');
  });
  document.getElementById('recur-choice-cancel').addEventListener('click', () => {
    if (recurrenceChoicePromise) recurrenceChoicePromise(null);
    closeRecurrenceChoiceModal();
  });

  // --- settings view - Categories/Colors Form Submit ---
  document.getElementById('save-types-btn').addEventListener('click', async () => {
    const oldTypes = storage.getAppointmentTypes();
    const names = document.querySelectorAll('.type-name-input');
    const colors = document.querySelectorAll('.type-color-input');
    
    const updatedTypes = [];
    names.forEach((nameEl, index) => {
      const id = nameEl.dataset.id;
      const name = nameEl.value.trim();
      const color = colors[index].value;
      
      if (name) {
        updatedTypes.push({ id, name, color });
      }
    });

    if (updatedTypes.length === 0) {
      showToast('Kategorien dürfen nicht leer sein.', 'warning');
      return;
    }

    // Find deleted types
    const deletedTypes = oldTypes.filter(oldT => !updatedTypes.some(newT => newT.id === oldT.id));
    
    if (deletedTypes.length > 0) {
      const appts = storage.getAppointments();
      let migratedCount = 0;
      
      const updatedAppts = appts.map(appt => {
        const matchingDeletedType = deletedTypes.find(dt => dt.id === appt.type);
        if (matchingDeletedType) {
          // Bake the deleted type's color directly into the appointment to preserve it
          if (!appt.color) {
            appt.color = matchingDeletedType.color;
          }
          migratedCount++;
        }
        return appt;
      });
      
      if (migratedCount > 0) {
        storage.setAppointments(updatedAppts);
        // Toast will be shown after the main success message
      }
    }

    showLoader('Terminarten werden auf GitHub gespeichert...');
    try {
      storage.setAppointmentTypes(updatedTypes);
      await storage.forceSyncNow();
      hideLoader();
      showToast('Kategorien und Farben erfolgreich gespeichert!', 'success');
    } catch (err) {
      hideLoader();
      showToast(`GitHub-Speicherfehler: ${err.message}`, 'danger');
    }

    refreshFormSelects();
    calendar.renderCalendar();
  });

  // --- settings view - Add new category row ---
  document.getElementById('add-type-btn').addEventListener('click', () => {
    const container = document.getElementById('settings-types-list');
    const newType = {
      id: `type-${Date.now()}`,
      name: '',
      color: '#3b82f6'
    };
    const row = createTypeSettingRow(newType);
    container.appendChild(row);
    row.querySelector('.type-name-input').focus();
  });

  // --- settings view - Add new student code row ---
  document.getElementById('add-student-btn').addEventListener('click', () => {
    const container = document.getElementById('settings-students-list');
    const row = createStudentSettingRow('');
    container.appendChild(row);
    row.querySelector('input').focus();
  });

  // --- settings view - Save student codes ---
  document.getElementById('save-students-btn').addEventListener('click', async () => {
    const inputs = document.querySelectorAll('.student-code-input');
    const updatedCodes = [];
    inputs.forEach(input => {
      const val = input.value.trim().toUpperCase();
      if (val && !updatedCodes.includes(val)) {
        updatedCodes.push(val);
      }
    });

    showLoader('Schülerkürzel werden auf GitHub gespeichert...');
    try {
      storage.setStudentCodes(updatedCodes);
      await storage.forceSyncNow();
      hideLoader();
      showToast('Schülerkürzel erfolgreich gespeichert!', 'success');
    } catch (err) {
      hideLoader();
      showToast(`GitHub-Speicherfehler: ${err.message}`, 'danger');
    }

    refreshFormSelects();
    calendar.renderStudentFilterList();
    calendar.renderRosterFilterList();
    calendar.renderCalendar();
  });

  // --- settings view - GitHub Form Submit ---
  const githubForm = document.getElementById('github-settings-form');
  if (githubForm) {
    githubForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const token = document.getElementById('gh-token').value.trim();
      const repo = document.getElementById('gh-repo').value.trim();
      const branch = document.getElementById('gh-branch').value.trim();
      const path = document.getElementById('gh-path').value.trim();

      if (!token || !repo) {
        showToast('GitHub Token und Repository sind erforderlich.', 'warning');
        return;
      }

      import('./github.js?v=1.1.9').then(async (github) => {
        showLoader('Verbindung mit GitHub wird geprüft...');
        try {
          const res = await github.testConnection({ token, repo, branch, path });
          
          // Save
          github.saveConfig({ token, repo, branch, path });
          
          hideLoader();
          showToast('Erfolgreich mit GitHub verbunden und konfiguriert!', 'success');
          
          // Trigger sync
          showLoader('Daten mit GitHub synchronisieren...');
          await storage.initDatabase();
          hideLoader();
          
          calendar.renderCalendar();
        } catch (err) {
          hideLoader();
          showToast(`GitHub-Verbindungsfehler: ${err.message}`, 'danger');
        }
      });
    });
  }

  // GitHub settings - Test Connection Button
  const ghTestBtn = document.getElementById('gh-test-btn');
  if (ghTestBtn) {
    ghTestBtn.addEventListener('click', () => {
      const token = document.getElementById('gh-token').value.trim();
      const repo = document.getElementById('gh-repo').value.trim();
      const branch = document.getElementById('gh-branch').value.trim();
      const path = document.getElementById('gh-path').value.trim();

      if (!token || !repo) {
        showToast('Bitte Token und Repo ausfüllen zum Testen.', 'warning');
        return;
      }

      import('./github.js?v=1.1.9').then(async (github) => {
        showLoader('Prüfe GitHub Verbindung...');
        try {
          const res = await github.testConnection({ token, repo, branch, path });
          hideLoader();
          if (res.fileExists) {
            showToast('Erfolgreich! Die Datei "data.json" existiert bereits im Repository.', 'success');
          } else {
            showToast('Erfolgreich! Die Verbindung steht. "data.json" wird beim ersten Speichern erstellt.', 'info');
          }
        } catch (err) {
          hideLoader();
          showToast(`Test fehlgeschlagen: ${err.message}`, 'danger');
        }
      });
    });
  }

  // --- Manual JSON Data Export ---
  document.getElementById('export-json-btn').addEventListener('click', () => {
    const dbData = storage.getDatabase();
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(dbData, null, 2));
    
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `ausbildungskalender_backup_${calendar.formatDateString(new Date())}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    
    showToast('JSON Backup heruntergeladen.', 'success');
  });

  // --- Manual JSON Data Import ---
  const fileInput = document.getElementById('import-json-file');
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const json = JSON.parse(evt.target.result);
        
        if (confirm('Möchten Sie diese JSON-Datei wirklich importieren? Alle aktuellen Termine und Benutzer werden überschrieben!')) {
          showLoader('Importiere Backup...');
          storage.importDatabase(json);
          
          // Force immediate push to GitHub if active
          await storage.forceSyncNow();
          
          hideLoader();
          showToast('Backup erfolgreich importiert!', 'success');
          
          // Re-render
          calendar.renderCalendar();
          refreshFormSelects();
          
          // Re-populate settings type editor list if current view is settings
          const activeNavBtn = document.querySelector('.nav-btn.active');
          if (activeNavBtn && activeNavBtn.getAttribute('data-target') === 'settings-section') {
            renderSettingsTypesEditor();
            renderSettingsStudentsEditor();
          }
        }
      } catch (err) {
        hideLoader();
        showToast(`Fehler beim Einlesen: ${err.message}`, 'danger');
      }
    };
    reader.readAsText(file);
    // Clear value to allow re-uploading same file
    fileInput.value = '';
  });

  // Lock Button in Header
  document.getElementById('lock-btn').addEventListener('click', () => {
    import('./auth.js?v=1.1.9').then(auth => auth.lockApp());
  });

  // GitHub settings - Copy share link
  const copyLinkBtn = document.getElementById('gh-copy-link-btn');
  if (copyLinkBtn) {
    copyLinkBtn.addEventListener('click', () => {
      import('./github.js?v=1.1.9').then(github => {
        const cfg = github.getConfig();
        if (!github.isConfigured()) {
          showToast('Bitte konfigurieren und speichern Sie zuerst die GitHub-Verbindung.', 'warning');
          return;
        }
        
        const shareUrl = `${window.location.protocol}//${window.location.host}/?gh_token=${encodeURIComponent(cfg.token)}&gh_repo=${encodeURIComponent(cfg.repo)}&gh_branch=${encodeURIComponent(cfg.branch)}&gh_path=${encodeURIComponent(cfg.path)}`;
        
        navigator.clipboard.writeText(shareUrl)
          .then(() => {
            showToast('Zugriffs-Link in die Zwischenablage kopiert! Senden Sie diesen Link an Ihre Teammitglieder.', 'success');
          })
          .catch(err => {
            showToast('Kopieren fehlgeschlagen. Bitte kopieren Sie den Link manuell.', 'danger');
          });
      });
    });
  }

  // Adjust filter open states on viewport size changes
  adjustFiltersForMobile();
  window.addEventListener('resize', adjustFiltersForMobile);
}

function adjustFiltersForMobile() {
  const isMobile = window.innerWidth <= 768;
  const filterBlocks = document.querySelectorAll('.sidebar-filters details.sidebar-block');
  filterBlocks.forEach(block => {
    if (isMobile) {
      block.removeAttribute('open');
    } else {
      block.setAttribute('open', '');
    }
  });
}

function createStudentSettingRow(student) {
  const code = typeof student === 'string' ? student : (student?.code || '');

  const row = document.createElement('div');
  row.className = 'student-setting-row';

  const inputName = document.createElement('input');
  inputName.type = 'text';
  inputName.value = code;
  inputName.className = 'student-code-input';
  inputName.placeholder = 'z.B. AB';
  row.appendChild(inputName);

  // Delete button
  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'btn-icon btn-delete-type';
  deleteBtn.style.color = 'var(--danger)';
  deleteBtn.title = 'Schülerkürzel - Eintrag löschen';
  deleteBtn.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" style="width: 18px; height: 18px;">
      <polyline points="3 6 5 6 21 6"></polyline>
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
      <line x1="10" y1="11" x2="10" y2="17"></line>
      <line x1="14" y1="11" x2="14" y2="17"></line>
    </svg>
  `;
  deleteBtn.addEventListener('click', () => {
    row.remove();
  });
  row.appendChild(deleteBtn);

  return row;
}

export function renderSettingsStudentsEditor() {
  const codes = storage.getStudentCodes();
  const container = document.getElementById('settings-students-list');
  if (!container) return;
  container.innerHTML = '';

  codes.forEach(student => {
    const row = createStudentSettingRow(student);
    container.appendChild(row);
  });
}

export { promptRecurrenceChoice };
