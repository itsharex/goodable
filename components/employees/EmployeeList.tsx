"use client";

import { useState, useEffect } from 'react';
import { User, Briefcase, Settings, CheckCircle } from 'lucide-react';
import type { Employee } from '@/types/backend/employee';
import EmployeeFormModal from './EmployeeFormModal';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? '';

interface EmployeeStats {
  task_count: number;
  total_tokens: number;
}

interface EmployeeListProps {
  onAssignWork?: (employee: Employee, shiftKey?: boolean) => void;
}

export default function EmployeeList({ onAssignWork }: EmployeeListProps) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [stats, setStats] = useState<Record<string, EmployeeStats>>({});
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);

  // Load employees
  const loadEmployees = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE}/api/employees`);
      if (response.ok) {
        const data = await response.json();
        setEmployees(data.data || []);
      }
    } catch (error) {
      console.error('Failed to load employees:', error);
    } finally {
      setLoading(false);
    }
  };

  // Load stats
  const loadStats = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/employees/stats`);
      if (response.ok) {
        const data = await response.json();
        setStats(data.data || {});
      }
    } catch (error) {
      console.error('Failed to load employee stats:', error);
    }
  };

  useEffect(() => {
    loadEmployees();
    loadStats();
  }, []);

  // Open create modal
  const handleCreate = () => {
    setEditingEmployee(null);
    setIsModalOpen(true);
  };

  // Open edit modal
  const handleEdit = (employee: Employee) => {
    setEditingEmployee(employee);
    setIsModalOpen(true);
  };

  // Handle save (create or update)
  const handleSave = async () => {
    setIsModalOpen(false);
    setEditingEmployee(null);
    await loadEmployees();
    setMessage({ type: 'success', text: editingEmployee ? '更新成功' : '创建成功' });
    setTimeout(() => setMessage(null), 2000);
  };

  // Handle assign work
  const handleAssignWork = (employee: Employee, shiftKey?: boolean) => {
    if (onAssignWork) {
      onAssignWork(employee, shiftKey);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-gray-900">
          数字员工墙
          <span className="ml-2 text-base font-normal text-gray-500">（{employees.length}人）</span>
        </h2>
        <button
          onClick={handleCreate}
          className="px-4 py-2 bg-black hover:bg-gray-900 text-white text-sm font-medium rounded-lg transition-colors"
        >
          + 新建
        </button>
      </div>

      {/* Message */}
      {message && (
        <div
          className={`mb-4 px-4 py-2 rounded-lg text-sm ${
            message.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Employee Wall */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="text-gray-500">加载中...</div>
        </div>
      ) : employees.length === 0 ? (
        <div className="text-center py-12">
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <User className="w-8 h-8 text-gray-400" />
          </div>
          <p className="text-gray-500">暂无员工</p>
          <p className="text-sm text-gray-400 mt-2">点击右上角新建按钮创建员工</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4">
          {employees.map((employee) => {
            const empStats = stats[employee.id];
            const taskCount = empStats?.task_count || 0;

            return (
              <div
                key={employee.id}
                className="group relative bg-white rounded-xl shadow-sm hover:shadow-lg transition-shadow border border-gray-300 overflow-hidden"
              >
                {/* Lanyard hole decoration */}
                <div className="h-2 bg-gradient-to-r from-gray-400 via-gray-500 to-gray-400 flex justify-center">
                  <div className="w-3 h-1.5 bg-gray-200 rounded-b-full" />
                </div>

                {/* Mode badge - top right */}
                <div className="absolute top-4 right-2">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                    employee.mode === 'code'
                      ? 'bg-blue-100 text-blue-600'
                      : 'bg-green-100 text-green-600'
                  }`}>
                    {employee.mode}
                  </span>
                </div>

                <div className="p-4 flex flex-col items-center">
                  {/* Avatar - circle outline only */}
                  <div className="w-20 h-20 rounded-full border-2 border-gray-300 flex items-center justify-center mb-3">
                    <User className="w-12 h-12 text-gray-500" />
                  </div>

                  {/* Position (use name as position) */}
                  <div className="font-semibold text-gray-900 text-base text-center">
                    {employee.name}
                  </div>

                  {/* Description */}
                  {employee.description && (
                    <p className="mt-1.5 text-sm text-gray-600 text-center line-clamp-2 min-h-[2.5rem]">
                      {employee.description}
                    </p>
                  )}

                  {/* Task Count */}
                  <div className="mt-2 flex items-center gap-1 text-xs text-gray-500">
                    <CheckCircle className="w-3 h-3 text-green-500" />
                    <span>已完成 {taskCount} 任务</span>
                  </div>

                  {/* Action Buttons - show on hover */}
                  <div className="mt-3 flex gap-2 w-full opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => handleAssignWork(employee, e.shiftKey)}
                      className="flex-1 px-3 py-1.5 bg-gray-700 text-white text-xs font-medium rounded-lg hover:bg-gray-600 transition-colors flex items-center justify-center gap-1"
                    >
                      <Briefcase className="w-3 h-3" />
                      派活
                    </button>
                    <button
                      onClick={() => handleEdit(employee)}
                      className="px-3 py-1.5 bg-gray-100 text-gray-700 text-xs rounded-lg hover:bg-gray-200 transition-colors flex items-center justify-center gap-1"
                    >
                      <Settings className="w-3 h-3" />
                      设置
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal */}
      <EmployeeFormModal
        open={isModalOpen}
        employee={editingEmployee}
        onClose={() => {
          setIsModalOpen(false);
          setEditingEmployee(null);
        }}
        onSave={handleSave}
      />
    </div>
  );
}
