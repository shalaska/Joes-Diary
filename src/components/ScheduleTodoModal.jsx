import React, { useState, useEffect } from 'react';
import { X, Calendar, Clock } from 'lucide-react';

const isSameDay = (d1, d2) => (
    d1.getFullYear() === d2.getFullYear()
    && d1.getMonth() === d2.getMonth()
    && d1.getDate() === d2.getDate()
);

const ScheduleTodoModal = ({ isOpen, onClose, onSchedule, todoTitle, initialDate, initialStartTime }) => {
    // We'll use 'summary' for the event title, defaulting to todoTitle or empty
    const [summary, setSummary] = useState('');
    const [date, setDate] = useState('');
    const [startTime, setStartTime] = useState('');
    const [duration, setDuration] = useState(60); // Default 1 hour
    const [isAllDay, setIsAllDay] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState('');

    useEffect(() => {
        if (isOpen) {
            setSummary(todoTitle || '');
            const d = initialDate ? new Date(initialDate) : new Date();
            setDate(d.toISOString().split('T')[0]);

            // Use a selected timeline hour when provided; otherwise choose a sensible default.
            const now = new Date();
            if (initialStartTime) {
                setStartTime(initialStartTime);
            } else if (initialDate) {
                // If specific date passed, keep it, checking if it is today
                if (isSameDay(d, now)) {
                    const nextHour = new Date(now);
                    nextHour.setHours(now.getHours() + 1, 0, 0, 0);
                    setStartTime(nextHour.toTimeString().slice(0, 5));
                } else {
                    setStartTime("09:00");
                }
            } else {
                const nextHour = new Date(now);
                nextHour.setHours(now.getHours() + 1, 0, 0, 0);
                setStartTime(nextHour.toTimeString().slice(0, 5));
            }
            setDuration(60);
            setIsAllDay(false);
            setIsSubmitting(false);
            setSubmitError('');
        }
    }, [isOpen, todoTitle, initialDate, initialStartTime]);

    const handleSubmit = async (e) => {
        e.preventDefault();

        if (!date || (!isAllDay && !startTime) || !summary.trim()) return;

        // Construct Start/End
        let eventObject = {};

        if (isAllDay) {
            eventObject = {
                summary: summary,
                start: { date: date },
                end: { date: date } // Google requires exclusive end date for all-day? 
            };
            // Fix: Google Calendar API all-day events are exclusive of end date. 
            // If we want a 1-day event, start=2023-01-01, end=2023-01-02
            const endDateObj = new Date(date);
            endDateObj.setDate(endDateObj.getDate() + 1);
            eventObject.end.date = endDateObj.toISOString().split('T')[0];

        } else {
            const startD = new Date(`${date}T${startTime}`);
            const endD = new Date(startD.getTime() + duration * 60000);

            eventObject = {
                summary: summary,
                start: { dateTime: startD.toISOString() },
                end: { dateTime: endD.toISOString() }
            };
        }

        setIsSubmitting(true);
        setSubmitError('');
        try {
            await onSchedule(eventObject);
            onClose();
        } catch (error) {
            console.error('Unable to schedule event:', error);
            setSubmitError('Could not add this event. Check your calendar connection and try again.');
        } finally {
            setIsSubmitting(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/20 backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                    <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                        <Calendar className="text-indigo-600" size={24} />
                        {todoTitle ? 'Schedule Todo' : 'Add Event'}
                    </h2>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
                        <X size={24} />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-6">
                    {/* Event Title Input - always visible/editable now */}
                    <div className="space-y-2">
                        <label className="text-sm font-semibold text-slate-700 block">Event Title</label>
                        <input
                            type="text"
                            value={summary}
                            onChange={(e) => setSummary(e.target.value)}
                            placeholder="e.g. Meeting with scheduling team"
                            className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all font-medium"
                            autoFocus={!todoTitle} // Auto focus if blank title
                        />
                    </div>

                    {/* Date & Time Row */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label className="text-sm font-semibold text-slate-700 block gap-2 flex items-center">
                                <span className="text-slate-400"><Calendar size={14} /></span> Date
                            </label>
                            <input
                                type="date"
                                value={date}
                                onChange={(e) => setDate(e.target.value)}
                                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:border-indigo-500 transition-all text-slate-700 bg-white"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-semibold text-slate-700 block gap-2 flex items-center">
                                <span className="text-slate-400"><Clock size={14} /></span> Time
                            </label>
                            <input
                                type="time"
                                value={startTime}
                                onChange={(e) => {
                                    setStartTime(e.target.value);
                                    setIsAllDay(false);
                                }}
                                disabled={isAllDay}
                                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:border-indigo-500 transition-all text-slate-700 bg-white disabled:bg-slate-50 disabled:text-slate-400"
                            />
                        </div>
                    </div>

                    {/* Duration & All Day Row */}
                    <div className="flex items-center gap-4">
                        <div className="flex-1 space-y-2">
                            <label className="text-sm font-semibold text-slate-700 block">Duration</label>
                            <select
                                value={duration}
                                onChange={(e) => setDuration(Number(e.target.value))}
                                disabled={isAllDay}
                                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:border-indigo-500 bg-white disabled:bg-slate-50 disabled:text-slate-400"
                            >
                                <option value={15}>15 minutes</option>
                                <option value={30}>30 minutes</option>
                                <option value={45}>45 minutes</option>
                                <option value={60}>1 hour</option>
                                <option value={90}>1.5 hours</option>
                                <option value={120}>2 hours</option>
                            </select>
                        </div>

                        <label className="flex items-center gap-3 p-3 rounded-xl border border-slate-200 cursor-pointer hover:bg-slate-50 transition-colors mt-7 h-[50px]">
                            <input
                                type="checkbox"
                                checked={isAllDay}
                                onChange={(e) => setIsAllDay(e.target.checked)}
                                className="w-5 h-5 rounded text-indigo-600 focus:ring-indigo-500 border-gray-300"
                            />
                            <span className="text-sm font-medium text-slate-700">All Day</span>
                        </label>
                    </div>

                    <div className="pt-2 flex gap-3">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 px-6 py-3 rounded-xl border border-slate-200 text-slate-600 font-medium hover:bg-slate-50 transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={isSubmitting || !summary.trim() || (!date) || (!isAllDay && !startTime)}
                            className="flex-1 bg-indigo-600 text-white px-6 py-3 rounded-xl font-medium hover:bg-indigo-700 transition-colors shadow-lg shadow-indigo-200 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isSubmitting ? 'Adding…' : 'Schedule'}
                        </button>
                    </div>
                    {submitError && (
                        <p className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
                            {submitError}
                        </p>
                    )}
                </form>
            </div>
        </div>
    );
};

export default ScheduleTodoModal;
