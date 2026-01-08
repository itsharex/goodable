/**
 * Demo Mode Service - 演示模式：关键词触发快速项目构建
 *
 * 两层解耦设计：
 * 1. 触发层：关键词匹配 → 选择模板
 * 2. 回放层：支持两种数据源
 *    - 模板目录 mock.json（优先）
 *    - 数据库 sourceProjectId（备选）
 */

import fs from 'fs/promises';
import path from 'path';
import { getTemplateById, extractZipTemplate } from '@/lib/services/template';
import { createMessage, getMessagesByProjectId } from '@/lib/services/message';
import { streamManager } from '@/lib/services/stream';
import { serializeMessage } from '@/lib/serializers/chat';
import { previewManager } from '@/lib/services/preview';
import { PROJECTS_DIR_ABSOLUTE, TEMPLATES_DIR_ABSOLUTE } from '@/lib/config/paths';

interface DemoConfig {
  keyword: string;
  templateId?: string;       // 模式1：新建项目 + 复制模板
  sourceProjectId?: string;  // 模式2：直接在源项目回放
  deployedUrl?: string;      // 模式2：已部署的 URL
}

interface MockMessage {
  role: 'assistant' | 'user' | 'system' | 'tool';
  messageType: 'chat' | 'tool_use' | 'tool_result' | 'error' | 'info' | 'system';
  content: string;
  metadata?: Record<string, unknown>;
}

interface MockData {
  messages: MockMessage[];
}

let demoConfigCache: DemoConfig[] | null = null;

/**
 * 加载演示配置
 */
async function loadDemoConfig(): Promise<DemoConfig[]> {
  if (demoConfigCache) return demoConfigCache;

  // 优先从 templates 目录读取
  const configPaths = [
    path.join(TEMPLATES_DIR_ABSOLUTE, 'demo-config.json'),
    path.join(process.cwd(), 'templates', 'demo-config.json'),
    path.join(process.cwd(), 'data', 'demo-config.json'), // 兼容旧路径
  ];

  for (const configPath of configPaths) {
    try {
      const content = await fs.readFile(configPath, 'utf-8');
      demoConfigCache = JSON.parse(content);
      console.log(`[DemoMode] Loaded config from ${configPath}`);
      return demoConfigCache || [];
    } catch {
      continue;
    }
  }

  console.log('[DemoMode] No demo config found');
  return [];
}

/**
 * 检测是否匹配演示关键词
 */
export async function matchDemoKeyword(instruction: string): Promise<DemoConfig | null> {
  const configs = await loadDemoConfig();
  const trimmed = instruction.trim();

  for (const config of configs) {
    if (trimmed === config.keyword) {
      return config;
    }
  }
  return null;
}

/**
 * 从模板目录加载 mock.json
 */
async function loadMockFromTemplate(templateId: string): Promise<MockMessage[] | null> {
  const template = await getTemplateById(templateId);
  if (!template) return null;

  const mockPath = path.join(template.templatePath, 'mock.json');
  try {
    const content = await fs.readFile(mockPath, 'utf-8');
    const data: MockData = JSON.parse(content);
    if (Array.isArray(data.messages) && data.messages.length > 0) {
      console.log(`[DemoMode] Loaded ${data.messages.length} messages from mock.json`);
      return data.messages;
    }
  } catch {
    // mock.json 不存在或格式错误
  }
  return null;
}

/**
 * 从数据库加载消息（复用现有服务）
 */
async function loadMessagesFromDatabase(sourceProjectId: string): Promise<MockMessage[] | null> {
  const sourceMessages = await getMessagesByProjectId(sourceProjectId, 1000, 0);

  if (sourceMessages.length === 0) return null;

  console.log(`[DemoMode] Loaded ${sourceMessages.length} messages from database`);

  return sourceMessages.map(msg => {
    let metadata: Record<string, unknown> | undefined;
    if (msg.metadataJson) {
      try {
        metadata = JSON.parse(msg.metadataJson);
      } catch {}
    }
    return {
      role: msg.role as MockMessage['role'],
      messageType: msg.messageType as MockMessage['messageType'],
      content: msg.content,
      metadata,
    };
  });
}

/**
 * 复制目录（递归）
 */
