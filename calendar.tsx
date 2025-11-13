import React, { useEffect, useMemo, useState } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin, { DateClickArg } from '@fullcalendar/interaction';
import { EventClickArg, EventInput, DateSelectArg } from '@fullcalendar/core';
import './Calendar.css';
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  deleteDoc,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../../firebase';

type SlotStatus = 'available' | 'booked' | 'pending';

interface CalendarEvent extends EventInput {
  id: string;
  color: string;
  status?: SlotStatus;
  studentName?: string;
  createdAt?: any;
}

function isoLocalDate(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  const Y = date.getFullYear();
  const M = pad(date.getMonth() + 1);
  const D = pad(date.getDate());
  const h = pad(date.getHours());
  const m = pad(date.getMinutes());
  const s = pad(date.getSeconds());
  return `${Y}-${M}-${D}T${h}:${m}:${s}`;
}

function ymdLocal(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function overlaps(a: CalendarEvent, b: CalendarEvent) {
  const aStart = new Date(a.start as string | Date).getTime();
  const aEnd = a.end ? new Date(a.end as string | Date).getTime() : aStart;
  const bStart = new Date(b.start as string | Date).getTime();
  const bEnd = b.end ? new Date(b.end as string | Date).getTime() : bStart;
  return aStart < bEnd && bStart < aEnd;
}

function uid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
}

const COLLECTION = 'calendarEvents';
const DEFAULT_TIMED_MINUTES = 30;

function addMinutes(date: Date, mins: number) {
  return new Date(date.getTime() + mins * 60000);
}

