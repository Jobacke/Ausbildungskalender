/**
 * Calendar Layout and Rendering Module
 * Manages view states, ranges, date logic, recurring series expansion, and overlapping layout algorithms.
 */

import * as storage from './storage.js?v=1.1.8';
import * as ui from './ui.js?v=1.1.8';

// Calendar view state
let viewMode = 'week'; // 'day', 'week', 'month', 'custom'
let currentDate = new Date();
let customStartDate = '';
let customEndDate = '';

// Active filters state
let activeRosterFilters = new Set();
let activeTypeFilters = new Set();
let rosterSearchQuery = '';

/**
 * Resolves the color of an event, falling back to the appointment type color if no custom color is defined
 */
export function getEventColor(evt) {
  const types = storage.getAppointmentTypes();
  const typeObj = types.find(t => t.id === evt.type);
  return typeObj ? typeObj.color : 'var(--primary)';
}

export function getViewMode() { return viewMode; }
export function getCurrentDate() { return currentDate; }

export function setViewMode(mode) { 
  viewMode = mode; 
  renderCalendar();
}

export function setDate(date) {
  currentDate = date;
  renderCalendar();
}

export function shiftDate(direction) {
  if (viewMode === 'day') {
    currentDate.setDate(currentDate.getDate() + direction);
  } else if (viewMode === 'week') {
    currentDate.setDate(currentDate.getDate() + (direction * 7));
  } else if (viewMode === 'month') {
    currentDate.setMonth(currentDate.getMonth() + direction);
  }
  renderCalendar();
}

export function setCustomRange(start, end) {
  customStartDate = start;
  customEndDate = end;
  viewMode = 'custom';
  renderCalendar();
}

// Filter controls
export function toggleRosterFilter(code, isChecked) {
  if (isChecked) activeRosterFilters.add(code);
  else activeRosterFilters.delete(code);
  renderCalendar();
}

export function toggleTypeFilter(type, isChecked) {
  if (isChecked) activeTypeFilters.add(type);
  else activeTypeFilters.delete(type);
  renderCalendar();
}

export function setRosterSearch(query) {
  rosterSearchQuery = query.toLowerCase();
  renderRosterFilterList(); // re-filter the sidebar checklist
  renderStudentFilterList();
  renderCalendar();
}

export function resetAllFilters() {
  activeRosterFilters.clear();
  activeTypeFilters.clear();
  rosterSearchQuery = '';
  
  const rosterSearchEl = document.getElementById('roster-search');
  if (rosterSearchEl) rosterSearchEl.value = '';
  
  // Refresh sidebars
  renderRosterFilterList();
  renderStudentFilterList();
  renderTypeFilterList();
  
  renderCalendar();
}

/**
 * ISO 8601 Week Number helper
 */
