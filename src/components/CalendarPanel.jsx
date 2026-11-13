import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Calendar, LogIn, LogOut, RefreshCw, AlertCircle, ChevronLeft, ChevronRight, Plus, Sparkles, CheckCircle2, List, Clock3, Trash2, X } from 'lucide-react';
import { listCalendars, listEventsForDay } from '../services/googleCalendarService';
import { cacheIcsEventsForDay, dedupeFeedEvents, fetchIcsEventsForDay, FeedNotConfiguredError, getCachedIcsEventsForDay, ICS_CALENDAR_ID, ICS_FEEDS, isIcsCalendarId } from '../services/icsCalendarService';
import { filterEventsForAi, getAiExcludedCalendarIds, saveAiExcludedCalendarIds } from '../utils/aiCalendarPrivacy';

const HOUR_HEIGHT = 64;
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const CALENDAR_SELECTION_KEY = 'selected_google_calendar_ids';

// Which proxy address each feed was last auto-selected for (the Work key predates the Personal feed).
const autoSelectKey = (feed) => (feed.id === ICS_CALENDAR_ID ? 'ics_proxy_auto_selected' : `ics_feed_auto_selected_${feed.id}`);

const getEventKey = (event) => `${event._calendarId || 'primary'}:${event.id}`;

const formatHour = (hour) => new Date(2000, 0, 1, hour).toLocaleTimeString([], {
    hour: 'numeric',
});

const isSameDay = (firstDate, secondDate) => (
    firstDate.getFullYear() === secondDate.getFullYear()
    && firstDate.getMonth() === secondDate.getMonth()
    && firstDate.getDate() === secondDate.getDate()
);

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

