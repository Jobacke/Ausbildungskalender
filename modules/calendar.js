/**
 * Calendar Layout and Rendering Module
 * Manages view states, ranges, date logic, recurring series expansion, and overlapping layout algorithms.
 */

import * as storage from './storage.js';
import * as ui from './ui.js';

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
  if (evt.color) return evt.color;
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
  document.getElementById('roster-search').value = '';
  
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

  if (viewMode === 'day') {
    const dateStr = formatDateString(now);
    
    // Set Header Title
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    titleEl.textContent = now.toLocaleDateString('de-DE', options);
    
    renderDayView(wrapper, dateStr);
    
  } else if (viewMode === 'week') {
    // Find Monday of the current week
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1); // adjust when day is sunday
    const monday = new Date(now.setDate(diff));
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    
    titleEl.textContent = `KW ${getWeekNumber(monday)}, ${monday.getFullYear()}`;
    
    renderWeekView(wrapper, monday);
    
  } else if (viewMode === 'month') {
    const monthNames = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
    titleEl.textContent = `${monthNames[now.getMonth()]} ${now.getFullYear()}`;
    
    renderMonthView(wrapper, now);
    
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

    const start = new Date(customStartDate);
    const end = new Date(customEndDate);
    titleEl.textContent = `${start.toLocaleDateString('de-DE')} - ${end.toLocaleDateString('de-DE')}`;
    
    renderCustomView(wrapper, customStartDate, customEndDate);
  }

  // Proactively rebuild filters checkboxes in sidebar in case code details changed
  renderRosterFilterList();
  renderTypeFilterList();
}

/**
 * Renders the calendar Day View
 */
function renderDayView(container, dateStr) {
  // Day Grid Structure: Left hour labels, Right column
  const grid = document.createElement('div');
  grid.className = 'day-view-grid';

  // Header
  const labelHeader = document.createElement('div');
  labelHeader.className = 'grid-header-cell';
  labelHeader.textContent = 'Zeit';
  labelHeader.style.gridColumn = '1';
  labelHeader.style.gridRow = '1';
  
  const colHeader = document.createElement('div');
  colHeader.className = 'day-view-header-cell';
  colHeader.style.gridColumn = '2';
  colHeader.style.gridRow = '1';
  
  // Format day header
  const d = new Date(dateStr + 'T00:00:00');
  colHeader.textContent = d.toLocaleDateString('de-DE', { weekday: 'long' });

  grid.appendChild(labelHeader);
  grid.appendChild(colHeader);

  // Hour Rows (24 hours: 00:00 - 23:00)
  const columnsContainer = document.createElement('div');
  columnsContainer.className = 'week-column';
  columnsContainer.style.gridColumn = '2';
  columnsContainer.style.gridRow = '2 / span 24';
  // Attach date context for clicking
  columnsContainer.dataset.date = dateStr;
  columnsContainer.addEventListener('click', (e) => {
    // Avoid double clicks triggers when clicking actual events
    if (e.target.closest('.appt-block-absolute')) return;
    
    // Find clicked hour
    const rect = columnsContainer.getBoundingClientRect();
    const clickY = e.clientY - rect.top;
    const clickedHour = Math.floor(clickY / 60);
    const hourStr = String(clickedHour).padStart(2, '0') + ':00';
    const endHourStr = String(Math.min(clickedHour + 1, 23)).padStart(2, '0') + ':00';
    
    ui.openAppointmentModalForCreate(dateStr, hourStr, endHourStr);
  });

  // Draw background hour lines
  for (let hour = 0; hour < 24; hour++) {
    // Left Label
    const hourLabel = document.createElement('div');
    hourLabel.className = 'hour-label-cell';
    hourLabel.textContent = `${String(hour).padStart(2, '0')}:00`;
    hourLabel.style.gridColumn = '1';
    hourLabel.style.gridRow = `${hour + 2}`;
    grid.appendChild(hourLabel);
    
    // Row background line inside column
    const bgLine = document.createElement('div');
    bgLine.className = 'week-cell-bg-line';
    columnsContainer.appendChild(bgLine);
  }

  // Draw Appointments
  const expanded = getExpandedAppointments(dateStr, dateStr);
  const filtered = getFilteredAppointments(expanded);
  const positioned = layoutDayEvents(filtered);

  const apptContainer = document.createElement('div');
  apptContainer.className = 'week-appt-container';

  positioned.forEach(evt => {
    const startMins = timeToMinutes(evt.startTime);
    const endMins = timeToMinutes(evt.endTime);
    const duration = endMins - startMins;

    // Y positioning: 1 hour = 60px -> 1 minute = 1px
    const top = startMins;
    const height = Math.max(duration, 20); // min height 20px

    const block = document.createElement('div');
    block.className = 'appt-block-absolute';
    block.style.backgroundColor = getEventColor(evt);
    block.style.top = `${top}px`;
    block.style.height = `${height}px`;
    
    // X Positioning side-by-side
    const widthPct = 94 / evt.totalCols;
    const leftPct = (evt.relColIndex * widthPct) + 1;
    block.style.width = `${widthPct}%`;
    block.style.left = `${leftPct}%`;

    block.innerHTML = `
      <div class="appt-title">${evt.title}</div>
      <div class="appt-block-time">${evt.startTime} - ${evt.endTime}</div>
      <div class="appt-block-roster">${evt.rosterCode}</div>
    `;

    block.addEventListener('click', (e) => {
      e.stopPropagation();
      ui.openAppointmentModalForEdit(evt);
    });

    apptContainer.appendChild(block);
  });

  // Append single column
  grid.appendChild(columnsContainer);
  columnsContainer.appendChild(apptContainer);
  container.appendChild(grid);

  // Auto-scroll to 07:00 on render for better initial focus
  setTimeout(() => {
    container.scrollTop = 7 * 60;
  }, 10);
}

