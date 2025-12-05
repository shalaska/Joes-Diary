import React, { useState } from 'react';
import { Book, Plus, Trash2, LogOut, User, X, GripVertical, Settings } from 'lucide-react';
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
} from '@dnd-kit/core';
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    verticalListSortingStrategy,
    useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

const SortableItem = ({ id, dateStr, dayMetadata, isSelected, onSelect, onDelete, onRename, entriesForDay }) => {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 50 : 'auto',
        position: 'relative',
    };

    const [isRenaming, setIsRenaming] = useState(false);
    const [renameValue, setRenameValue] = useState(dayMetadata?.customTitle || '');

    const handleRenameSubmit = () => {
        if (renameValue.trim() !== (dayMetadata?.customTitle || '')) {
            onRename(dateStr, renameValue.trim());
        }
        setIsRenaming(false);
    };

    const displayTitle = dayMetadata?.customTitle || new Date(dateStr).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    const preview = entriesForDay[0]?.content || "No content...";
    const count = entriesForDay.length;

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={`group w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors flex flex-col gap-0.5 relative ${isSelected
                ? 'bg-indigo-50 text-indigo-900'
                : 'text-slate-600 hover:bg-slate-50'
                } ${isDragging ? 'opacity-50 shadow-lg bg-slate-100' : ''}`}
        >
            <div className="flex justify-between items-center w-full">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                    <div
                        {...attributes}
                        {...listeners}
                        className="cursor-grab active:cursor-grabbing text-slate-300 hover:text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                        <GripVertical size={14} />
                    </div>

                    {isRenaming ? (
                        <input
                            type="text"
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onBlur={handleRenameSubmit}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') handleRenameSubmit();
                                if (e.key === 'Escape') setIsRenaming(false);
                            }}
                            autoFocus
                            className="flex-1 min-w-0 bg-white border border-indigo-300 rounded px-1 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
                            onClick={(e) => e.stopPropagation()}
                        />
                    ) : (
                        <span
                            className={`font-medium truncate cursor-pointer flex-1 ${isSelected ? 'text-indigo-700' : 'text-slate-700'}`}
                            onClick={() => onSelect(dateStr)}
                            onDoubleClick={(e) => {
                                e.stopPropagation();
                                setRenameValue(dayMetadata?.customTitle || ''); // Reset to current value or empty if none
                                setIsRenaming(true);
                            }}
                            title="Double-click to rename"
                        >
                            {displayTitle}
                        </span>
                    )}
                </div>

                <div className="flex items-center gap-2 ml-2">
                    {count > 1 && (
                        <span className="text-[10px] bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded-full">
                            {count}
                        </span>
                    )}
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onDelete(dateStr);
                        }}
                        className="p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded opacity-0 group-hover:opacity-100 transition-all"
                        title="Delete all entries for this day"
                    >
                        <Trash2 size={14} />
                    </button>
                </div>
            </div>
            <span
                className="text-xs opacity-70 truncate w-full pl-6 pr-6 cursor-pointer"
                onClick={() => onSelect(dateStr)}
            >
                {preview}
            </span>
        </div>
    );
};

