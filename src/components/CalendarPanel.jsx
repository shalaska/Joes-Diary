import React, { useState, useEffect, useRef } from 'react';
import { Calendar, LogIn, LogOut, RefreshCw, AlertCircle, ChevronLeft, ChevronRight, Plus, Sparkles, CheckCircle2, List, Clock3 } from 'lucide-react';
import { listEventsForDay } from '../services/googleCalendarService';

const HOUR_HEIGHT = 64;
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

const formatHour = (hour) => new Date(2000, 0, 1, hour).toLocaleTimeString([], {
    hour: 'numeric',
});

const layoutTimedEvents = (events) => {
    const timedEvents = events
        .filter((event) => event.start.dateTime)
        .map((event) => ({
            event,
            start: new Date(event.start.dateTime),
            end: new Date(event.end.dateTime),
            lane: 0,
        }))
        .sort((a, b) => a.start - b.start);

    timedEvents.forEach((item, index) => {
        const occupiedLanes = new Set(
            timedEvents
                .slice(0, index)
                .filter((previous) => item.start < previous.end && item.end > previous.start)
                .map((previous) => previous.lane),
        );

        while (occupiedLanes.has(item.lane)) item.lane += 1;
    });

    return timedEvents.map((item) => {
        const overlapping = timedEvents.filter((other) => (
            item.start < other.end && item.end > other.start
        ));
        return {
            ...item,
            laneCount: Math.max(...overlapping.map((other) => other.lane)) + 1,
        };
    });
};