/**
 * Renders the calendar Week View
 */
function renderWeekView(container, mondayDate) {
  const grid = document.createElement('div');
  grid.className = 'week-view-grid';

  // Hours label header space
  const cornerCell = document.createElement('div');
  cornerCell.className = 'grid-header-cell';
  cornerCell.textContent = 'Zeit';
  cornerCell.style.gridColumn = '1';
  cornerCell.style.gridRow = '1';
  grid.appendChild(cornerCell);

  // 7 Weekday columns headers
  const daysDates = [];
  const todayStr = formatDateString(new Date());

  for (let i = 0; i < 7; i++) {
    const dayDate = new Date(mondayDate);
    dayDate.setDate(mondayDate.getDate() + i);
    const dateStr = formatDateString(dayDate);
    daysDates.push(dateStr);

    const headCell = document.createElement('div');
    headCell.className = 'week-view-header-cell';
    headCell.style.gridColumn = `${i + 2}`;
    headCell.style.gridRow = '1';
    if (dateStr === todayStr) {
      headCell.classList.add('today');
    }

    const name = document.createElement('span');
    name.className = 'weekday-name';
    name.textContent = dayDate.toLocaleDateString('de-DE', { weekday: 'short' });

    const num = document.createElement('span');
    num.className = 'weekday-date';
    num.textContent = dayDate.getDate();

    headCell.appendChild(name);
    headCell.appendChild(num);
    grid.appendChild(headCell);
  }

  // Create columns list
  const cols = [];
  for (let i = 0; i < 7; i++) {
    const col = document.createElement('div');
    col.className = 'week-column';
    col.style.gridColumn = `${i + 2}`;
    col.style.gridRow = '2 / span 24';
    if (daysDates[i] === todayStr) {
      col.classList.add('today');
    }
    col.dataset.date = daysDates[i];
    
    // Clicking grid to create
    col.addEventListener('click', (e) => {
      if (e.target.closest('.appt-block-absolute')) return;
      const rect = col.getBoundingClientRect();
      const clickY = e.clientY - rect.top;
      const clickedHour = Math.floor(clickY / 60);
      const hourStr = String(clickedHour).padStart(2, '0') + ':00';
      const endHourStr = String(Math.min(clickedHour + 1, 23)).padStart(2, '0') + ':00';
      ui.openAppointmentModalForCreate(daysDates[i], hourStr, endHourStr);
    });

    cols.push(col);
  }

  // Fill in time lines row by row
  for (let hour = 0; hour < 24; hour++) {
    // Left Label
    const hourLabel = document.createElement('div');
    hourLabel.className = 'hour-label-cell';
    hourLabel.textContent = `${String(hour).padStart(2, '0')}:00`;
    hourLabel.style.gridColumn = '1';
    hourLabel.style.gridRow = `${hour + 2}`;
    grid.appendChild(hourLabel);

    // Draw row segments inside columns
    cols.forEach(col => {
      const line = document.createElement('div');
      line.className = 'week-cell-bg-line';
      col.appendChild(line);
    });
  }

  // Fetch all expanded events for the week range
  const expanded = getExpandedAppointments(daysDates[0], daysDates[6]);
  const filtered = getFilteredAppointments(expanded);

  // Group events by day to calculate overlapping layout
  for (let i = 0; i < 7; i++) {
    const dayDateStr = daysDates[i];
    const dayEvents = filtered.filter(e => e.instanceDate === dayDateStr);
    const positioned = layoutDayEvents(dayEvents);

    const apptContainer = document.createElement('div');
    apptContainer.className = 'week-appt-container';

    positioned.forEach(evt => {
      const startMins = timeToMinutes(evt.startTime);
      const endMins = timeToMinutes(evt.endTime);
      const duration = endMins - startMins;

      const top = startMins;
      const height = Math.max(duration, 20);

      const block = document.createElement('div');
      block.className = 'appt-block-absolute';
      block.style.backgroundColor = getEventColor(evt);
      block.style.top = `${top}px`;
      block.style.height = `${height}px`;

      const widthPct = 94 / evt.totalCols;
      const leftPct = (evt.relColIndex * widthPct) + 1;
      block.style.width = `${widthPct}%`;
      block.style.left = `${leftPct}%`;

      block.innerHTML = `
        <div class="appt-title">${evt.title}</div>
        <div class="appt-block-time">${evt.startTime} - ${evt.endTime}</div>
        <div class="appt-block-roster">${evt.rosterCode}</div>
      `;

      block.addEventListener('click', (e) => {
        e.stopPropagation();
        ui.openAppointmentModalForEdit(evt);
      });

      apptContainer.appendChild(block);
    });

    cols[i].appendChild(apptContainer);
  }

  // Append columns to grid
  cols.forEach(col => grid.appendChild(col));
  container.appendChild(grid);

  // Focus scroll to 07:00
  setTimeout(() => {
    container.scrollTop = 7 * 60;
  }, 10);
}

