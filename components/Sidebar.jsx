import React from 'react';
import { Book, Plus, Trash2 } from 'lucide-react';

const Sidebar = ({ groupedEntries, selectedDate, onSelectDate, onAddEntry, onDeleteDay }) => {
    // groupedEntries is an object: { "Date String": [entry1, entry2] }
    // We want to sort dates descending
    const sortedDates = Object.keys(groupedEntries).sort((a, b) => new Date(b) - new Date(a));

    return (
        <div className="w-64 bg-white border-r border-slate-200 h-screen flex flex-col fixed left-0 top-0 z-10">
            <div className="p-6 border-b border-slate-100">
                <div className="flex items-center gap-2 text-slate-800 font-bold text-xl mb-6">
                    <Book className="text-indigo-600" />
                    <span>My Diary</span>
                </div>

                <button
                    onClick={onAddEntry}
                    className="w-full flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-800 text-white px-4 py-2.5 rounded-lg transition-all shadow-md hover:shadow-lg active:scale-95 text-sm font-medium"
                >
                    <Plus size={18} />
                    <span>New Entry</span>
                </button>
            </div>

            <div className="flex-1 overflow-y-auto py-4">
                <h3 className="px-6 text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                    History
                </h3>
                <div className="space-y-1 px-3">
                    {sortedDates.map((dateStr) => {
                        const isSelected = dateStr === selectedDate;
                        const entriesForDay = groupedEntries[dateStr];
                        const preview = entriesForDay[0]?.content || "No content...";
                        const count = entriesForDay.length;

                        return (
                            <div
                                key={dateStr}
                                onClick={() => onSelectDate(dateStr)}
                                className={`group w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors flex flex-col gap-0.5 cursor-pointer relative ${isSelected
                                    ? 'bg-indigo-50 text-indigo-900'
                                    : 'text-slate-600 hover:bg-slate-50'
                                    }`}
                            >
                                <div className="flex justify-between items-center w-full">
                                    <span className={`font-medium ${isSelected ? 'text-indigo-700' : 'text-slate-700'}`}>
                                        {new Date(dateStr).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                                    </span>
                                    <div className="flex items-center gap-2">
                                        {count > 1 && (
                                            <span className="text-[10px] bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded-full">
                                                {count}
                                            </span>
                                        )}
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onDeleteDay(dateStr);
                                            }}
                                            className="p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded opacity-0 group-hover:opacity-100 transition-all"
                                            title="Delete all entries for this day"
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                </div>
                                <span className="text-xs opacity-70 truncate w-full pr-6">
                                    {preview}
                                </span>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

export default Sidebar;
