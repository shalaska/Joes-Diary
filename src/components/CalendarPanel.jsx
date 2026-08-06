import React, { useState, useEffect } from 'react';
import { Calendar, LogIn, LogOut, RefreshCw, AlertCircle, ChevronLeft, ChevronRight, Plus, FilePlus2, CheckCircle2 } from 'lucide-react';
import { listEventsForDay } from '../services/googleCalendarService';

const CalendarPanel = ({ isSignedIn, onSignIn, onSignOut, isConfigured, onAddEvent, onCreateNote }) => {
    const [currentDate, setCurrentDate] = useState(new Date());
    const [events, setEvents] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);
    const [isCreatingNote, setIsCreatingNote] = useState(false);
    const [noteMessage, setNoteMessage] = useState('');

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
            setNoteMessage(result?.createdNewDay ? 'Created a new diary day with this schedule.' : 'Added the schedule as a new note for this day.');
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

                <button
                    onClick={handleCreateNote}
                    disabled={isLoading || isCreatingNote || events.length === 0}
                    className="w-full flex items-center justify-center gap-2 bg-white border border-indigo-200 text-indigo-700 px-3 py-2 rounded-lg text-xs font-medium hover:bg-indigo-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    title={events.length === 0 ? 'No calendar events to add' : 'Create a diary note from this schedule'}
                >
                    {isCreatingNote ? <RefreshCw size={14} className="animate-spin" /> : <FilePlus2 size={14} />}
                    <span>{isCreatingNote ? 'Creating Note…' : 'Add Schedule to Notes'}</span>
                </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4">
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
            </div>
        </div>
    );
};

export default CalendarPanel;