const Sidebar = ({ groupedEntries, dayMetadata, onUpdateDayMetadata, selectedDate, onSelectDate, onAddEntry, onDeleteDay, currentView, onViewTrash,
    onLogout,
    userEmail,
    isOpen,
    onClose,
    onSettings
}) => {
    // Sort dates based on metadata (if available) or default to date descending
    // We need to maintain a local sorted list for DnD to work smoothly
    const [sortedDates, setSortedDates] = React.useState([]);

    React.useEffect(() => {
        const dates = Object.keys(groupedEntries).sort((a, b) => {
            const metaA = dayMetadata[a];
            const metaB = dayMetadata[b];

            if (metaA?.sortIndex !== undefined && metaB?.sortIndex !== undefined) {
                return metaA.sortIndex - metaB.sortIndex;
            }
            // Default: Date descending
            return new Date(b) - new Date(a);
        });
        setSortedDates(dates);
    }, [groupedEntries, dayMetadata]);

    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 8,
            },
        }),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    );

    const handleDragEnd = (event) => {
        const { active, over } = event;

        if (active.id !== over.id) {
            setSortedDates((items) => {
                const oldIndex = items.indexOf(active.id);
                const newIndex = items.indexOf(over.id);
                const newItems = arrayMove(items, oldIndex, newIndex);

                // Update metadata for all affected items
                // Simple approach: re-assign sortIndex for everyone based on new order
                newItems.forEach((dateStr, index) => {
                    onUpdateDayMetadata(dateStr, { sortIndex: index });
                });

                return newItems;
            });
        }
    };

    const handleRename = (dateStr, newTitle) => {
        onUpdateDayMetadata(dateStr, { customTitle: newTitle });
    };

    return (
        <>
            {/* Mobile Backdrop */}
            {isOpen && (
                <div
                    className="fixed inset-0 bg-black/50 z-30 md:hidden transition-opacity"
                    onClick={onClose}
                />
            )}

            {/* Sidebar Container */}
            <div className={`
                w-64 bg-white border-r border-slate-200 h-screen flex flex-col fixed left-0 top-0 z-40
                transition-transform duration-300 ease-in-out
                ${isOpen ? 'translate-x-0' : '-translate-x-full'}
                md:translate-x-0
            `}>
                <div className="p-6 border-b border-slate-100">
                    <div className="flex items-center justify-between mb-6">
                        <div className="flex items-center gap-2 text-slate-800 font-bold text-xl">
                            <Book className="text-indigo-600" />
                            <span>JoesDiary</span>
                        </div>
                        {/* Mobile Close Button */}
                        <button
                            onClick={onClose}
                            className="md:hidden p-1 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100"
                        >
                            <X size={20} />
                        </button>
                    </div>

                    <button
                        onClick={() => {
                            onAddEntry();
                            onClose?.(); // Close sidebar on mobile when action taken
                        }}
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
                        <DndContext
                            sensors={sensors}
                            collisionDetection={closestCenter}
                            onDragEnd={handleDragEnd}
                        >
                            <SortableContext
                                items={sortedDates}
                                strategy={verticalListSortingStrategy}
                            >
                                {sortedDates.map((dateStr) => {
                                    const entriesForDay = groupedEntries[dateStr];
                                    // Guard against stale state where dateStr is in sortedDates but data is gone
                                    if (!entriesForDay) return null;

                                    return (
                                        <SortableItem
                                            key={dateStr}
                                            id={dateStr}
                                            dateStr={dateStr}
                                            dayMetadata={dayMetadata[dateStr]}
                                            entriesForDay={entriesForDay}
                                            isSelected={currentView === 'diary' && dateStr === selectedDate}
                                            onSelect={(date) => {
                                                onSelectDate(date);
                                                onClose?.();
                                            }}
                                            onDelete={onDeleteDay}
                                            onRename={handleRename}
                                        />
                                    );
                                })}
                            </SortableContext>
                        </DndContext>
                    </div>
                </div>

                <div className="p-4 border-t border-slate-100 space-y-2">
                    <button
                        onClick={() => {
                            onSettings?.();
                            onClose?.();
                        }}
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-colors"
                    >
                        <Settings size={18} />
                        <span>Settings</span>
                    </button>

                    <button
                        onClick={() => {
                            onViewTrash();
                            onClose?.();
                        }}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${currentView === 'trash'
                            ? 'bg-red-50 text-red-700 font-medium'
                            : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                            }`}
                    >
                        <Trash2 size={18} />
                        <span>Trash</span>
                    </button>

                    <div className="pt-2 border-t border-slate-100 mt-2">
                        <div className="flex items-center gap-3 px-3 py-2 text-sm text-slate-500 mb-1">
                            <User size={16} />
                            <span className="truncate max-w-[140px]" title={userEmail}>{userEmail}</span>
                        </div>
                        <button
                            onClick={onLogout}
                            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-colors"
                        >
                            <LogOut size={18} />
                            <span>Log Out</span>
                        </button>
                    </div>
                </div>
            </div>
        </>
    );
};

export default Sidebar;
