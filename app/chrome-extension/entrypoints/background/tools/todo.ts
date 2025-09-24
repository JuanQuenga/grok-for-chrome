import { createErrorResponse, ToolResult } from '@/common/tool-handler';
import { BaseBrowserToolExecutor } from './base-browser';
import { TOOL_NAMES } from 'chrome-mcp-shared';

interface TodoItem {
  id: string;
  title: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  created_at: string;
  updated_at: string;
  depends_on?: string[];
  notes?: string;
}

// In-memory storage for TODO items (persisted per session)
const todoStorage = new Map<string, TodoItem>();

class TodoCreateTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.TASK.TODO_CREATE;

  async execute(args: {
    title: string;
    priority?: string;
    depends_on?: string[];
  }): Promise<ToolResult> {
    const { title, priority = 'medium', depends_on = [] } = args;

    const id = `todo_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const now = new Date().toISOString();

    const todo: TodoItem = {
      id,
      title,
      status: 'pending',
      priority: priority as TodoItem['priority'],
      created_at: now,
      updated_at: now,
      depends_on,
    };

    todoStorage.set(id, todo);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: `Created TODO task: "${title}"`,
            todo,
          }),
        },
      ],
      isError: false,
    };
  }
}

class TodoListTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.TASK.TODO_LIST;

  async execute(args: { status?: string; priority?: string } = {}): Promise<ToolResult> {
    const { status, priority } = args;

    let todos = Array.from(todoStorage.values());

    if (status) {
      todos = todos.filter((todo) => todo.status === status);
    }

    if (priority) {
      todos = todos.filter((todo) => todo.priority === priority);
    }

    // Sort by priority (urgent > high > medium > low) then by creation time
    const priorityOrder = { urgent: 4, high: 3, medium: 2, low: 1 };
    todos.sort((a, b) => {
      const priorityDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: `Found ${todos.length} TODO items`,
            todos,
          }),
        },
      ],
      isError: false,
    };
  }
}

class TodoUpdateTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.TASK.TODO_UPDATE;

  async execute(args: {
    id: string;
    title?: string;
    status?: string;
    priority?: string;
    notes?: string;
  }): Promise<ToolResult> {
    const { id, title, status, priority, notes } = args;

    const todo = todoStorage.get(id);
    if (!todo) {
      return createErrorResponse(`TODO task with id "${id}" not found`);
    }

    if (title !== undefined) todo.title = title;
    if (status !== undefined) todo.status = status as TodoItem['status'];
    if (priority !== undefined) todo.priority = priority as TodoItem['priority'];
    if (notes !== undefined) todo.notes = notes;

    todo.updated_at = new Date().toISOString();
    todoStorage.set(id, todo);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: `Updated TODO task: "${todo.title}"`,
            todo,
          }),
        },
      ],
      isError: false,
    };
  }
}

class TodoCompleteTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.TASK.TODO_COMPLETE;

  async execute(args: { id: string; notes?: string }): Promise<ToolResult> {
    const { id, notes } = args;

    const todo = todoStorage.get(id);
    if (!todo) {
      return createErrorResponse(`TODO task with id "${id}" not found`);
    }

    todo.status = 'completed';
    if (notes) {
      todo.notes = (todo.notes ? todo.notes + '\n' : '') + `Completed: ${notes}`;
    }
    todo.updated_at = new Date().toISOString();

    todoStorage.set(id, todo);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: `Completed TODO task: "${todo.title}"`,
            todo,
          }),
        },
      ],
      isError: false,
    };
  }
}

export const todoCreateTool = new TodoCreateTool();
export const todoListTool = new TodoListTool();
export const todoUpdateTool = new TodoUpdateTool();
export const todoCompleteTool = new TodoCompleteTool();