async function copyDirectory(src: string, dest: string): Promise<void> {
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await fs.mkdir(destPath, { recursive: true });
      await copyDirectory(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

/**
 * 复制模板代码到项目目录
 */
async function copyTemplateToProject(templateId: string, projectId: string): Promise<boolean> {
  const template = await getTemplateById(templateId);
  if (!template) {
    console.error(`[DemoMode] Template not found: ${templateId}`);
    return false;
  }

  const targetPath = path.join(PROJECTS_DIR_ABSOLUTE, projectId);

  try {
    if (template.format === 'zip') {
      const zipPath = path.join(template.templatePath, 'project.zip');
      await extractZipTemplate(zipPath, targetPath);
      console.log(`[DemoMode] Extracted zip template to ${projectId}`);
    } else {
      await copyDirectory(template.projectPath, targetPath);
      console.log(`[DemoMode] Copied source template to ${projectId}`);
    }
    return true;
  } catch (error) {
    console.error(`[DemoMode] Failed to copy template:`, error);
    return false;
  }
}

/**
 * 回放消息（核心函数，解耦的第二层）
 * 支持 plan 模式自动确认
 */
export async function replayMessages(
  messagesToReplay: MockMessage[],
  projectId: string,
  requestId: string
): Promise<void> {
  // 找到最后一条 planning 消息的索引
  let lastPlanningIndex = -1;
  for (let i = messagesToReplay.length - 1; i >= 0; i--) {
    const meta = messagesToReplay[i].metadata;
    if (meta && (meta as Record<string, unknown>).planning === true) {
      lastPlanningIndex = i;
      break;
    }
  }

  for (let i = 0; i < messagesToReplay.length; i++) {
    const msg = messagesToReplay[i];

    // 跳过用户消息
    if (msg.role === 'user') continue;

    // 模拟延迟（500-1000ms随机）
    const delay = 500 + Math.random() * 500;
    await new Promise(resolve => setTimeout(resolve, delay));

    // 创建新消息并保存到数据库
    const newMessage = await createMessage({
      projectId,
      role: msg.role,
      messageType: msg.messageType,
      content: msg.content,
      metadata: msg.metadata,
      cliSource: 'claude',
      requestId,
    });

    // 推送 SSE
    streamManager.publish(projectId, {
      type: 'message',
      data: serializeMessage(newMessage, { requestId }),
    });

    // 如果是最后一条 planning 消息，发送 planning_completed 并等待
    if (i === lastPlanningIndex) {
      console.log(`[DemoMode] Sending planning_completed for auto-confirm`);

      // 发送 planning_completed 状态（前端会显示确认按钮）
      streamManager.publish(projectId, {
        type: 'status',
        data: {
          status: 'planning_completed',
          planMd: msg.content,
          requestId,
        },
      });

      // 延迟 1.5 秒，让前端短暂显示确认按钮
      await new Promise(resolve => setTimeout(resolve, 1500));

      // 发送 plan_approved 状态，前端会清除确认按钮
      streamManager.publish(projectId, {
        type: 'status',
        data: {
          status: 'plan_approved',
          requestId,
        },
      });

      console.log(`[DemoMode] Auto-confirmed plan, continuing replay`);
    }
  }
}

/**
 * 执行演示模式（模式1：templateId 模式）
 * 新建项目 + 复制模板 + 回放消息并保存
 */
export async function executeDemoMode(
  config: DemoConfig,
  projectId: string,
  requestId: string
): Promise<void> {
  // 如果是 sourceProjectId 模式，不应该调用这个函数
  if (!config.templateId) {
    console.error(`[DemoMode] executeDemoMode called without templateId`);
    return;
  }

  console.log(`[DemoMode] Starting demo mode (templateId) for project ${projectId}`);

  // 1. 发送 ai_thinking 状态
  streamManager.publish(projectId, {
    type: 'status',
    data: { status: 'ai_thinking', requestId },
  });

  // 2. 复制模板代码到项目目录
  const copied = await copyTemplateToProject(config.templateId!, projectId);
  if (!copied) {
    streamManager.publish(projectId, {
      type: 'status',
      data: { status: 'ai_completed', requestId },
    });
    return;
  }

  // 3. 加载消息（优先 mock.json，备选数据库）
  let messagesToReplay = await loadMockFromTemplate(config.templateId!);

  if (!messagesToReplay && config.sourceProjectId) {
    messagesToReplay = await loadMessagesFromDatabase(config.sourceProjectId);
  }

  if (!messagesToReplay || messagesToReplay.length === 0) {
    console.error(`[DemoMode] No messages to replay for template: ${config.templateId!}`);
    streamManager.publish(projectId, {
      type: 'status',
      data: { status: 'ai_completed', requestId },
    });
    return;
  }

  // 4. 回放消息（保存到数据库）
  await replayMessages(messagesToReplay, projectId, requestId);

  // 5. 发送完成状态
  streamManager.publish(projectId, {
    type: 'status',
    data: { status: 'ai_completed', requestId },
  });

  // 6. 触发预览
  await new Promise(resolve => setTimeout(resolve, 500));

  try {
    await previewManager.start(projectId);
  } catch (error) {
    console.error('[DemoMode] Failed to start preview:', error);
  }

  console.log(`[DemoMode] Demo mode completed for project ${projectId}`);
}

/**
 * 清除配置缓存（开发用）
 */
export function invalidateDemoConfigCache(): void {
  demoConfigCache = null;
}
