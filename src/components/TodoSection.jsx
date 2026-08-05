import React, { useState } from 'react';
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    DragOverlay,
} from '@dnd-kit/core';
import {
    SortableContext,
    sortableKeyboardCoordinates,
    verticalListSortingStrategy,
    useSortable,
    arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Check, Trash2, ChevronDown, ChevronRight, ListTodo, Calendar, Plus } from 'lucide-react';

// --- Sortable Item Component ---
function SortableTodoItem({ todo, onToggle, onDelete, onSchedule }) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id: todo.id, data: { todo } });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.3 : 1,
    };

    return (
        <div
            ref={setNodeRef}
            style={style}
            {...attributes}
            {...listeners}
            className={`group flex items-start gap-3 p-3 rounded-xl bg-white border ${isDragging ? 'border-indigo-400' : 'border-slate-100'} hover:border-indigo-200 transition-all shadow-sm mb-2 cursor-grab active:cursor-grabbing touch-none`}
        >
            <button
                onClick={(e) => {
                    e.stopPropagation(); // Prevent drag start
                    onToggle(todo.id, true);
                }}
                onPointerDown={(e) => e.stopPropagation()} // Vital for dnd-kit
                className="mt-1 w-5 h-5 border-2 border-slate-300 rounded hover:border-indigo-500 transition-colors flex-shrink-0"
            />
            <span className="text-sm text-slate-700 leading-relaxed break-words flex-1 font-medium">
                {todo.text}
            </span>
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                {onSchedule && (
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onSchedule(todo);
                        }}
                        onPointerDown={(e) => e.stopPropagation()}
                        className="text-slate-400 hover:text-indigo-600 p-1.5 hover:bg-slate-50 rounded-lg transition-colors"
                        title="Schedule on Calendar"
                    >
                        <Calendar size={16} />
                    </button>
                )}
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        onDelete(todo.id);
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                    className="text-slate-400 hover:text-red-500 p-1.5 hover:bg-slate-50 rounded-lg transition-colors"
                    title="Delete Todo"
                >
                    <Trash2 size={16} />
                </button>
            </div>
        </div>
    );
}

