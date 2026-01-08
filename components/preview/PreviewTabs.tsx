'use client';

import { X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

interface Todo {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  activeForm?: string;
}

interface PreviewTabsProps {
  planContent: string | null;
  todos: Todo[];
  activeTab: 'none' | 'plan' | 'todo';
  onTabChange: (tab: 'none' | 'plan' | 'todo') => void;
  onApprovePlan?: () => void;
  pendingApproval?: boolean;
}

export default function PreviewTabs({
  planContent,
  todos,
  activeTab,
  onTabChange,
  onApprovePlan,
  pendingApproval,
}: PreviewTabsProps) {
  const hasPlan = !!planContent;
  const hasTodos = todos.length > 0;

  if (!hasPlan && !hasTodos) {
    return null;
  }

  const completedCount = todos.filter(t => t.status === 'completed').length;

  return (
    <div className="absolute inset-0 flex flex-col bg-gray-50 z-10">
      {/* 顶部标签栏 */}
      <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-gray-200">
        <div className="flex items-center gap-2">
          {hasPlan && (
            <button
              onClick={() => onTabChange('plan')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                activeTab === 'plan'
                  ? 'bg-gray-200 text-gray-900'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
              }`}
            >
              设计文档
              {pendingApproval && activeTab !== 'plan' && (
                <span className="ml-1.5 w-1.5 h-1.5 bg-orange-400 rounded-full inline-block animate-pulse" />
              )}
            </button>
          )}
          {hasTodos && (
            <button
              onClick={() => onTabChange('todo')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                activeTab === 'todo'
                  ? 'bg-gray-200 text-gray-900'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
              }`}
            >
              任务进度 {completedCount}/{todos.length}
            </button>
          )}
        </div>
        <button
          onClick={() => onTabChange('none')}
          className="w-7 h-7 flex items-center justify-center rounded-md bg-gray-100 hover:bg-gray-200 text-gray-500 hover:text-gray-700 transition-colors"
          title="关闭"
        >
          <X size={14} strokeWidth={2} />
        </button>
      </div>

      {/* 内容区域 */}
      <div className="flex-1 overflow-auto p-4">
        {/* Plan 内容 */}
        {activeTab === 'plan' && planContent && (
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="p-4">
              <div className="prose prose-sm max-w-none prose-headings:text-gray-900 prose-p:text-gray-600 prose-li:text-gray-600 prose-code:text-gray-800 prose-code:bg-gray-100 prose-code:px-1 prose-code:py-0.5 prose-code:rounded">
                <ReactMarkdown>{planContent}</ReactMarkdown>
              </div>
            </div>
          </div>
        )}

        {/* Todo 列表 */}
        {activeTab === 'todo' && (
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="divide-y divide-gray-100">
              {todos.map((todo, index) => (
                <div
                  key={index}
                  className="flex items-center gap-3 px-4 py-3"
                >
                  {/* 状态指示 */}
                  <div className="flex-shrink-0">
                    {todo.status === 'completed' ? (
                      <div className="w-4 h-4 rounded-full bg-green-500 flex items-center justify-center">
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                          <path d="M2 5L4 7L8 3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </div>
                    ) : todo.status === 'in_progress' ? (
                      <div className="w-4 h-4 rounded-full border-2 border-gray-400 border-t-transparent animate-spin" />
                    ) : (
                      <div className="w-4 h-4 rounded-full border-2 border-gray-300" />
                    )}
                  </div>
                  {/* 内容 */}
                  <p className={`text-sm ${
                    todo.status === 'completed'
                      ? 'text-gray-500'
                      : todo.status === 'in_progress'
                      ? 'text-gray-900 font-medium'
                      : 'text-gray-500'
                  }`}>
                    {todo.status === 'in_progress' ? (todo.activeForm || todo.content) : todo.content}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 底部固定按钮区域 */}
      {activeTab === 'plan' && pendingApproval && onApprovePlan && (
        <div className="flex-shrink-0 px-4 py-3 bg-white border-t border-gray-200 flex justify-end">
          <button
            onClick={onApprovePlan}
            className="px-4 py-2 text-sm font-medium rounded-md transition-colors bg-black hover:bg-gray-800 text-white"
          >
            确认执行
          </button>
        </div>
      )}
    </div>
  );
}