const Calendar = (): React.ReactElement => {
  const todayStr = ymdLocal(new Date());
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [statusFilter, setStatusFilter] = useState<'all' | SlotStatus>('all');

  const eventsRef = useMemo(() => collection(db, COLLECTION), []);
  const eventDoc = (id: string) => doc(db, COLLECTION, id);

  useEffect(() => {
    const q = query(eventsRef, orderBy('start'));
    const unsub = onSnapshot(q, (snap) => {
      const list: CalendarEvent[] = snap.docs.map((d) => {
        const data = d.data() as any;
        return {
          id: d.id,
          title: data.title,
          start: data.start,
          end: data.end ?? undefined,
          allDay: !!data.allDay,
          color: data.color ?? '#42a5f5',
          status: data.status,
          studentName: data.studentName,
          createdAt: data.createdAt,
        };
      });
      setEvents(list);
    });
    return () => unsub();
  }, [eventsRef]);

  async function saveEvents(newEvents: CalendarEvent[]) {
    const batch = writeBatch(db);
    newEvents.forEach((ev) => {
      const ref = eventDoc(ev.id);
      batch.set(ref, { ...ev, createdAt: serverTimestamp() });
    });
    await batch.commit();
  }

  async function updateEvent(id: string, patch: Partial<CalendarEvent>) {
    await updateDoc(eventDoc(id), patch as any);
  }

  async function removeEvent(id: string) {
    await deleteDoc(eventDoc(id));
  }

  const handleSelect = async (info: DateSelectArg) => {
    const title = prompt('Enter event title (timed):');
    if (!title) return;
    const ev: CalendarEvent = {
      id: uid(),
      title,
      start: info.startStr,
      end: info.endStr ?? undefined,
      allDay: !!info.allDay,
      color: '#42a5f5',
    };
    await saveEvents([ev]);
  };

  const handleDateClick = async (info: DateClickArg) => {
    const title = prompt('Enter event title:');
    if (!title) return;

    if (info.allDay) {
      const ev: CalendarEvent = {
        id: uid(),
        title,
        start: info.dateStr,
        color: '#42a5f5',
        allDay: true,
      };
      await saveEvents([ev]);
      alert(`Event added: "${title}" on ${info.dateStr}`);
      return;
    }

    const start = info.date;
    const end = addMinutes(start, DEFAULT_TIMED_MINUTES);
    const ev: CalendarEvent = {
      id: uid(),
      title,
      start: isoLocalDate(start),
      end: isoLocalDate(end),
      color: '#42a5f5',
      allDay: false,
    };
    await saveEvents([ev]);
    alert(
      `Event added: "${title}" from ${start.toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit',
      })}`
    );
  };

  const handleEventClick = async (info: EventClickArg) => {
    const evId = info.event.id;
    const ev = events.find((e) => e.id === evId);
    if (!ev) return;

    if (ev.status === 'available') {
      const name = prompt('Student name to book this slot?');
      if (!name) return;

      const candidate: CalendarEvent = { ...ev, studentName: name };
      const conflict = events.some(
        (e) =>
          e.status === 'booked' &&
          e.studentName === name &&
          overlaps(e, candidate)
      );
      if (conflict) {
        alert(`${name} already has a booked slot that overlaps.`);
        return;
      }

      await updateEvent(evId, {
        status: 'booked',
        studentName: name,
        color: '#f6c343',
      });
      return;
    }

    const del =
      typeof window !== 'undefined'
        ? window.confirm(`Delete "${info.event.title}"?`)
        : false;
    if (!del) return;
    await removeEvent(evId);
  };

  async function generateTimeSlots() {
    const dateStr = prompt('Date (YYYY-MM-DD):', ymdLocal(new Date()));
    if (!dateStr) return;

    const startHHMM = prompt('Start time (HH:MM, 24h):', '14:00') || '14:00';
    const endHHMM = prompt('End time (HH:MM, 24h):', '16:00') || '16:00';
    const slotMinStr = prompt('Slot length (minutes):', '15') || '15';
    const slotMin = Math.max(5, parseInt(slotMinStr, 10) || 15);
    const slotTitle = prompt('Slot title:', 'Conference Slot') || 'Conference Slot';

    const [sh, sm] = startHHMM.split(':').map(Number);
    const [eh, em] = endHHMM.split(':').map(Number);

    const day = new Date(dateStr + 'T00:00:00');
    const start = new Date(day);
    start.setHours(sh, sm, 0, 0);
    const end = new Date(day);
    end.setHours(eh, em, 0, 0);

    if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) {
      alert('Invalid time range.');
      return;
    }

    const created: CalendarEvent[] = [];
    for (let t = new Date(start); t < end; t = new Date(t.getTime() + slotMin * 60000)) {
      const t2 = new Date(t.getTime() + slotMin * 60000);
      if (t2 > end) break;

      const candidate: CalendarEvent = {
        id: uid(),
        title: slotTitle,
        start: isoLocalDate(t),
        end: isoLocalDate(t2),
        color: '#43a047',
        status: 'available',
      };

      const hasConflict = events.some((e) => overlaps(e, candidate));
      if (!hasConflict) created.push(candidate);
    }

    if (!created.length) {
      alert('No slots created (maybe conflicts or too short range).');
      return;
    }

    await saveEvents(created);
    alert(`Created ${created.length} slot(s).`);
  }

  const filteredEvents =
    statusFilter === 'all'
      ? events
      : events.filter((e) => e.status === statusFilter);

  const availableCount = events.filter((e) => e.status === 'available').length;
  const bookedCount = events.filter((e) => e.status === 'booked').length;
  const pendingCount = events.filter((e) => e.status === 'pending').length;

  return (
    <div className="cal-wrap">
      <div className="cal-hero">
        <div className="cal-hero-text">
          <p className="cal-eyebrow">Schedule hub</p>
          <h2 className="cal-heading">My class calendar</h2>
          <p className="cal-subtitle">
            Quickly add availability, book conferences, and keep your classroom timetable in sync.
          </p>
        </div>
        <div className="cal-stat-grid">
          <div className="cal-stat">
            <span className="cal-stat-label">Total events</span>
            <span className="cal-stat-value">{events.length}</span>
          </div>
          <div className="cal-stat">
            <span className="cal-stat-label">Available slots</span>
            <span className="cal-stat-value">{availableCount}</span>
          </div>
          <div className="cal-stat">
            <span className="cal-stat-label">Booked</span>
            <span className="cal-stat-value">{bookedCount}</span>
          </div>
          <div className="cal-stat">
            <span className="cal-stat-label">Pending</span>
            <span className="cal-stat-value">{pendingCount}</span>
          </div>
        </div>
      </div>

      <div className="cal-toolbar">
        <div className="cal-toolbar-group">
          <label className="cal-filter-label" htmlFor="statusFilter">
            Filter slots
          </label>
          <select
            id="statusFilter"
            className="cal-filter"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            aria-label="Filter by status"
          >
            <option value="all">All</option>
            <option value="available">Available</option>
            <option value="booked">Booked</option>
            <option value="pending">Pending</option>
          </select>
        </div>

        <div className="cal-toolbar-actions">
          <button
            className="btn btn-clear"
            onClick={async () => {
              if (
                typeof window !== 'undefined' &&
                !window.confirm('Remove every event from the calendar?')
              ) {
                return;
              }
              await Promise.all(events.map((e) => removeEvent(e.id)));
            }}
          >
            Clear All
          </button>

          <button
            className="btn btn-today"
            onClick={async () => {
              const title = prompt('Enter event title:');
              if (!title) return;
              await saveEvents([
                {
                  id: uid(),
                  title,
                  start: todayStr,
                  color: '#42a5f5',
                  allDay: true,
                },
              ]);
              alert(`Event added: "${title}" on ${todayStr}`);
            }}
          >
            Add Event Today
          </button>

          <button className="btn btn-primary" onClick={generateTimeSlots}>
            Generate Slots
          </button>
        </div>
      </div>

      <div className="cal-legend">
        <span className="cal-legend-item">
          <span className="cal-legend-dot status-available" />
          Available
        </span>
        <span className="cal-legend-item">
          <span className="cal-legend-dot status-booked" />
          Booked
        </span>
        <span className="cal-legend-item">
          <span className="cal-legend-dot status-pending" />
          Pending
        </span>
      </div>

      <FullCalendar
        plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
        initialView="timeGridWeek"
        height="auto"
        expandRows
        stickyHeaderDates
        dayMaxEvents
        nowIndicator
        firstDay={0}
        slotDuration="00:30:00"
        slotLabelInterval="01:00"
        slotMinTime="08:00:00"
        slotMaxTime="20:00:00"
        scrollTime="08:00:00"
        eventOverlap={false}
        navLinks
        allDaySlot={true}
        slotLabelFormat={{
          hour: 'numeric',
          minute: '2-digit',
          meridiem: 'short',
          hour12: true,
        }}
        eventTimeFormat={{
          hour: 'numeric',
          minute: '2-digit',
          meridiem: 'short',
          hour12: true,
        }}
        buttonText={{ today: 'today', month: 'month', week: 'week', day: 'day' }}
        selectable
        selectMirror
        selectMinDistance={5}
        select={handleSelect}
        dateClick={handleDateClick}
        eventClick={handleEventClick}
        editable
        events={filteredEvents as EventInput[]}
        headerToolbar={{
          left: 'prev,next today makeSlots',
          center: 'title',
          right: 'dayGridMonth,timeGridWeek,timeGridDay',
        }}
        customButtons={{
          makeSlots: { text: 'Generate Slots', click: generateTimeSlots },
        }}
        eventDrop={async (info) => {
          await updateEvent(info.event.id, {
            start: info.event.start?.toISOString() ?? undefined,
            end: info.event.end?.toISOString() ?? undefined,
            allDay: info.event.allDay ?? undefined,
          });
        }}
        eventResize={async (info) => {
          await updateEvent(info.event.id, {
            end: info.event.end?.toISOString() ?? undefined,
          });
        }}
        eventContent={(arg) => {
          const timeText = arg.timeText;
          const e = events.find((x) => x.id === arg.event.id);
          const status = e?.status ? ` • ${e.status}` : '';
          const who = e?.studentName ? ` (${e.studentName})` : '';
          return (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              {timeText && <span style={{ fontWeight: 700 }}>{timeText}</span>}
              <span>{arg.event.title}{status}{who}</span>
            </div>
          );
        }}
      />
    </div>
  );
};

export default Calendar;
