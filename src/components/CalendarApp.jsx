import React, { useEffect, useMemo, useState } from "react";
import "./CalendarApp.css";

const STORAGE_EVENTS = "calendar_events_v3";
const STORAGE_CALENDARS = "calendar_calendars_v1";
const STORAGE_THEME = "calendar_theme_v1";

// helpers
function formatKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getViewRange(viewDate, viewMode) {
  const y = viewDate.getFullYear();
  const m = viewDate.getMonth();
  const d = viewDate.getDate();

  if (viewMode === "month") {
    const first = new Date(y, m, 1);
    const last = new Date(y, m + 1, 0);
    return [first, last];
  }
  if (viewMode === "week") {
    const cur = new Date(viewDate);
    const start = new Date(cur);
    start.setDate(cur.getDate() - cur.getDay());
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return [start, end];
  }
  const day = new Date(y, m, d);
  return [day, day];
}

function expandEventOccurrences(ev, rangeStart, rangeEnd) {
  const occurrences = [];
  const baseParts = ev.date.split("-").map(Number);
  let startDate = new Date(baseParts[0], baseParts[1] - 1, baseParts[2]);

  if (!ev.recurrence || ev.recurrence === "none") {
    if (startDate >= rangeStart && startDate <= rangeEnd)
      occurrences.push({ ...ev, occDate: new Date(startDate) });
    return occurrences;
  }

  const maxIterations = 500;
  let current = new Date(startDate);

  if (current < rangeStart) {
    const diffDays = Math.floor((rangeStart - current) / (1000 * 60 * 60 * 24));
    if (ev.recurrence === "daily") {
      current.setDate(current.getDate() + diffDays);
    } else if (ev.recurrence === "weekly") {
      const weeks = Math.floor(diffDays / 7);
      current.setDate(current.getDate() + weeks * 7);
    } else if (ev.recurrence === "monthly") {
      const months =
        (rangeStart.getFullYear() - current.getFullYear()) * 12 +
        (rangeStart.getMonth() - current.getMonth());
      if (months > 0) current.setMonth(current.getMonth() + months);
    }
  }

  let i = 0;
  while (i < maxIterations && current <= rangeEnd) {
    if (current >= rangeStart && current <= rangeEnd)
      occurrences.push({ ...ev, occDate: new Date(current) });

    if (ev.recurrence === "daily") current.setDate(current.getDate() + 1);
    else if (ev.recurrence === "weekly") current.setDate(current.getDate() + 7);
    else if (ev.recurrence === "monthly") {
      const day = current.getDate();
      current.setMonth(current.getMonth() + 1);
      if (current.getDate() < day) current.setDate(0);
    }
    i++;
  }

  return occurrences;
}

function scheduleNotification(ev, occDate) {
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") return;

  const [hh, mm] = ev.time.split(":").map((n) => Number(n));
  const eventDateTime = new Date(occDate);
  eventDateTime.setHours(hh, mm, 0, 0);

  const reminderMinutes = ev.reminderMinutes ?? 0;
  const notifyTime = new Date(eventDateTime.getTime() - reminderMinutes * 60 * 1000);
  const delta = notifyTime.getTime() - Date.now();
  if (delta <= 0 || delta > 24 * 60 * 60 * 1000) return;

  setTimeout(() => {
    new Notification("Calendar reminder", {
      body: `${ev.text} — ${ev.time}`,
      tag: `ev-${ev.id}-${eventDateTime.getTime()}`,
    });
  }, delta);
}