export function getWeekNumber(d) {
  const dateCopy = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  dateCopy.setUTCDate(dateCopy.getUTCDate() + 4 - (dateCopy.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(dateCopy.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((dateCopy - yearStart) / 86400000) + 1) / 7);
  return weekNo;
}

/**
 * Format Date to YYYY-MM-DD (local time)
 */
export function formatDateString(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Helper to parse time string into minutes from midnight
 */
function timeToMinutes(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  return (h * 60) + m;
}

/**
 * Format minutes back to HH:MM
 */
function minutesToTime(mins) {
  const h = String(Math.floor(mins / 60)).padStart(2, '0');
  const m = String(mins % 60).padStart(2, '0');
  return `${h}:${m}`;
}

/**
 * Recurrence Engine: Expands series templates into single occurrence objects for a date range.
 */
export function getExpandedAppointments(rangeStartStr, rangeEndStr) {
  const appointments = storage.getAppointments();
  const expanded = [];
  
  const rangeStart = new Date(rangeStartStr + 'T00:00:00');
  const rangeEnd = new Date(rangeEndStr + 'T23:59:59');

  appointments.forEach(appt => {
    // If NOT recurring
    if (!appt.recurrence || appt.recurrence.frequency === 'none') {
      if (appt.endDate && appt.endDate !== appt.date) {
        const start = new Date(appt.date + 'T00:00:00');
        const end = new Date(appt.endDate + 'T23:59:59');
        
        const loopStart = new Date(Math.max(start.getTime(), rangeStart.getTime()));
        const loopEnd = new Date(Math.min(end.getTime(), rangeEnd.getTime()));
        
        if (loopStart <= loopEnd) {
          let currentLoop = new Date(loopStart);
          currentLoop.setHours(0,0,0,0);
          
          while (currentLoop <= loopEnd) {
            const currentStr = formatDateString(currentLoop);
            expanded.push({
              ...appt,
              instanceDate: currentStr,
              isOccurrence: currentStr !== appt.date
            });
            currentLoop.setDate(currentLoop.getDate() + 1);
          }
        }
      } else {
        const apptDate = new Date(appt.date + 'T00:00:00');
        if (apptDate >= rangeStart && apptDate <= rangeEnd) {
          expanded.push({
            ...appt,
            instanceDate: appt.date,
            isOccurrence: false
          });
        }
      }
      return;
    }

    // IS recurring
    const rec = appt.recurrence;
    const apptStart = new Date(appt.date + 'T00:00:00');
    const recEnd = rec.endDate ? new Date(rec.endDate + 'T23:59:59') : null;
    
    // Determine bounds for expansion loop
    const loopStart = new Date(Math.max(apptStart.getTime(), rangeStart.getTime()));
    const loopEnd = new Date(recEnd ? Math.min(recEnd.getTime(), rangeEnd.getTime()) : rangeEnd.getTime());

    // Prevent infinite loops on bad data
    if (loopStart > loopEnd) return;

    let loopDate = new Date(loopStart);
    // Standardize to midnight for clean comparison
    loopDate.setHours(0, 0, 0, 0);

    const maxDaysSafety = 366 * 2; // 2 years limit safety
    let daysIterated = 0;

    while (loopDate <= loopEnd && daysIterated < maxDaysSafety) {
      daysIterated++;
      const currentStr = formatDateString(loopDate);
      
      // Check if this date is listed in exceptions
      if (appt.exceptions && appt.exceptions.includes(currentStr)) {
        // Skip this date (either edited separately or deleted)
        loopDate.setDate(loopDate.getDate() + 1);
        continue;
      }

      let match = false;

      if (rec.frequency === 'daily') {
        const diffDays = Math.round((loopDate - apptStart) / 86400000);
        if (diffDays >= 0 && diffDays % (rec.interval || 1) === 0) {
          match = true;
        }
      } else if (rec.frequency === 'weekly') {
        const diffWeeks = Math.floor(Math.round((loopDate - apptStart) / 86400000) / 7);
        const diffDays = Math.round((loopDate - apptStart) / 86400000);
        
        // Correct interval check on weekly: check if it falls in correct week interval
        if (diffDays >= 0 && diffWeeks % (rec.interval || 1) === 0) {
          // JS getDay(): 0=Sunday, 1=Monday...
          // Recurrence daysOfWeek: ISO weekday 1=Monday, 7=Sunday
          let jsDay = loopDate.getDay();
          let isoDay = jsDay === 0 ? 7 : jsDay;
          
          if (rec.daysOfWeek && rec.daysOfWeek.includes(isoDay)) {
            match = true;
          }
        }
      } else if (rec.frequency === 'monthly') {
        const mDiff = (loopDate.getFullYear() - apptStart.getFullYear()) * 12 + (loopDate.getMonth() - apptStart.getMonth());
        if (mDiff >= 0 && mDiff % (rec.interval || 1) === 0) {
          // Match same day of month
          if (loopDate.getDate() === apptStart.getDate()) {
            match = true;
          }
        }
      }

      if (match) {
        expanded.push({
          ...appt,
          instanceDate: currentStr,
          isOccurrence: true,
          originalId: appt.id
        });
      }

      loopDate.setDate(loopDate.getDate() + 1);
    }
  });

  return expanded;
}

/**
 * Filter the expanded appointments based on global search & checklist filters
 */
function getFilteredAppointments(expandedList) {
  return expandedList.filter(appt => {
    // 1. Roster code search query
    if (rosterSearchQuery) {
      if (!appt.rosterCode.toLowerCase().includes(rosterSearchQuery)) {
        return false;
      }
    }

    // 2. Checked roster codes
    if (activeRosterFilters.size > 0) {
      if (!activeRosterFilters.has(appt.rosterCode)) {
        return false;
      }
    }

    // 3. Checked appointment types or series
    if (activeTypeFilters.size > 0) {
      // Filter can match the appointment type, or the specific series ID
      const hasTypeMatch = activeTypeFilters.has(`type:${appt.type}`);
      const hasSeriesMatch = appt.seriesId && activeTypeFilters.has(`series:${appt.seriesId}`);
      
      // If we filtered and neither matches, exclude
      if (!hasTypeMatch && !hasSeriesMatch) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Overlapping Event Positioning Algorithm (Google Calendar style)
 * Assigns columns and widths to overlapping events for side-by-side rendering in Day/Week views.
 */
function layoutDayEvents(events) {
  if (events.length === 0) return [];
  
  // Sort events: start time first, then duration desc
  const sorted = [...events].sort((a, b) => {
    const startA = timeToMinutes(a.startTime);
    const startB = timeToMinutes(b.startTime);
    if (startA !== startB) return startA - startB;
    
    const durA = timeToMinutes(a.endTime) - startA;
    const durB = timeToMinutes(b.endTime) - startB;
    return durB - durA;
  });

  const columns = []; // array of columns, each column is an array of events
  
  sorted.forEach(evt => {
    const evtStart = timeToMinutes(evt.startTime);
    
    // Find first column where this event fits without overlap
    let placed = false;
    for (let c = 0; c < columns.length; c++) {
      const col = columns[c];
      const lastEvt = col[col.length - 1];
      const lastEnd = timeToMinutes(lastEvt.endTime);
      
      if (evtStart >= lastEnd) {
        col.push(evt);
        evt.colIndex = c;
        placed = true;
        break;
      }
    }
    
    if (!placed) {
      columns.push([evt]);
      evt.colIndex = columns.length - 1;
    }
  });

  // Now, calculate overlap groups to set appropriate widths
  // If an event overlaps with ANY event in a group, it belongs to the group.
  const groups = [];
  
  sorted.forEach(evt => {
    const evtStart = timeToMinutes(evt.startTime);
    const evtEnd = timeToMinutes(evt.endTime);
    
    let matchingGroup = null;
    for (let g = 0; g < groups.length; g++) {
      const grp = groups[g];
      // Check if overlaps with any event in this group
      const overlaps = grp.some(gEvt => {
        const gStart = timeToMinutes(gEvt.startTime);
        const gEnd = timeToMinutes(gEvt.endTime);
        return (evtStart < gEnd && evtEnd > gStart);
      });
      
      if (overlaps) {
        matchingGroup = grp;
        break;
      }
    }
    
    if (matchingGroup) {
      matchingGroup.push(evt);
    } else {
      groups.push([evt]);
    }
  });

  // For each group, determine the maximum column index inside it + set layout details
  groups.forEach(grp => {
    // Collect all column indices used in this overlapping cluster
    const colIndices = grp.map(e => e.colIndex);
    const uniqueCols = [...new Set(colIndices)];
    const colsCount = uniqueCols.length;
    
    // We map the physical column indexes (which are absolute) to compact relative indexes (0, 1, 2...)
    const colMapping = {};
    uniqueCols.sort((a, b) => a - b).forEach((val, index) => {
      colMapping[val] = index;
    });

    grp.forEach(evt => {
      evt.relColIndex = colMapping[evt.colIndex];
      evt.totalCols = colsCount;
    });
  });

  return sorted;
}

/**
 * Main Calendar Render Router
 */
export function renderCalendar() {
  const wrapper = document.getElementById('calendar-view-wrapper');
  wrapper.innerHTML = '';

  // Calculate local boundaries
  const titleEl = document.getElementById('calendar-title');
  const now = new Date(currentDate);

  let startDateStr = '';
  let endDateStr = '';

  if (viewMode === 'day') {
    startDateStr = formatDateString(now);
    endDateStr = startDateStr;
    
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    titleEl.textContent = now.toLocaleDateString('de-DE', options);
    
  } else if (viewMode === 'week') {
    // Find Monday of the current week
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1); // adjust when day is sunday
    const monday = new Date(now.setDate(diff));
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    
    startDateStr = formatDateString(monday);
    endDateStr = formatDateString(sunday);
    
    titleEl.textContent = `KW ${getWeekNumber(monday)}, ${monday.getFullYear()}`;
    
  } else if (viewMode === 'month') {
    // First and last day of the month
    const year = now.getFullYear();
    const month = now.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    
    startDateStr = formatDateString(firstDay);
    endDateStr = formatDateString(lastDay);

    const monthNames = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
    titleEl.textContent = `${monthNames[now.getMonth()]} ${now.getFullYear()}`;
    
  } else if (viewMode === 'custom') {
    if (!customStartDate || !customEndDate) {
      // Show placeholder warning
      wrapper.innerHTML = `
        <div class="no-events-placeholder">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
          </svg>
          <h3>Zeitraum nicht ausgewählt</h3>
          <p>Bitte wählen Sie im linken Menü ein Start- und Enddatum aus und klicken Sie auf "Anwenden".</p>
        </div>
      `;
      titleEl.textContent = 'Benutzerdefinierter Zeitraum';
      return;
    }

    startDateStr = customStartDate;
    endDateStr = customEndDate;

    const start = new Date(customStartDate);
    const end = new Date(customEndDate);
    titleEl.textContent = `${start.toLocaleDateString('de-DE')} - ${end.toLocaleDateString('de-DE')}`;
  }

  // Render the student grid timetable
  renderStudentGrid(wrapper, startDateStr, endDateStr);

  // Proactively rebuild filters checkboxes in sidebar in case code details changed
  renderRosterFilterList();
  renderStudentFilterList();
  renderTypeFilterList();
}

/**
 * Renders the unified Student Agenda Grid
 */
function renderStudentGrid(container, startDateStr, endDateStr) {
  const studentCodes = storage.getStudentCodes();
  
  if (studentCodes.length === 0) {
    container.innerHTML = `
      <div class="no-events-placeholder">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.771m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z" />
        </svg>
        <h3>Keine Schüler konfiguriert</h3>
        <p>Bitte fügen Sie in den <strong>Einstellungen</strong> unter <strong>Schülerkürzel</strong> Schüler hinzu, um den Kalender anzuzeigen.</p>
      </div>
    `;
    return;
  }

  // Fetch and expand appointments for the selected date range
  const expanded = getExpandedAppointments(startDateStr, endDateStr);
  const filtered = getFilteredAppointments(expanded);

  // Generate table wrapper
  const wrapper = document.createElement('div');
  wrapper.className = 'student-grid-wrapper';

  const table = document.createElement('table');
  table.className = 'student-grid-table';

  // 1. Table Header Row
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');

  // Top-left corner cell
  const cornerTh = document.createElement('th');
  cornerTh.textContent = 'Tag / Datum';
  headerRow.appendChild(cornerTh);

  // Student header cells
  studentCodes.forEach(student => {
    const th = document.createElement('th');
    th.className = 'student-header';
    
    const contentDiv = document.createElement('div');
    contentDiv.className = 'student-header-content';
    
    const nameSpan = document.createElement('span');
    nameSpan.className = 'student-header-name';
    nameSpan.textContent = student;

    contentDiv.appendChild(nameSpan);
    th.appendChild(contentDiv);
    headerRow.appendChild(th);
  });

  thead.appendChild(headerRow);
  table.appendChild(thead);

  // 2. Table Body Rows (Iterate date range day by day)
  const tbody = document.createElement('tbody');
  
  const start = new Date(startDateStr + 'T00:00:00');
  const end = new Date(endDateStr + 'T00:00:00');
  const todayStr = formatDateString(new Date());

  let loopDate = new Date(start);
  while (loopDate <= end) {
    const dateStr = formatDateString(loopDate);
    const row = document.createElement('tr');
    
    // Row Date Cell
    const dateTd = document.createElement('td');
    if (dateStr === todayStr) {
      dateTd.className = 'today';
    }
    
    const weekday = loopDate.toLocaleDateString('de-DE', { weekday: 'short' });
    const dayAndMonth = loopDate.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
    
    dateTd.innerHTML = `<strong>${weekday}</strong><br><span class="text-xs text-muted">${dayAndMonth}</span>`;
    row.appendChild(dateTd);

    // Student cells for this day
    studentCodes.forEach(student => {
      const cell = document.createElement('td');
      cell.className = 'student-grid-cell';
      cell.dataset.date = dateStr;
      cell.dataset.student = student;

      // Click cell empty space to create appointment
      cell.addEventListener('click', (e) => {
        // Prevent triggering when clicking an appointment card
        if (e.target.closest('.student-grid-event-card')) return;
        ui.openAppointmentModalForCreate(dateStr, '08:00', '16:00', student);
      });

      // Find events matching this student on this day
      const cellEvents = filtered.filter(evt => evt.instanceDate === dateStr && evt.rosterCode === student);
      // Sort events by start time
      cellEvents.sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));

      if (cellEvents.length > 0) {
        const eventsContainer = document.createElement('div');
        eventsContainer.className = 'student-grid-cell-events';

        cellEvents.forEach(evt => {
          const card = document.createElement('div');
          card.className = 'student-grid-event-card';
          card.style.backgroundColor = getEventColor(evt);

          const types = storage.getAppointmentTypes();
          const typeObj = types.find(t => t.id === evt.type);

          card.innerHTML = `
            <span class="event-card-type">${typeObj ? typeObj.name : ''}</span>
            <span class="event-card-time">${evt.startTime} - ${evt.endTime}</span>
          `;

          // Click card to edit appointment
          card.addEventListener('click', (e) => {
            e.stopPropagation();
            ui.openAppointmentModalForEdit(evt);
          });

          eventsContainer.appendChild(card);
        });

        cell.appendChild(eventsContainer);
      }

      row.appendChild(cell);
    });

    tbody.appendChild(row);
    loopDate.setDate(loopDate.getDate() + 1);
  }

  table.appendChild(tbody);
  wrapper.appendChild(table);
  container.appendChild(wrapper);
}

/**
 * Renders the roster code checklist filters in the sidebar
 */
export function renderRosterFilterList() {
  // No-op: Dienstplankürzel filter has been removed from the UI.
}

export function renderStudentFilterList() {
  const studentCodes = storage.getStudentCodes();
  const container = document.getElementById('student-filters-list');
  if (!container) return;
  container.innerHTML = '';

  if (studentCodes.length === 0) {
    container.innerHTML = '<span class="text-xs text-muted-light">Keine Schülerkürzel vorhanden</span>';
    return;
  }

  studentCodes.forEach(code => {
    // If search filter is active and doesn't match, skip
    if (rosterSearchQuery && !code.toLowerCase().includes(rosterSearchQuery)) {
      return;
    }

    const wrapper = document.createElement('label');
    wrapper.className = 'checkbox-wrapper';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = code;
    cb.checked = activeRosterFilters.has(code);
    cb.addEventListener('change', (e) => {
      toggleRosterFilter(code, e.target.checked);
    });

    const labelSpan = document.createElement('span');
    labelSpan.className = 'filter-item-label';
    labelSpan.textContent = code;

    wrapper.appendChild(cb);
    wrapper.appendChild(labelSpan);
    container.appendChild(wrapper);
  });
}

/**
 * Renders the appointment types & series checklist filters in the sidebar
 */
export function renderTypeFilterList() {
  const types = storage.getAppointmentTypes();
  const appointments = storage.getAppointments();
  const container = document.getElementById('type-filters-list');
  container.innerHTML = '';

  // 1. Populate standard appointment type toggles
  types.forEach(type => {
    const wrapper = document.createElement('label');
    wrapper.className = 'checkbox-wrapper';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = `type:${type.id}`;
    cb.checked = activeTypeFilters.has(`type:${type.id}`);
    cb.addEventListener('change', (e) => {
      toggleTypeFilter(`type:${type.id}`, e.target.checked);
    });

    const labelSpan = document.createElement('span');
    labelSpan.className = 'filter-item-label';
    
    const colorInd = document.createElement('span');
    colorInd.className = 'filter-color-indicator';
    colorInd.style.backgroundColor = type.color;
    
    const textNode = document.createTextNode(type.name);

    labelSpan.appendChild(colorInd);
    labelSpan.appendChild(textNode);
    wrapper.appendChild(cb);
    wrapper.appendChild(labelSpan);
    container.appendChild(wrapper);
  });

  // 2. Identify active recurring series from appointments list and show them as specific series filters
  const seriesMap = new Map();
  appointments.forEach(appt => {
    if (appt.seriesId && appt.recurrence && appt.recurrence.frequency !== 'none') {
      // Create a nice series name label
      let frequencyGerman = 'Serie';
      if (appt.recurrence.frequency === 'daily') frequencyGerman = 'Täglich';
      else if (appt.recurrence.frequency === 'weekly') frequencyGerman = 'Wöchentlich';
      else if (appt.recurrence.frequency === 'monthly') frequencyGerman = 'Monatlich';
      
      const typeObj = types.find(t => t.id === appt.type);
      const labelText = appt.title || (typeObj ? typeObj.name : 'Termin');
      const label = `${labelText} (${frequencyGerman})`;
      seriesMap.set(appt.seriesId, {
        id: appt.seriesId,
        label: label,
        color: getEventColor(appt)
      });
    }
  });

  if (seriesMap.size > 0) {
    const titleDivider = document.createElement('h4');
    titleDivider.className = 'text-xs text-muted-light uppercase tracking-wider mt-3 mb-2';
    titleDivider.textContent = 'Terminserien';
    container.appendChild(titleDivider);

    seriesMap.forEach(series => {
      const wrapper = document.createElement('label');
      wrapper.className = 'checkbox-wrapper';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = `series:${series.id}`;
      cb.checked = activeTypeFilters.has(`series:${series.id}`);
      cb.addEventListener('change', (e) => {
        toggleTypeFilter(`series:${series.id}`, e.target.checked);
      });

      const labelSpan = document.createElement('span');
      labelSpan.className = 'filter-item-label';
      
      const colorInd = document.createElement('span');
      colorInd.className = 'filter-color-indicator';
      colorInd.style.backgroundColor = series.color;
      
      const textNode = document.createTextNode(series.label);

      labelSpan.appendChild(colorInd);
      labelSpan.appendChild(textNode);
      wrapper.appendChild(cb);
      wrapper.appendChild(labelSpan);
      container.appendChild(wrapper);
    });
  }
}