// --- Main Component ---
const TodoSection = ({ todos, onToggle, onDelete, onSchedule, onAdd, onReorder, isPage = false }) => {
    const [isExpanded, setIsExpanded] = useState(true);
    const [newTodo, setNewTodo] = useState('');
    const [activeId, setActiveId] = useState(null);

    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 5,
            },
        }),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    );

    // Sort active todos by sortIndex (descending or ascending? lets do descending for "newest on top" or user defined)
    // Actually, if we want drag and drop logic, we should respect sortIndex.
    // Let's assume sortIndex is increasing (0, 1, 2...)
    const activeTodos = todos.filter(t => !t.completed).sort((a, b) => (b.sortIndex || 0) - (a.sortIndex || 0));

    // We display "stack" style usually, so higher sortIndex on top? 
    // Let's standardise: Higher sortIndex = "Higher Priority/Top of list".

    const completedTodos = todos.filter(t => t.completed);

    const handleSubmit = (e) => {
        e.preventDefault();
        if (newTodo.trim() && onAdd) {
            onAdd(newTodo.trim());
            setNewTodo('');
        }
    };

    const handleDragStart = (event) => {
        setActiveId(event.active.id);
    };

    const handleDragEnd = (event) => {
        const { active, over } = event;
        const activeId = active.id;
        const overId = over ? over.id : null;

        if (!overId || activeId === overId) {
            setActiveId(null);
            return;
        }

        const oldIndex = activeTodos.findIndex(t => t.id === activeId);
        const newIndex = activeTodos.findIndex(t => t.id === overId);

        if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
            const reordered = arrayMove(activeTodos, oldIndex, newIndex);

            const baseIndex = Math.max(...activeTodos.map(todo => todo.sortIndex || 0), activeTodos.length);

            const updates = reordered.map((todo, idx) => ({
                id: todo.id,
                changes: { sortIndex: baseIndex - (idx * 100) }
            }));

            if (onReorder) onReorder(updates);
        }

        setActiveId(null);
    };

    if (isPage) {
        return (
            <div className="space-y-8">
                {/* Input Form */}
                <form onSubmit={handleSubmit} className="flex gap-3 bg-slate-50 p-4 rounded-xl border border-slate-100">
                    <div className="flex-1">
                        <input
                            type="text"
                            value={newTodo}
                            onChange={(e) => setNewTodo(e.target.value)}
                            placeholder="Add a new todo..."
                            className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all shadow-sm bg-white"
                        />
                    </div>
                    <div className="flex items-center">
                        <button
                            type="submit"
                            disabled={!newTodo.trim()}
                            className="bg-indigo-600 text-white px-6 py-3 rounded-xl hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium flex items-center gap-2 whitespace-nowrap"
                        >
                            <Plus size={20} />
                            <span>Add</span>
                        </button>
                    </div>
                </form>

                {todos.length === 0 && (
                    <div className="text-center py-12 text-slate-400 italic">
                        No todos yet. Add some or extract them from your entries!
                    </div>
                )}

                <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragStart={handleDragStart}
                    onDragEnd={handleDragEnd}
                >
                    <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100 min-h-[300px]">
                        <SortableContext items={activeTodos.map(t => t.id)} strategy={verticalListSortingStrategy}>
                            <div className="space-y-2">
                                {activeTodos.map(todo => (
                                    <SortableTodoItem
                                        key={todo.id}
                                        todo={todo}
                                        onToggle={onToggle}
                                        onDelete={onDelete}
                                        onSchedule={onSchedule}
                                    />
                                ))}
                                {activeTodos.length === 0 && todos.length > 0 && (
                                    <div className="text-center py-8 text-slate-400 text-sm border-2 border-dashed border-slate-200 rounded-xl">
                                        No active todos
                                    </div>
                                )}
                            </div>
                        </SortableContext>
                    </div>

                    <DragOverlay>
                        {activeId ? (
                            <div className="flex items-start gap-4 p-4 rounded-xl bg-white border border-indigo-400 shadow-lg">
                                <span className="text-sm text-slate-700 font-medium">
                                    {todos.find(t => t.id === activeId)?.text}
                                </span>
                            </div>
                        ) : null}
                    </DragOverlay>

                </DndContext>

                {/* Completed - Full Width */}
                {completedTodos.length > 0 && (
                    <div className="pt-8 border-t border-slate-100">
                        <div className="text-sm font-semibold text-slate-400 mb-4 uppercase tracking-wide flex items-center gap-2">
                            <Check size={16} />
                            <span>Completed</span>
                            <span className="bg-slate-100 px-2 py-0.5 rounded-full text-xs">{completedTodos.length}</span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 opacity-75">
                            {completedTodos.map(todo => (
                                <div key={todo.id} className="flex items-start gap-3 p-3 rounded-xl bg-slate-50 border border-slate-100">
                                    <button
                                        onClick={() => onToggle(todo.id, false)}
                                        className="mt-1 w-5 h-5 bg-indigo-500 border-2 border-indigo-500 rounded flex items-center justify-center flex-shrink-0"
                                    >
                                        <Check size={12} className="text-white" />
                                    </button>
                                    <span className="text-sm text-slate-500 line-through leading-relaxed flex-1">
                                        {todo.text}
                                    </span>
                                    <button
                                        onClick={() => onDelete(todo.id)}
                                        className="text-slate-400 hover:text-red-500 p-1 hover:bg-white rounded transition-colors"
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        );
    }

    // --- Sidebar / Compact View (unchanged logic mostly) ---
    return (
        <div className="mb-6">
            <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="flex items-center gap-2 text-slate-500 hover:text-slate-700 font-semibold mb-2 w-full transition-colors"
            >
                {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                <ListTodo size={18} />
                <span>Todos</span>
                <span className="bg-slate-100 text-slate-600 text-xs px-2 py-0.5 rounded-full ml-auto">
                    {activeTodos.length}
                </span>
            </button>

            {isExpanded && (
                <div className="space-y-3 pl-2">
                    {todos.length === 0 && (
                        <div className="text-sm text-slate-400 italic px-2 py-1">
                            No todos yet.
                        </div>
                    )}

                    {activeTodos.map(todo => (
                        <div key={todo.id} className="group flex items-start gap-2 p-2 rounded-lg hover:bg-slate-50 transition-colors">
                            <button
                                onClick={() => onToggle(todo.id, true)}
                                className="mt-0.5 w-4 h-4 border-2 border-slate-300 rounded hover:border-indigo-500 transition-colors flex-shrink-0"
                            />
                            <span className="text-sm text-slate-700 leading-tight break-words flex-1">
                                {todo.text}
                            </span>
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                {onSchedule && (
                                    <button
                                        onClick={() => onSchedule(todo)}
                                        className="text-slate-400 hover:text-indigo-600 p-1 hover:bg-white rounded transition-colors"
                                    >
                                        <Calendar size={14} />
                                    </button>
                                )}
                                <button
                                    onClick={() => onDelete(todo.id)}
                                    className="text-slate-400 hover:text-red-500 p-1 hover:bg-white rounded transition-colors"
                                >
                                    <Trash2 size={14} />
                                </button>
                            </div>
                        </div>
                    ))}

                    {completedTodos.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-slate-100 opacity-60">
                            {completedTodos.map(todo => (
                                <div key={todo.id} className="group flex items-start gap-2 p-1">
                                    <Check size={12} className="text-slate-400 mt-1" />
                                    <span className="text-xs text-slate-400 line-through flex-1">
                                        {todo.text}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default TodoSection;