/**
 * Renders the calendar Month View
 */
function renderMonthView(container, focusDate) {
  const grid = document.createElement('div');
  grid.className = 'month-view-grid';

  // 1. Headers: Week Number corner, then Mon-Sun
  const corners = document.createElement('div');
  corners.className = 'grid-header-cell';
  corners.textContent = 'KW';
  grid.appendChild(corners);

  const weekdays = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
  weekdays.forEach(day => {
    const cell = document.createElement('div');
    cell.className = 'grid-header-cell';
    cell.textContent = day;
    grid.appendChild(cell);
  });

  // Calculate Month Boundaries
  const year = focusDate.getFullYear();
  const month = focusDate.getMonth();
  
  // First day of month
  const firstDay = new Date(year, month, 1);
  // Last day of month
  const lastDay = new Date(year, month + 1, 0);

  // Find Monday of the first week of the month grid
  // jsDay: 0=Sun, 1=Mon, ..., 6=Sat
  let startOffset = firstDay.getDay();
  // Adjust Monday offset: if Sunday, offset is 6. If Mon, offset is 0. If Tue, offset is 1.
  let paddingDays = startOffset === 0 ? 6 : startOffset - 1;
  
  const gridStart = new Date(firstDay);
  gridStart.setDate(firstDay.getDate() - paddingDays);

  // Find Sunday of the last week of the month grid
  let endOffset = lastDay.getDay();
  let paddingEnd = endOffset === 0 ? 0 : 7 - endOffset;

  const gridEnd = new Date(lastDay);
  gridEnd.setDate(lastDay.getDate() + paddingEnd);

  // Fetch all expanded events inside this full month grid range
  const gridStartStr = formatDateString(gridStart);
  const gridEndStr = formatDateString(gridEnd);
  
  const expanded = getExpandedAppointments(gridStartStr, gridEndStr);
  const filtered = getFilteredAppointments(expanded);

  // Loop week by week to draw cells
  const loopDate = new Date(gridStart);
  const todayStr = formatDateString(new Date());

  while (loopDate <= gridEnd) {
    // Render Week Number (only once per row/week)
    if (loopDate.getDay() === 1 || loopDate.getTime() === gridStart.getTime()) {
      const weekCell = document.createElement('div');
      weekCell.className = 'week-num-cell';
      weekCell.textContent = getWeekNumber(loopDate);
      grid.appendChild(weekCell);
    }

    const cellDateStr = formatDateString(loopDate);
    
    // Day Cell container
    const cell = document.createElement('div');
    cell.className = 'day-cell';
    if (loopDate.getMonth() !== month) {
      cell.classList.add('other-month');
    }
    if (cellDateStr === todayStr) {
      cell.classList.add('today');
    }

    // Pass date string as data attribute
    cell.dataset.date = cellDateStr;
    cell.addEventListener('click', (e) => {
      if (e.target.closest('.appt-block')) return;
      ui.openAppointmentModalForCreate(cellDateStr, '08:00', '16:00');
    });

    // Day header inside cell
    const header = document.createElement('div');
    header.className = 'day-cell-header';
    
    const num = document.createElement('span');
    num.className = 'day-number';
    num.textContent = loopDate.getDate();
    header.appendChild(num);

    cell.appendChild(header);

    // Day events container
    const evtsContainer = document.createElement('div');
    evtsContainer.className = 'day-cell-events';

    // Get events for this day
    const dayEvents = filtered.filter(e => e.instanceDate === cellDateStr);
    
    // Sort events by start time
    dayEvents.sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));

    dayEvents.forEach(evt => {
      const apptEl = document.createElement('div');
      apptEl.className = 'appt-block';
      apptEl.style.backgroundColor = getEventColor(evt);
      apptEl.style.borderLeftColor = 'rgba(0,0,0,0.3)';

      apptEl.innerHTML = `
        <span class="appt-title">${evt.title}</span>
        <span class="appt-block-time">${evt.startTime} (${evt.rosterCode})</span>
      `;

      apptEl.addEventListener('click', (e) => {
        e.stopPropagation();
        ui.openAppointmentModalForEdit(evt);
      });

      evtsContainer.appendChild(apptEl);
    });

    cell.appendChild(evtsContainer);
    grid.appendChild(cell);

    // Increment day
    loopDate.setDate(loopDate.getDate() + 1);
  }

  container.appendChild(grid);
}