const CalendarPanel = ({ isSignedIn, onSignIn, onSignOut, isConfigured, onAddEvent, onCreateNote, onCalendarContextChange, refreshKey, onDeleteEvent, icsProxyUrl }) => {
    const [currentDate, setCurrentDate] = useState(new Date());
    const [googleEvents, setGoogleEvents] = useState([]);
    const [icsEvents, setIcsEvents] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isRefreshingIcs, setIsRefreshingIcs] = useState(false);
    const [manualRefreshKey, setManualRefreshKey] = useState(0);
    const [error, setError] = useState(null);
    const [isCreatingNote, setIsCreatingNote] = useState(false);
    const [noteMessage, setNoteMessage] = useState('');
    const [viewMode, setViewMode] = useState('hours');
    const [currentTime, setCurrentTime] = useState(() => new Date());
    const [selectedEvent, setSelectedEvent] = useState(null);
    const [isDeletingEvent, setIsDeletingEvent] = useState(false);
    const [deleteError, setDeleteError] = useState('');
    const [calendars, setCalendars] = useState([]);
    const [selectedCalendarIds, setSelectedCalendarIds] = useState([]);
    const [isCalendarPickerOpen, setIsCalendarPickerOpen] = useState(false);
    const [isLoadingCalendars, setIsLoadingCalendars] = useState(false);
    const [aiExcludedCalendarIds, setAiExcludedCalendarIds] = useState(() => getAiExcludedCalendarIds());
    // Feeds the proxy has no secret for: hidden rather than shown as errors.
    const [missingFeedIds, setMissingFeedIds] = useState([]);
    const contentRef = useRef(null);
    const eventRequestIdRef = useRef(0);
    const events = useMemo(() => [...googleEvents, ...dedupeFeedEvents(googleEvents, icsEvents)].sort((first, second) => {
        const firstStart = new Date(first.start.dateTime || first.start.date).getTime();
        const secondStart = new Date(second.start.dateTime || second.start.date).getTime();
        return firstStart - secondStart;
    }), [googleEvents, icsEvents]);
    // Only events from calendars allowed for AI are ever passed to Gemini.
    const aiEvents = useMemo(() => filterEventsForAi(events, aiExcludedCalendarIds), [events, aiExcludedCalendarIds]);

    // iCal feeds load without any Google sign-in, so they never expire. Google calendars load only
    // while the (hour-long) Google sign-in is valid; when it lapses the feeds keep showing.
    useEffect(() => {
        const requestId = ++eventRequestIdRef.current;
        const feeds = icsProxyUrl
            ? ICS_FEEDS.filter(feed => selectedCalendarIds.includes(feed.id) && !missingFeedIds.includes(feed.id))
            : [];
        const googleCalendarIds = isSignedIn ? selectedCalendarIds.filter(calendarId => !isIcsCalendarId(calendarId)) : [];
        if (!feeds.length && !googleCalendarIds.length) {
            setGoogleEvents([]);
            setIcsEvents([]);
            setIsLoading(false);
            setIsRefreshingIcs(false);
            onCalendarContextChange?.(null);
            return undefined;
        }

        setError(null);
        const calendarById = new Map(calendars.map(calendarItem => [calendarItem.id, calendarItem]));

        if (googleCalendarIds.length) {
            setIsLoading(true);
            listEventsForDay(currentDate, googleCalendarIds)
                .then(fetchedEvents => {
                    if (eventRequestIdRef.current !== requestId) return;
                    setGoogleEvents(fetchedEvents.map(event => ({
                        ...event,
                        _calendarName: calendarById.get(event._calendarId)?.summary || 'Calendar',
                        _calendarColor: calendarById.get(event._calendarId)?.backgroundColor || '#6366f1',
                    })));
                })
                .catch(err => {
                    if (eventRequestIdRef.current !== requestId) return;
                    console.error('Google Calendar fetch error:', err);
                    if (err.status === 401 || err.result?.error?.code === 401) {
                        setError(feeds.length ? 'Google sign-in expired. Your calendar feeds are still shown.' : 'Session expired. Please sign in again.');
                        onSignOut?.();
                    } else {
                        setError('Google Calendar could not be refreshed. Other events are still shown.');
                    }
                })
                .finally(() => {
                    if (eventRequestIdRef.current === requestId) setIsLoading(false);
                });
        } else {
            setGoogleEvents([]);
            setIsLoading(false);
        }

        if (feeds.length) {
            setIcsEvents([]);
            setIsRefreshingIcs(true);
            const byFeed = {};
            const show = () => {
                if (eventRequestIdRef.current === requestId) setIcsEvents(Object.values(byFeed).flat());
            };

            const loadFeed = async (feed) => {
                try {
                    const cached = await getCachedIcsEventsForDay(icsProxyUrl, currentDate, feed);
                    if (cached?.events) {
                        byFeed[feed.id] = cached.events;
                        show();
                    }
                } catch (cacheError) {
                    console.warn(`${feed.name} calendar cache could not be read:`, cacheError);
                }

                try {
                    const fetchedEvents = await fetchIcsEventsForDay(icsProxyUrl, currentDate, undefined, feed);
                    byFeed[feed.id] = fetchedEvents;
                    show();
                    try {
                        await cacheIcsEventsForDay(icsProxyUrl, currentDate, fetchedEvents, feed);
                    } catch (cacheError) {
                        console.warn(`${feed.name} calendar cache could not be saved:`, cacheError);
                    }
                } catch (icsError) {
                    if (eventRequestIdRef.current !== requestId) return;
                    if (icsError instanceof FeedNotConfiguredError) {
                        setMissingFeedIds(previous => [...new Set([...previous, feed.id])]);
                        return;
                    }
                    console.error(`${feed.name} calendar refresh error:`, icsError);
                    setError(previous => previous || `${feed.name} calendar could not be refreshed. Cached events are still shown when available.`);
                }
            };

            Promise.all(feeds.map(loadFeed)).finally(() => {
                if (eventRequestIdRef.current === requestId) setIsRefreshingIcs(false);
            });
        } else {
            setIcsEvents([]);
            setIsRefreshingIcs(false);
        }

        return () => {
            if (eventRequestIdRef.current === requestId) eventRequestIdRef.current += 1;
        };
    }, [isSignedIn, currentDate, refreshKey, manualRefreshKey, selectedCalendarIds, icsProxyUrl, calendars, missingFeedIds]);

    useEffect(() => {
        if (selectedCalendarIds.length === 0 || (!isSignedIn && !icsProxyUrl)) return;
        onCalendarContextChange?.({ date: currentDate.toISOString(), events: aiEvents });
    }, [aiEvents, currentDate, isSignedIn, icsProxyUrl, selectedCalendarIds, onCalendarContextChange]);

    // The calendar list: the proxy's iCal feeds always, plus Google calendars while signed in.
    useEffect(() => {
        if (!isSignedIn && !icsProxyUrl) {
            setCalendars([]);
            setSelectedCalendarIds([]);
            return undefined;
        }

        let isActive = true;
        const fetchCalendars = async () => {
            setIsLoadingCalendars(true);
            const feeds = icsProxyUrl ? ICS_FEEDS.filter(feed => !missingFeedIds.includes(feed.id)) : [];
            const feedCalendars = feeds.map(feed => ({
                id: feed.id,
                summary: feed.name,
                backgroundColor: feed.color,
                accessRole: 'reader',
                _isIcsSubscription: true,
                _source: feed.source,
            }));
            let googleCalendarList = [];
            try {
                if (isSignedIn) googleCalendarList = await listCalendars();
            } catch (calendarError) {
                console.error('Calendar list fetch failed:', calendarError);
                if (isActive) setError('Failed to load your Google calendars. Your calendar feeds are still shown.');
            }
            if (!isActive) return;
            const calendarList = [...googleCalendarList, ...feedCalendars];
            setCalendars(calendarList);

            let savedCalendarIds = [];
            try {
                savedCalendarIds = JSON.parse(localStorage.getItem(CALENDAR_SELECTION_KEY) || '[]');
            } catch {
                savedCalendarIds = [];
            }
            const availableIds = new Set(calendarList.map(calendarItem => calendarItem.id));
            const validSavedIds = savedCalendarIds.filter(calendarId => availableIds.has(calendarId));
            const primaryId = calendarList.find(calendarItem => calendarItem.primary)?.id;
            const fallbackIds = feedCalendars.length ? feedCalendars.map(c => c.id) : (primaryId ? [primaryId] : calendarList.slice(0, 1).map(c => c.id));
            let nextSelectedIds = validSavedIds.length ? validSavedIds : fallbackIds;

            // A feed that is new on this proxy is switched on once; after that the user's choice stands.
            const newFeeds = feeds.filter(feed => localStorage.getItem(autoSelectKey(feed)) !== icsProxyUrl);
            if (newFeeds.length) {
                nextSelectedIds = [...new Set([...nextSelectedIds, ...newFeeds.map(feed => feed.id)])];
                newFeeds.forEach(feed => localStorage.setItem(autoSelectKey(feed), icsProxyUrl));
                const stored = [...new Set([...savedCalendarIds, ...newFeeds.map(feed => feed.id)])];
                localStorage.setItem(CALENDAR_SELECTION_KEY, JSON.stringify(stored));
            }
            setSelectedCalendarIds(nextSelectedIds);
            setIsLoadingCalendars(false);
        };

        fetchCalendars();
        return () => {
            isActive = false;
        };
    }, [isSignedIn, icsProxyUrl, missingFeedIds]);

    const handleAiToggle = (calendarId) => {
        setAiExcludedCalendarIds(previous => {
            const next = previous.includes(calendarId)
                ? previous.filter(excludedId => excludedId !== calendarId)
                : [...previous, calendarId];
            saveAiExcludedCalendarIds(next);
            return next;
        });
    };

    const handleCalendarToggle = (calendarId, checked) => {
        setSelectedCalendarIds(previous => {
            const next = checked
                ? [...new Set([...previous, calendarId])]
                : previous.filter(selectedId => selectedId !== calendarId);
            if (next.length === 0) return previous;
            // Keep stored choices for calendars not listed right now (Google ones while signed out).
            let stored = [];
            try { stored = JSON.parse(localStorage.getItem(CALENDAR_SELECTION_KEY) || '[]'); } catch { stored = []; }
            const listedIds = new Set(calendars.map(calendarItem => calendarItem.id));
            localStorage.setItem(CALENDAR_SELECTION_KEY, JSON.stringify([...new Set([...stored.filter(id => !listedIds.has(id)), ...next])]));
            return next;
        });
    };

    useEffect(() => {
        if (viewMode !== 'hours' || !contentRef.current) return;

        const timedEventHours = events
            .filter((event) => event.start.dateTime)
            .map((event) => new Date(event.start.dateTime).getHours());
        const now = new Date();
        const firstVisibleHour = isSameDay(currentDate, now)
            ? Math.max(now.getHours() - 1, 0)
            : (timedEventHours.length ? Math.max(Math.min(...timedEventHours) - 1, 0) : 7);

        requestAnimationFrame(() => {
            if (contentRef.current) contentRef.current.scrollTop = firstVisibleHour * HOUR_HEIGHT;
        });
    }, [viewMode, events, currentDate]);

    useEffect(() => {
        const updateCurrentTime = () => setCurrentTime(new Date());
        const timer = window.setInterval(updateCurrentTime, 30000);
        return () => window.clearInterval(timer);
    }, []);

    // Adding an event writes to Google Calendar, so it is the one thing that needs the Google sign-in.
    const addEvent = (startTime) => {
        if (!isSignedIn) {
            if (isConfigured) onSignIn?.();
            return;
        }
        onAddEvent(currentDate, startTime);
    };

    const handleHourClick = (hour) => {
        addEvent(`${String(hour).padStart(2, '0')}:00`);
    };

    const openEventDetails = (event) => {
        setSelectedEvent(event);
        setDeleteError('');
    };

    const closeEventDetails = () => {
        if (isDeletingEvent) return;
        setSelectedEvent(null);
        setDeleteError('');
    };

    const handleDeleteEvent = async () => {
        if (!selectedEvent?.id || !onDeleteEvent) return;
        setIsDeletingEvent(true);
        setDeleteError('');
        try {
            await onDeleteEvent(selectedEvent.id, selectedEvent._calendarId || 'primary');
            setSelectedEvent(null);
        } catch (eventDeleteError) {
            console.error('Calendar event deletion failed:', eventDeleteError);
            setDeleteError('Could not delete this event. Check your calendar connection and try again.');
        } finally {
            setIsDeletingEvent(false);
        }
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
        if (!aiEvents.length || !onCreateNote) return;
        setIsCreatingNote(true);
        setNoteMessage('');
        try {
            const result = await onCreateNote(currentDate, aiEvents);
            setNoteMessage(result?.createdNewDay ? 'Created a new diary day from this schedule.' : 'Generated a new diary note from this schedule.');
        } catch (noteError) {
            console.error('Calendar note creation failed:', noteError);
            setNoteMessage('Could not create the schedule note. Please try again.');
        } finally {
            setIsCreatingNote(false);
        }
    };

    // ... (rendering logic updates) ...

    if (!isConfigured && !icsProxyUrl) {
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

    if (!isSignedIn && !icsProxyUrl) {
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
    const showCurrentTime = isSameDay(currentDate, currentTime);
    const currentTimeTop = ((currentTime.getHours() * 60) + currentTime.getMinutes()) / 60 * HOUR_HEIGHT;

    return (
        <div className="relative bg-white rounded-xl border border-slate-200 flex flex-col h-full overflow-hidden">
            {/* Header */}
            <div className="p-4 border-b border-slate-100 flex flex-col gap-4 bg-slate-50">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-slate-800 font-semibold">
                        <Calendar size={18} className="text-indigo-600" />
                        <span>Schedule</span>
                    </div>
                    <div className="flex items-center gap-1">
                        <button
                            onClick={() => setManualRefreshKey(previous => previous + 1)}
                            disabled={isLoading || isRefreshingIcs}
                            className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors disabled:opacity-50"
                            title="Refresh Events"
                        >
                            <RefreshCw size={16} className={isLoading || isRefreshingIcs ? "animate-spin" : ""} />
                        </button>
                        {isSignedIn ? (
                            <button
                                onClick={onSignOut}
                                className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                title="Sign out of Google"
                            >
                                <LogOut size={16} />
                            </button>
                        ) : isConfigured && (
                            <button
                                onClick={onSignIn}
                                className="flex items-center gap-1 px-2 py-1 text-xs text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                                title="Sign in with Google to add events and see other Google calendars"
                            >
                                <LogIn size={14} />
                                <span>Google</span>
                            </button>
                        )}
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
                        onClick={() => addEvent()}
                        disabled={!isSignedIn && !isConfigured}
                        title={isSignedIn ? 'Add an event to Google Calendar' : 'Sign in with Google to add events'}
                        className="flex items-center gap-1 disabled:opacity-50 bg-indigo-600 text-white px-2 py-1 rounded-lg text-xs font-medium hover:bg-indigo-700 transition-colors"
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

                <div className="relative">
                    <button
                        type="button"
                        onClick={() => setIsCalendarPickerOpen(previous => !previous)}
                        className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 hover:border-indigo-200 hover:text-indigo-700"
                        aria-expanded={isCalendarPickerOpen}
                    >
                        <span>Calendars</span>
                        <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-indigo-700">
                            {selectedCalendarIds.length} selected
                        </span>
                    </button>
                    {isCalendarPickerOpen && (
                        <div className="mt-2 max-h-44 space-y-1 overflow-y-auto rounded-lg border border-slate-200 bg-white p-2 shadow-sm">
                            {isLoadingCalendars ? (
                                <p className="px-2 py-1 text-xs text-slate-400">Loading calendars…</p>
                            ) : calendars.map(calendarItem => (
                                <label key={calendarItem.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs text-slate-700 hover:bg-slate-50">
                                    <input
                                        type="checkbox"
                                        checked={selectedCalendarIds.includes(calendarItem.id)}
                                        onChange={(changeEvent) => handleCalendarToggle(calendarItem.id, changeEvent.target.checked)}
                                        className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                    />
                                    <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ backgroundColor: calendarItem.backgroundColor || '#6366f1' }} />
                                    <span className="truncate">{calendarItem.summary || '(Unnamed calendar)'}</span>
                                    <span className="ml-auto flex flex-shrink-0 items-center gap-2">
                                        {calendarItem.primary && <span className="text-[10px] text-slate-400">Primary</span>}
                                        {!calendarItem.primary && ['reader', 'freeBusyReader'].includes(calendarItem.accessRole) && (
                                            <span className="text-[10px] text-slate-400">{calendarItem._isIcsSubscription ? `${calendarItem._source || 'Outlook'} feed` : 'Other'}</span>
                                        )}
                                        <button
                                            type="button"
                                            onClick={(clickEvent) => {
                                                clickEvent.preventDefault();
                                                clickEvent.stopPropagation();
                                                handleAiToggle(calendarItem.id);
                                            }}
                                            className={`flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium transition-colors ${aiExcludedCalendarIds.includes(calendarItem.id)
                                                ? 'bg-slate-100 text-slate-400 line-through hover:bg-slate-200'
                                                : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
                                                }`}
                                            aria-pressed={!aiExcludedCalendarIds.includes(calendarItem.id)}
                                            title={aiExcludedCalendarIds.includes(calendarItem.id)
                                                ? 'Events from this calendar are never sent to Gemini. Click to allow.'
                                                : 'Events from this calendar can be sent to Gemini. Click to block.'}
                                        >
                                            <Sparkles size={10} />
                                            AI
                                        </button>
                                    </span>
                                </label>
                            ))}
                        </div>
                    )}
                </div>

                <button
                    onClick={handleCreateNote}
                    disabled={isCreatingNote || aiEvents.length === 0}
                    className="w-full flex items-center justify-center gap-2 bg-white border border-indigo-200 text-indigo-700 px-3 py-2 rounded-lg text-xs font-medium hover:bg-indigo-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    title={events.length === 0
                        ? 'No calendar events to use'
                        : (aiEvents.length === 0
                            ? 'All of today’s events are on calendars blocked from AI'
                            : 'Use Gemini to create a diary note from this schedule (AI-blocked calendars are left out)')}
                >
                    {isCreatingNote ? <RefreshCw size={14} className="animate-spin" /> : <Sparkles size={14} />}
                    <span>{isCreatingNote ? 'Generating Note…' : 'Generate Day Note'}</span>
                </button>
            </div>

            {/* Content */}
            <div ref={contentRef} className="flex-1 overflow-y-auto p-4">
                {isRefreshingIcs && (
                    <div className="mb-3 flex items-center justify-center gap-1.5 text-[11px] font-medium text-slate-400">
                        <RefreshCw size={11} className="animate-spin" />
                        Refreshing Work calendar in the background…
                    </div>
                )}

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

                {events.length === 0 && !isLoading && !isRefreshingIcs && !error && (
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
                                <button
                                    key={getEventKey(event)}
                                    type="button"
                                    onClick={() => openEventDetails(event)}
                                    className="group w-full p-3 rounded-lg border border-slate-100 hover:border-indigo-200 hover:bg-slate-50 transition-all flex gap-3 text-left"
                                    style={{ borderLeftColor: event._calendarColor, borderLeftWidth: '3px' }}
                                    title="Open event options"
                                >
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
                                        <p className="mt-1 truncate text-[10px] text-slate-400">{event._calendarName}</p>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                ) : (
                    <div>
                        {events.some((event) => !event.start.dateTime) && (
                            <div className="mb-3 rounded-lg border border-indigo-100 bg-indigo-50/60 p-2">
                                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-indigo-500">All day</p>
                                {events.filter((event) => !event.start.dateTime).map((event) => (
                                    <button
                                        key={getEventKey(event)}
                                        type="button"
                                        onClick={() => openEventDetails(event)}
                                        className="block w-full truncate rounded px-1 py-0.5 text-left text-xs font-medium text-indigo-900 hover:bg-indigo-100"
                                        title="Open event options"
                                    >
                                        {event.summary || '(No Title)'}
                                    </button>
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
                                        <button
                                            key={getEventKey(event)}
                                            type="button"
                                            onClick={(clickEvent) => {
                                                clickEvent.stopPropagation();
                                                openEventDetails(event);
                                            }}
                                            className="pointer-events-auto absolute z-10 overflow-hidden rounded-md border border-indigo-300 bg-indigo-100 px-2 py-1 text-left text-indigo-950 shadow-sm transition-colors hover:border-indigo-500 hover:bg-indigo-200"
                                            style={{
                                                top: `${top}px`,
                                                height: `${height}px`,
                                                left: `${(lane / laneCount) * 100}%`,
                                                width: `calc(${100 / laneCount}% - 0.25rem)`,
                                                borderLeftColor: event._calendarColor,
                                                borderLeftWidth: '3px',
                                            }}
                                        >
                                            <p className="truncate text-[11px] font-semibold leading-tight">{event.summary || '(No Title)'}</p>
                                            {height >= 42 && (
                                                <p className="mt-0.5 truncate text-[10px] text-indigo-700">
                                                    {start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}–{end.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                                                </p>
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                            {showCurrentTime && (
                                <div
                                    className="pointer-events-none absolute left-14 right-0 z-20 border-t-2 border-rose-500"
                                    style={{ top: `${currentTimeTop}px` }}
                                    aria-label={`Current time: ${currentTime.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`}
                                >
                                    <span className="absolute -left-1.5 -top-[5px] h-2.5 w-2.5 rounded-full bg-rose-500 shadow-sm" />
                                    <span className="absolute right-full top-0 mr-2 -translate-y-1/2 whitespace-nowrap rounded bg-white px-1 text-[10px] font-semibold text-rose-600">
                                        {currentTime.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                                    </span>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {selectedEvent && (
                <div className="absolute inset-0 z-40 flex items-center justify-center bg-slate-900/20 p-4 backdrop-blur-[1px]">
                    <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-xl" role="dialog" aria-modal="true" aria-labelledby="calendar-event-title">
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <p className="text-xs font-semibold uppercase tracking-wide text-indigo-500">Calendar event</p>
                                <h3 id="calendar-event-title" className="mt-1 break-words text-lg font-semibold text-slate-900">
                                    {selectedEvent.summary || '(No Title)'}
                                </h3>
                            </div>
                            <button
                                type="button"
                                onClick={closeEventDetails}
                                disabled={isDeletingEvent}
                                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
                                aria-label="Close event options"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        <p className="mt-2 text-xs font-medium text-slate-400">{selectedEvent._calendarName}</p>
                        <p className="mt-3 text-sm text-slate-600">
                            {selectedEvent.start.dateTime ? (
                                <>
                                    {new Date(selectedEvent.start.dateTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                                    {'–'}
                                    {new Date(selectedEvent.end.dateTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                                </>
                            ) : 'All day'}
                        </p>
                        {selectedEvent.location && <p className="mt-1 text-sm text-slate-500">{selectedEvent.location}</p>}

                        {deleteError && (
                            <p className="mt-4 rounded-lg border border-red-100 bg-red-50 p-3 text-sm text-red-700" role="alert">
                                {deleteError}
                            </p>
                        )}

                        <div className="mt-5 flex gap-3">
                            <button
                                type="button"
                                onClick={closeEventDetails}
                                disabled={isDeletingEvent}
                                className="flex-1 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            {selectedEvent._readOnly ? (
                                <div className="flex flex-1 items-center justify-center rounded-xl bg-slate-100 px-4 py-2.5 text-sm font-medium text-slate-500">
                                    Read-only event
                                </div>
                            ) : (
                                <button
                                    type="button"
                                    onClick={handleDeleteEvent}
                                    disabled={isDeletingEvent}
                                    className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    {isDeletingEvent ? <RefreshCw size={15} className="animate-spin" /> : <Trash2 size={15} />}
                                    {isDeletingEvent ? 'Deleting…' : 'Delete Event'}
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default CalendarPanel;
