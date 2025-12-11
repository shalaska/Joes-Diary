import React, { useState } from 'react';
import { Check, Trash2, ChevronDown, ChevronRight, ListTodo } from 'lucide-react';

const TodoSection = ({ todos, onToggle, onDelete }) => {
    const [isExpanded, setIsExpanded] = useState(true);

    const activeTodos = todos.filter(t => !t.completed);
    const completedTodos = todos.filter(t => t.completed);

    if (todos.length === 0) return null;

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
