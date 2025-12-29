import React, { useState } from 'react';
import { Check, Trash2, ChevronDown, ChevronRight, ListTodo } from 'lucide-react';

const TodoSection = ({ todos, onToggle, onDelete, isPage = false }) => {
    const [isExpanded, setIsExpanded] = useState(true);

    const activeTodos = todos.filter(t => !t.completed);
    const completedTodos = todos.filter(t => t.completed);

    // if (todos.length === 0) return null; // Always render


    if (isPage) {
        return (
            <div className="space-y-4">
                {todos.length === 0 && (
                    <div className="text-center py-12 text-slate-400 italic">
                        No todos yet. Extract them from your entries!
                    </div>
                )}

                {activeTodos.length > 0 && (
                    <div className="space-y-2">
                        {activeTodos.map(todo => (
                            <div key={todo.id} className="group flex items-start gap-4 p-4 rounded-xl bg-slate-50 border border-slate-100 hover:border-indigo-200 transition-all">
                                <button
                                    onClick={() => onToggle(todo.id, true)}
                                    className="mt-1 w-5 h-5 border-2 border-slate-300 rounded hover:border-indigo-500 transition-colors flex-shrink-0"
                                />
                                <span className="text-base text-slate-700 leading-relaxed break-words flex-1">
                                    {todo.text}
                                </span>
                                <button
                                    onClick={() => onDelete(todo.id)}
                                    className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 transition-opacity p-2 hover:bg-white rounded-lg"
                                >
                                    <Trash2 size={16} />
                                </button>
                            </div>
                        ))}
                    </div>
                )}

                {completedTodos.length > 0 && (
                    <div className="pt-8">
                        <div className="text-sm font-semibold text-slate-400 mb-4 uppercase tracking-wide flex items-center gap-2">
                            <span>Completed</span>
                            <span className="bg-slate-100 px-2 py-0.5 rounded-full text-xs">{completedTodos.length}</span>
                        </div>
                        <div className="space-y-2">
                            {completedTodos.map(todo => (
                                <div key={todo.id} className="group flex items-start gap-4 p-4 rounded-xl hover:bg-slate-50 transition-colors opacity-60">
                                    <button
                                        onClick={() => onToggle(todo.id, false)}
                                        className="mt-1 w-5 h-5 bg-indigo-500 border-2 border-indigo-500 rounded flex items-center justify-center flex-shrink-0"
                                    >
                                        <Check size={12} className="text-white" />
                                    </button>
                                    <span className="text-base text-slate-500 line-through leading-relaxed break-words flex-1">
                                        {todo.text}
                                    </span>
                                    <button
                                        onClick={() => onDelete(todo.id)}
                                        className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 transition-opacity p-2 hover:bg-white rounded-lg"
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
                <div className="space-y-1 pl-2">
                    {todos.length === 0 && (
                        <div className="text-sm text-slate-400 italic px-2 py-1">
                            No todos yet. Extract them from your entries!
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
                            <button
                                onClick={() => onDelete(todo.id)}
                                className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 transition-opacity"
                            >
                                <Trash2 size={14} />
                            </button>
                        </div>
                    ))}

                    {completedTodos.length > 0 && (
                        <div className="mt-4 pt-4 border-t border-slate-100">
                            <div className="text-xs font-medium text-slate-400 mb-2 uppercase tracking-wide">Completed</div>
                            {completedTodos.map(todo => (
                                <div key={todo.id} className="group flex items-start gap-2 p-2 rounded-lg hover:bg-slate-50 transition-colors opacity-60">
                                    <button
                                        onClick={() => onToggle(todo.id, false)}
                                        className="mt-0.5 w-4 h-4 bg-indigo-500 border-2 border-indigo-500 rounded flex items-center justify-center flex-shrink-0"
                                    >
                                        <Check size={10} className="text-white" />
                                    </button>
                                    <span className="text-sm text-slate-500 line-through leading-tight break-words flex-1">
                                        {todo.text}
                                    </span>
                                    <button
                                        onClick={() => onDelete(todo.id)}
                                        className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 transition-opacity"
                                    >
                                        <Trash2 size={14} />
                                    </button>
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