const CalendarPanel = ({ isSignedIn, onSignIn, onSignOut, isConfigured, onAddEvent, onCreateNote }) => {
    const [currentDate, setCurrentDate] = useState(new Date());
    const [events, setEvents] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);
    const [isCreatingNote, setIsCreatingNote] = useState(false);
    const [noteMessage, setNoteMessage] = useState('');
    const [viewMode, setViewMode] = useState(() => localStorage.getItem('calendar_view_mode') || 'agenda');
    const contentRef = useRef(null);

    const fetchEvents = async () => {
        if (!isSignedIn) return;

        setIsLoading(true);
        setError(null);
        try {
            const fetchedEvents = await listEventsForDay(currentDate);
            setEvents(fetchedEvents);
        } catch (err) {
            console.error("Calendar fetch error:", err);
            // Check for 401 Unauthorized
            if (err.status === 401 || (err.result && err.result.error && err.result.error.code === 401)) {
                setError("Session expired. Please sign in again.");
                if (onSignOut) onSignOut(); // Auto-logout from calendar
            } else {
                setError("Failed to load events. Please try again.");
            }
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        if (isSignedIn) {
            fetchEvents();
        } else {
            setEvents([]);
        }
    }, [isSignedIn, currentDate]);

    useEffect(() => {
        localStorage.setItem('calendar_view_mode', viewMode);

        if (viewMode !== 'hours' || !contentRef.current) return;

        const timedEventHours = events
            .filter((event) => event.start.dateTime)
            .map((event) => new Date(event.start.dateTime).getHours());
        const firstVisibleHour = timedEventHours.length ? Math.max(Math.min(...timedEventHours) - 1, 0) : 7;

        requestAnimationFrame(() => {
            if (contentRef.current) contentRef.current.scrollTop = firstVisibleHour * HOUR_HEIGHT;
        });
    }, [viewMode, events, currentDate]);

    const handleHourClick = (hour) => {
        const startTime = `${String(hour).padStart(2, '0')}:00`;
        onAddEvent(currentDate, startTime);
    };

    const handlePrevDay = () => {
        const newDate = new Date(currentDate);
        newDate.setDate(currentDate.getDate() - 1);
        setNoteMessage('');
        setCurrentDate(newDate);
    };

    const handleNextDay = () => {
        const newDate = new Date(currentDate);
        newDate.setDate(currentDate.getDate() + 1);
        setNoteMessage('');
        setCurrentDate(newDate);
    };

    const handleToday = () => {
        setNoteMessage('');
        setCurrentDate(new Date());
    };

    const handleCreateNote = async () => {
        if (!events.length || !onCreateNote) return;
        setIsCreatingNote(true);
        setNoteMessage('');
        try {
            const result = await onCreateNote(currentDate, events);
            setNoteMessage(result?.createdNewDay ? 'Created a new diary day from this schedule.' : 'Generated a new diary note from this schedule.');
        } catch (noteError) {
            console.error('Calendar note creation failed:', noteError);
            setNoteMessage('Could not create the schedule note. Please try again.');
        } finally {
            setIsCreatingNote(false);
        }
    };

    // ... (rendering logic updates) ...

    if (!isConfigured) {
        // ... same as before
        return (
            <div className="bg-white rounded-xl p-6 border border-slate-200 h-full flex flex-col items-center justify-center text-center">
                <Calendar size={48} className="text-slate-200 mb-4" />
                <h3 className="text-lg font-semibold text-slate-700 mb-2">Calendar Integration</h3>
                <p className="text-slate-500 text-sm mb-4">
                    Connect your Google Calendar to see your events and schedule todos.
                </p>
                <p className="text-xs text-slate-400">
                    Please set up your Google Client ID and API Key in Settings first.
                </p>
            </div>
        );
    }

    if (!isSignedIn) {
        // ... same as before
        return (
            <div className="bg-white rounded-xl p-6 border border-slate-200 h-full flex flex-col items-center justify-center text-center">
                <Calendar size={48} className="text-slate-200 mb-4" />
                <h3 className="text-lg font-semibold text-slate-700 mb-2">Connect Calendar</h3>
                <p className="text-slate-500 text-sm mb-6">
                    Sign in with Google to view your daily schedule.
                </p>
                <button
                    onClick={onSignIn}
                    className="flex items-center gap-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-6 py-2 rounded-lg font-medium transition-colors shadow-sm"
                >
                    <LogIn size={18} />
                    Sign in with Google
                </button>
            </div>
        );
    }

    const timedEventLayout = layoutTimedEvents(events);

    return (
        <div className="bg-white rounded-xl border border-slate-200 flex flex-col h-full overflow-hidden">
            {/* Header */}
            <div className="p-4 border-b border-slate-100 flex flex-col gap-4 bg-slate-50">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-slate-800 font-semibold">
                        <Calendar size={18} className="text-indigo-600" />
                        <span>Schedule</span>
                    </div>
                    <div className="flex items-center gap-1">
                        <button
                            onClick={fetchEvents}
                            disabled={isLoading}
                            className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors disabled:opacity-50"
                            title="Refresh Events"
                        >
                            <RefreshCw size={16} className={isLoading ? "animate-spin" : ""} />
                        </button>
                        <button
                            onClick={onSignOut}
                            className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                            title="Sign Out"
                        >
                            <LogOut size={16} />
                        </button>
                    </div>
                </div>

                {/* Date Navigation & Actions */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <button onClick={handlePrevDay} className="p-1 hover:bg-slate-200 rounded-md text-slate-600">
                            <ChevronLeft size={16} />
                        </button>
                        <span className="text-sm font-medium text-slate-700 min-w-[5rem] text-center cursor-pointer hover:text-indigo-600" onClick={handleToday} title="Jump to Today">
                            {currentDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                        </span>
                        <button onClick={handleNextDay} className="p-1 hover:bg-slate-200 rounded-md text-slate-600">
                            <ChevronRight size={16} />
                        </button>
                    </div>
                    <button
                        onClick={() => onAddEvent(currentDate)}
                        className="flex items-center gap-1 bg-indigo-600 text-white px-2 py-1 rounded-lg text-xs font-medium hover:bg-indigo-700 transition-colors"
                    >
                        <Plus size={14} />
                        <span>Add Event</span>
                    </button>
                </div>

                <div className="grid grid-cols-2 gap-1 rounded-lg border border-slate-200 bg-white p-1" aria-label="Schedule view">
                    <button
                        type="button"
                        onClick={() => setViewMode('agenda')}
                        className={`flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${viewMode === 'agenda'
                            ? 'bg-indigo-50 text-indigo-700 shadow-sm'
                            : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
                            }`}
                        aria-pressed={viewMode === 'agenda'}
                    >
                        <List size={14} />
                        Agenda
                    </button>
                    <button
                        type="button"
                        onClick={() => setViewMode('hours')}
                        className={`flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${viewMode === 'hours'
                            ? 'bg-indigo-50 text-indigo-700 shadow-sm'
                            : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
                            }`}
                        aria-pressed={viewMode === 'hours'}
                    >
                        <Clock3 size={14} />
                        Hours
                    </button>
                </div>

                <button
                    onClick={handleCreateNote}
                    disabled={isLoading || isCreatingNote || events.length === 0}
                    className="w-full flex items-center justify-center gap-2 bg-white border border-indigo-200 text-indigo-700 px-3 py-2 rounded-lg text-xs font-medium hover:bg-indigo-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    title={events.length === 0 ? 'No calendar events to use' : 'Use Gemini to create a diary note from this schedule'}
                >
                    {isCreatingNote ? <RefreshCw size={14} className="animate-spin" /> : <Sparkles size={14} />}
                    <span>{isCreatingNote ? 'Generating Note…' : 'Generate Day Note'}</span>
                </button>
            </div>

            {/* Content */}
            <div ref={contentRef} className="flex-1 overflow-y-auto p-4">
                {error && (
                    <div className="mb-4 p-3 bg-red-50 border border-red-100 rounded-lg flex items-start gap-2 text-red-700 text-sm">
                        <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
                        <p>{error}</p>
                    </div>
                )}

                {noteMessage && (
                    <div className={`mb-4 p-3 rounded-lg flex items-start gap-2 text-sm ${noteMessage.startsWith('Could not') ? 'bg-red-50 border border-red-100 text-red-700' : 'bg-emerald-50 border border-emerald-100 text-emerald-700'}`}>
                        <CheckCircle2 size={16} className="mt-0.5 flex-shrink-0" />
                        <p>{noteMessage}</p>
                    </div>
                )}

                {events.length === 0 && !isLoading && !error && (
                    <div className="text-center py-8 text-slate-400 italic text-sm">
                        No events for {currentDate.toDateString() === new Date().toDateString() ? 'today' : 'this day'}.
                    </div>
                )}

                {viewMode === 'agenda' ? (
                    <div className="space-y-3">
                        {events.map((event) => {
                            const start = new Date(event.start.dateTime || event.start.date);
                            const end = new Date(event.end.dateTime || event.end.date);
                            const isAllDay = !event.start.dateTime;

                            return (
                                <div key={event.id} className="group p-3 rounded-lg border border-slate-100 hover:border-indigo-200 hover:bg-slate-50 transition-all flex gap-3">
                                    <div className="flex flex-col items-center justify-start pt-1 min-w-[3rem] text-xs text-slate-500 font-medium">
                                        {isAllDay ? (
                                            <span className="bg-slate-100 px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide">All Day</span>
                                        ) : (
                                            <>
                                                <span>{start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                                <span className="text-[10px] text-slate-400">{end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                            </>
                                        )}
                                    </div>
                                    <div className="flex-1 border-l-2 border-indigo-200 pl-3">
                                        <h4 className="text-sm font-medium text-slate-800 leading-tight mb-1">{event.summary || '(No Title)'}</h4>
                                        {event.location && (
                                            <p className="text-xs text-slate-500 truncate">{event.location}</p>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <div>
                        {events.some((event) => !event.start.dateTime) && (
                            <div className="mb-3 rounded-lg border border-indigo-100 bg-indigo-50/60 p-2">
                                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-indigo-500">All day</p>
                                {events.filter((event) => !event.start.dateTime).map((event) => (
                                    <p key={event.id} className="truncate text-xs font-medium text-indigo-900">{event.summary || '(No Title)'}</p>
                                ))}
                            </div>
                        )}
                        <p className="mb-2 text-center text-[11px] text-slate-400">Tap an hour to add an event</p>
                        <div className="relative" style={{ height: `${24 * HOUR_HEIGHT}px` }}>
                            {HOURS.map((hour) => (
                                <button
                                    key={hour}
                                    type="button"
                                    onClick={() => handleHourClick(hour)}
                                    className="group absolute inset-x-0 text-left"
                                    style={{ top: `${hour * HOUR_HEIGHT}px`, height: `${HOUR_HEIGHT}px` }}
                                    title={`Add an event at ${formatHour(hour)}`}
                                >
                                    <span className="absolute left-0 top-[-7px] w-12 text-right text-[10px] font-medium text-slate-400 group-hover:text-indigo-600">
                                        {formatHour(hour)}
                                    </span>
                                    <span className="absolute left-14 right-0 top-0 border-t border-slate-200 group-hover:border-indigo-300" />
                                    <span className="absolute bottom-1 left-14 right-0 top-1 rounded-md bg-indigo-50/0 transition-colors group-hover:bg-indigo-50/70" />
                                </button>
                            ))}

                            <div className="pointer-events-none absolute inset-y-0 left-14 right-0">
                                {timedEventLayout.map(({ event, start, end, lane, laneCount }) => {
                                    const startMinutes = (start.getHours() * 60) + start.getMinutes();
                                    const durationMinutes = Math.max((end - start) / 60000, 15);
                                    const top = (startMinutes / 60) * HOUR_HEIGHT;
                                    const height = Math.max((durationMinutes / 60) * HOUR_HEIGHT, 28);

                                    return (
                                        <div
                                            key={event.id}
                                            className="absolute z-10 overflow-hidden rounded-md border border-indigo-300 bg-indigo-100 px-2 py-1 text-indigo-950 shadow-sm"
                                            style={{
                                                top: `${top}px`,
                                                height: `${height}px`,
                                                left: `${(lane / laneCount) * 100}%`,
                                                width: `calc(${100 / laneCount}% - 0.25rem)`,
                                            }}
                                        >
                                            <p className="truncate text-[11px] font-semibold leading-tight">{event.summary || '(No Title)'}</p>
                                            {height >= 42 && (
                                                <p className="mt-0.5 truncate text-[10px] text-indigo-700">
                                                    {start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}–{end.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                                                </p>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default CalendarPanel;