/**
 * Renders Custom View (scrollable list of days with events)
 */
function renderCustomView(container, startDateStr, endDateStr) {
  const wrapper = document.createElement('div');
  wrapper.className = 'custom-view-list';

  const expanded = getExpandedAppointments(startDateStr, endDateStr);
  const filtered = getFilteredAppointments(expanded);

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="no-events-placeholder">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
        </svg>
        <h3>Keine Termine gefunden</h3>
        <p>Im ausgewählten Zeitraum liegen keine Termine, die Ihren Filtern entsprechen.</p>
      </div>
    `;
    return;
  }

  // Group events by date
  const eventsByDate = {};
  filtered.forEach(evt => {
    if (!eventsByDate[evt.instanceDate]) {
      eventsByDate[evt.instanceDate] = [];
    }
    eventsByDate[evt.instanceDate].push(evt);
  });

  // Sort dates
  const sortedDates = Object.keys(eventsByDate).sort();

  sortedDates.forEach(dateStr => {
    const dayDate = new Date(dateStr + 'T00:00:00');
    const dayEvts = eventsByDate[dateStr];
    
    // Sort day events by start time
    dayEvts.sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));

    const card = document.createElement('div');
    card.className = 'custom-view-day-card';

    const header = document.createElement('div');
    header.className = 'custom-view-day-header';
    
    const title = document.createElement('h3');
    title.textContent = dayDate.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

    const info = document.createElement('span');
    info.className = 'day-info';
    info.textContent = `KW ${getWeekNumber(dayDate)} - ${dayEvts.length} Termin(e)`;

    header.appendChild(title);
    header.appendChild(info);
    card.appendChild(header);

    const evtsList = document.createElement('div');
    evtsList.className = 'custom-view-events-list';

    dayEvts.forEach(evt => {
      const item = document.createElement('div');
      item.className = 'custom-view-event-item';
      item.style.backgroundColor = getEventColor(evt);

      // Find type details
      const types = storage.getAppointmentTypes();
      const typeObj = types.find(t => t.id === evt.type);

      item.innerHTML = `
        <span class="custom-view-event-time">${evt.startTime} - ${evt.endTime}</span>
        <div class="custom-view-event-details">
          <span class="custom-view-event-title">${evt.title}</span>
          <span class="custom-view-event-roster">Kürzel: <strong>${evt.rosterCode}</strong></span>
        </div>
        <span class="custom-view-event-type">${typeObj ? typeObj.name : 'Sonstiges'}</span>
      `;

      item.addEventListener('click', () => {
        ui.openAppointmentModalForEdit(evt);
      });

      evtsList.appendChild(item);
    });

    card.appendChild(evtsList);
    wrapper.appendChild(card);
  });

  container.appendChild(wrapper);
}

/**
 * Renders the roster code checklist filters in the sidebar
 */
export function renderRosterFilterList() {
  const appointments = storage.getAppointments();
  const studentCodes = storage.getStudentCodes();
  
  // Extract unique roster codes from all appointments that are NOT student codes
  const codes = [...new Set(appointments.map(a => a.rosterCode))]
    .filter(Boolean)
    .filter(code => !studentCodes.includes(code))
    .sort();

  const container = document.getElementById('roster-filters-list');
  if (!container) return;
  container.innerHTML = '';

  if (codes.length === 0) {
    container.innerHTML = '<span class="text-xs text-muted-light">Keine Dienstplankürzel vorhanden</span>';
    return;
  }

  codes.forEach(code => {
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
      
      const label = `${appt.title} (${frequencyGerman})`;
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