export default function CalendarApp() {
  const [theme, setTheme] = useState(() => localStorage.getItem(STORAGE_THEME) || "light");

  useEffect(() => {
    localStorage.setItem(STORAGE_THEME, theme);
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const [calendars, setCalendars] = useState(() => {
    try {
      const raw = localStorage.getItem(STORAGE_CALENDARS);
      if (raw) return JSON.parse(raw);
      return [
        { id: "cal-personal", name: "Personal", color: "#1e88ff", visible: true },
        { id: "cal-work", name: "Work", color: "#ff7043", visible: true },
      ];
    } catch {
      return [];
    }
  });

  useEffect(() => localStorage.setItem(STORAGE_CALENDARS, JSON.stringify(calendars)), [calendars]);

  const [events, setEvents] = useState(() => {
    try {
      const raw = localStorage.getItem(STORAGE_EVENTS);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });

  useEffect(() => localStorage.setItem(STORAGE_EVENTS, JSON.stringify(events)), [events]);

  const [viewMode, setViewMode] = useState("month");
  const [viewDate, setViewDate] = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState(null);

  const [isPopupOpen, setPopupOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState(null);
  const [form, setForm] = useState({
    date: formatKey(new Date()),
    time: "09:00",
    text: "",
    calendarId: calendars[0]?.id || "cal-personal",
    recurrence: "none",
    reminderMinutes: 15,
  });

  const [rangeStart, rangeEnd] = useMemo(() => getViewRange(viewDate, viewMode), [viewDate, viewMode]);

  const occurrences = useMemo(() => {
    const arr = [];
    for (const evtKey in events) {
      const listForKey = events[evtKey];
      for (const ev of listForKey) {
        const cal = calendars.find((c) => c.id === ev.calendarId);
        if (!cal || !cal.visible) continue;
        const occs = expandEventOccurrences(ev, rangeStart, rangeEnd);
        for (const o of occs) {
          arr.push({ ...o, calendar: cal });
        }
      }
    }
    arr.sort((a, b) => {
      const da = new Date(a.occDate);
      const db = new Date(b.occDate);
      if (da.getTime() !== db.getTime()) return da - db;
      return a.time.localeCompare(b.time);
    });
    return arr;
  }, [events, calendars, rangeStart, rangeEnd]);

  useEffect(() => {
    if (Notification.permission === "default") Notification.requestPermission();
    occurrences.forEach((o) => {
      scheduleNotification(o, o.occDate);
    });
    // eslint-disable-next-line
  }, [occurrences]);

  function addCalendar(name, color) {
    const id = "cal-" + Date.now();
    setCalendars((s) => [...s, { id, name, color, visible: true }]);
  }

  function toggleCalendarVisibility(calId) {
    setCalendars((s) => s.map((c) => (c.id === calId ? { ...c, visible: !c.visible } : c)));
  }

  function openCreatePopup(baseDate) {
    const dateKey = baseDate ? formatKey(baseDate) : formatKey(viewDate);
    setForm((f) => ({ ...f, date: dateKey, time: "09:00", text: "", recurrence: "none", reminderMinutes: 15, calendarId: calendars[0]?.id || "" }));
    setEditingEvent(null);
    setPopupOpen(true);
  }

  function openEditPopup(ev) {
    setEditingEvent(ev);
    setForm({
      date: formatKey(ev.occDate || new Date(ev.date)),
      time: ev.time,
      text: ev.text,
      calendarId: ev.calendarId,
      recurrence: ev.recurrence || "none",
      reminderMinutes: ev.reminderMinutes ?? 15,
    });
    setPopupOpen(true);
  }

  function saveEvent() {
    const dateParts = form.date.split("-").map(Number);
    const baseDateKey = `${dateParts[0]}-${String(dateParts[1]).padStart(2, "0")}-${String(dateParts[2]).padStart(2, "0")}`;

    if (editingEvent) {
      setEvents((prev) => {
        const copy = { ...prev };
        for (const existingKey of Object.keys(copy)) {
          const idx = copy[existingKey].findIndex((e) => e.id === editingEvent.id);
          if (idx !== -1) {
            const updated = { ...copy[existingKey][idx], date: baseDateKey, time: form.time, text: form.text.slice(0, 200), calendarId: form.calendarId, recurrence: form.recurrence, reminderMinutes: Number(form.reminderMinutes) };
            copy[existingKey][idx] = updated;
            if (existingKey !== baseDateKey) {
              copy[baseDateKey] = copy[baseDateKey] ? [...copy[baseDateKey], updated] : [updated];
              copy[existingKey] = copy[existingKey].filter((e) => e.id !== editingEvent.id);
              if (copy[existingKey].length === 0) delete copy[existingKey];
            }
            break;
          }
        }
        return copy;
      });
    } else {
      const id = Date.now() + Math.floor(Math.random() * 1000);
      const newEv = {
        id,
        date: baseDateKey,
        time: form.time,
        text: form.text.slice(0, 200),
        calendarId: form.calendarId,
        recurrence: form.recurrence,
        reminderMinutes: Number(form.reminderMinutes),
      };
      setEvents((prev) => {
        const copy = { ...prev };
        copy[baseDateKey] = copy[baseDateKey] ? [...copy[baseDateKey], newEv] : [newEv];
        return copy;
      });
    }
    setPopupOpen(false);
  }

  function deleteEventById(ev) {
    if (!window.confirm("Delete this event?")) return;
    setEvents((prev) => {
      const copy = {};
      for (const existingKey of Object.keys(prev)) {
        const list = prev[existingKey].filter((e) => e.id !== ev.id);
        if (list.length) copy[existingKey] = list;
      }
      return copy;
    });
  }

  function onDragStart(e, ev) {
    e.dataTransfer.setData("text/plain", String(ev.id));
    e.dataTransfer.effectAllowed = "move";
  }
  function onDropOnDate(e, dateKey) {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/plain");
    if (!id) return;
    setEvents((prev) => {
      const copy = { ...prev };
      for (const existingKey of Object.keys(copy)) {
        const idx = copy[existingKey].findIndex((it) => String(it.id) === String(id));
        if (idx !== -1) {
          const ev = copy[existingKey][idx];
          const moved = { ...ev, date: dateKey };
          copy[dateKey] = copy[dateKey] ? [...copy[dateKey], moved] : [moved];
          copy[existingKey] = copy[existingKey].filter((it) => String(it.id) !== String(id));
          if (copy[existingKey].length === 0) delete copy[existingKey];
          break;
        }
      }
      return copy;
    });
  }

  function nextPeriod() {
    const d = new Date(viewDate);
    if (viewMode === "month") d.setMonth(d.getMonth() + 1);
    else if (viewMode === "week") d.setDate(d.getDate() + 7);
    else d.setDate(d.getDate() + 1);
    setViewDate(d);
  }
  function prevPeriod() {
    const d = new Date(viewDate);
    if (viewMode === "month") d.setMonth(d.getMonth() - 1);
    else if (viewMode === "week") d.setDate(d.getDate() - 7);
    else d.setDate(d.getDate() - 1);
    setViewDate(d);
  }

  const [newCalName, setNewCalName] = useState("");
  const [newCalColor, setNewCalColor] = useState("#8e24aa");

  return (
    <div className="gc-wrapper">
      <header className="gc-header">
        <div className="left">
          <h2>CALENDAR</h2>
          <div className="controls">
            <button onClick={() => setViewMode("month")} className={viewMode === "month" ? "active" : ""}>Month</button>
            <button onClick={() => setViewMode("week")} className={viewMode === "week" ? "active" : ""}>Week</button>
            
            
          </div>
        </div>

        <div className="right">
          <div className="nav">
            <button onClick={prevPeriod}>◀</button>
            <div className="title">{viewDate.toLocaleString(undefined, { month: "long" })} {viewDate.getFullYear()}</div>
            <button onClick={nextPeriod}>▶</button>
          </div>

          <button onClick={() => setTheme(theme === "light" ? "dark" : "light")}>
            {theme === "light" ? "🌙" : "☀️"}
          </button>
        </div>
      </header>

      <main className="gc-main">
        <aside className="gc-side">
          <section className="calendars">
            <h4>CALENDAR</h4>
            {calendars.map((c) => (
              <div key={c.id} className="cal-row">
                <label>
                  <input type="checkbox" checked={c.visible} onChange={() => toggleCalendarVisibility(c.id)} />
                  <span className="swatch" style={{ background: c.color }} />
                  {c.name}
                </label>
              </div>
            ))}

            <div className="new-cal">
              <input placeholder="New calendar name" value={newCalName} onChange={(e) => setNewCalName(e.target.value)} />
              <input type="color" value={newCalColor} onChange={(e) => setNewCalColor(e.target.value)} />
              <button onClick={() => { if (!newCalName) return alert("name"); addCalendar(newCalName, newCalColor); setNewCalName(""); }}>Add</button>
            </div>
          </section>

          <section className="upcoming">
            <h4>Upcoming</h4>
            {occurrences.length === 0 ? <div className="muted">No events in view</div> : occurrences.slice(0, 6).map((o) => (
              <div key={`${o.id}-${o.occDate}`} className="up-item">
                <div className="up-time">{o.time}</div>
                <div className="up-text">{o.text}</div>
                <div className="up-cal" style={{ background: o.calendar.color }} />
              </div>
            ))}
          </section>
        </aside>

        <section className="gc-body">
          {viewMode !== "month" && (
            <div className="weekdays-row">
              {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((w) => (<div key={w} className="weekday">{w}</div>))}
            </div>
          )}

          <div className={`grid ${viewMode}`}>
            {(() => {
              const cells = [];
              if (viewMode === "month") {
                const startOfMonth = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);
                const leading = startOfMonth.getDay();
                const daysCount = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0).getDate();
                const totalCells = Math.ceil((leading + daysCount) / 7) * 7;
                for (let idx = 0; idx < totalCells; idx++) {
                  const dayNumber = idx - leading + 1;
                  let cellDate = null;
                  if (dayNumber > 0 && dayNumber <= daysCount) cellDate = new Date(viewDate.getFullYear(), viewDate.getMonth(), dayNumber);
                  cells.push(cellDate);
                }
              } else if (viewMode === "week") {
                const start = new Date(rangeStart);
                for (let i = 0; i < 7; i++) {
                  const d = new Date(start);
                  d.setDate(start.getDate() + i);
                  cells.push(d);
                }
              } else {
                cells.push(new Date(rangeStart));
              }

              return cells.map((cell, idx) => {
                const dateKey = cell ? formatKey(cell) : `empty-${idx}`;
                const dayOcc = occurrences.filter((o) => {
                  const d = new Date(o.occDate);
                  return cell && d.getFullYear() === cell.getFullYear() && d.getMonth() === cell.getMonth() && d.getDate() === cell.getDate();
                });

                return (
                  <div
                    key={dateKey}
                    className={`cell ${cell ? "date-cell" : "blank"}`}
                    onDoubleClick={() => cell && openCreatePopup(cell)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => cell && onDropOnDate(e, formatKey(cell))}
                  >
                    {cell ? (
                      <>
                        <div className="cell-header">
                          <div className="date-side left">
                            {/* <button
                              className="side-btn"
                              onClick={(ev) => {
                                ev.stopPropagation();
                                const prev = new Date(cell);
                                prev.setDate(cell.getDate() - 1);
                                setViewDate(new Date(prev.getFullYear(), prev.getMonth(), 1));
                                setSelectedDay(prev);
                              }}
                              title="Previous day"
                            >
                              ‹
                            </button> */}
                          </div>

                          <div className="date-center">
                            <div className="date-num">{cell.getDate()}</div>
                          </div>

                          <div className="date-side right">
                            <button
                              className="side-btn"
                              onClick={(ev) => {
                                ev.stopPropagation();
                                openCreatePopup(cell);
                              }}
                              title="Add event"
                            >
                              ＋
                            </button>

                            <button
                              className="side-btn small"
                              onClick={(ev) => {
                                ev.stopPropagation();
                                setSelectedDay(cell);
                              }}
                              title="Select day"
                            >
                              ✓
                            </button>
                          </div>
                        </div>

                        <div className="cell-events">
                          {dayOcc.map((o) => (
                            <div
                              key={`${o.id}-${o.occDate}`}
                              className="event-pill"
                              draggable
                              onDragStart={(e) => onDragStart(e, o)}
                            >
                              <div className="ev-left">
                                <span className="ev-time">{o.time}</span>
                                <span className="ev-text">{o.text}</span>
                              </div>

                              <div className="ev-actions">
                                <button title="Edit" onClick={() => openEditPopup(o)} className="icon-btn" dangerouslySetInnerHTML={{__html: svgEdit}} />
                                <button title="Delete" onClick={() => deleteEventById(o)} className="icon-btn" dangerouslySetInnerHTML={{__html: svgTrash}} />
                              </div>
                            </div>
                          ))}
                        </div>
                      </>
                    ) : <div className="empty-cell" /> }
                  </div>
                );
              });
            })()}
          </div>
        </section>

        <aside className="gc-right">
          <div className="selected-head">
            <h3>{selectedDay ? selectedDay.toDateString() : "No date selected"}</h3>
            <button onClick={() => openCreatePopup(selectedDay)}>New</button>
          </div>

          <div className="selected-events">
            {selectedDay ? (
              (() => {
                const evs = [];
                for (const existingKey of Object.keys(events)) {
                  for (const ev of events[existingKey]) {
                    const occs = expandEventOccurrences(ev, selectedDay, selectedDay);
                    if (occs.length) evs.push({ ...ev, occDate: occs[0].occDate });
                  }
                }
                if (evs.length === 0) return <div className="muted">No events</div>;
                return evs.map((ev) => (
                  <div className="event-row" key={ev.id}>
                    <div>
                      <div className="time">{ev.time}</div>
                      <div className="title">{ev.text}</div>
                      <div className="meta">{ev.recurrence !== "none" ? `Repeats: ${ev.recurrence}` : ""}</div>
                    </div>
                    <div className="row-actions">
                      <button onClick={() => openEditPopup(ev)} dangerouslySetInnerHTML={{__html: svgEdit}} className="icon-btn" />
                      <button onClick={() => deleteEventById(ev)} dangerouslySetInnerHTML={{__html: svgTrash}} className="icon-btn" />
                    </div>
                  </div>
                ));
              })()
            ) : <div className="muted">Select a date to see events</div>}
          </div>
        </aside>
      </main>

      {isPopupOpen && (
        <div className="popup-wrap" onClick={() => setPopupOpen(false)}>
          <div className="popup-card" onClick={(e) => e.stopPropagation()}>
            <h4>{editingEvent ? "Edit event" : "New event"}</h4>

            <label>
              Date
              <input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
            </label>

            <label>
              Time
              <input type="time" value={form.time} onChange={(e) => setForm((f) => ({ ...f, time: e.target.value }))} />
            </label>

            <label>
              Calendar
              <select value={form.calendarId} onChange={(e) => setForm((f) => ({ ...f, calendarId: e.target.value }))}>
                {calendars.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
              </select>
            </label>

            <label>
              Text
              <input value={form.text} onChange={(e) => setForm((f) => ({ ...f, text: e.target.value }))} placeholder="Event title" />
            </label>

            <label>
              Recurrence
              <select value={form.recurrence} onChange={(e) => setForm((f) => ({ ...f, recurrence: e.target.value }))}>
                <option value="none">None</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </label>

            <label>
              Reminder (minutes before)
              <input type="number" min="0" value={form.reminderMinutes} onChange={(e) => setForm((f) => ({ ...f, reminderMinutes: Number(e.target.value) }))} />
            </label>

            <div className="popup-actions">
              <button className="btn primary" onClick={saveEvent}>Save</button>
              <button className="btn" onClick={() => setPopupOpen(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const svgEdit = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25z"/><path d="M20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0L14.13 4.96l3.75 3.75 2.83-2.67z"/></svg>`;
const svgTrash = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`;
