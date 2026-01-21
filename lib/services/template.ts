/**
 * Template Service - Template management and project creation from templates
 */

import fs from 'fs/promises';
import path from 'path';
import AdmZip from 'adm-zip';
import { TEMPLATES_DIR_ABSOLUTE, USER_TEMPLATES_DIR_ABSOLUTE, PROJECTS_DIR_ABSOLUTE } from '@/lib/config/paths';
import { db } from '@/lib/db/client';
import { projects, messages } from '@/lib/db/schema';
import { eq, asc } from 'drizzle-orm';
import { generateId } from '@/lib/utils/id';

/**
 * Template Metadata Interface
 */
export interface TemplateMetadata {
  id: string;
  name: string;
  description?: string;
  category?: string;
  tags?: string[];
  version?: string;
  author?: string;
  createdAt?: string;
  preview?: string;
  projectType?: 'nextjs' | 'python-fastapi'; // Project type, defaults to 'nextjs'
}

/**
 * Template with full path info
 */
export interface Template extends TemplateMetadata {
  templatePath: string;
  projectPath: string;
  hasPreview: boolean;
  format: 'zip' | 'source'; // Template format: zip or source directory
  isUserImported: boolean; // Whether template is user-imported
}

/**
 * In-memory cache for scanned templates
 */
let templatesCache: Template[] | null = null;
let lastScanTime: number = 0;
const CACHE_TTL = 60000; // 1 minute cache

/**
 * Scan templates directory and load all templates
 */
export async function scanTemplates(): Promise<Template[]> {
  const now = Date.now();

  // Return cached results if still valid
  if (templatesCache && (now - lastScanTime) < CACHE_TTL) {
    return templatesCache;
  }

  const templates: Template[] = [];

  // Scan both builtin and user templates
  const scanDirs = [
    { path: TEMPLATES_DIR_ABSOLUTE, isUserImported: false },
    { path: USER_TEMPLATES_DIR_ABSOLUTE, isUserImported: true },
  ];

  for (const { path: scanDir, isUserImported } of scanDirs) {
    try {
      // Check if directory exists
      const dirExists = await fs.access(scanDir).then(() => true).catch(() => false);
      if (!dirExists) {
        console.log(`[TemplateService] Templates directory not found: ${scanDir}`);
        continue;
      }

      // Read all subdirectories
      const entries = await fs.readdir(scanDir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const templateId = entry.name;

        // Skip temporary import directories
        if (templateId.startsWith('temp-')) {
          continue;
        }

        const templatePath = path.join(scanDir, templateId);
        const metadataPath = path.join(templatePath, 'template.json');
        const projectZipPath = path.join(templatePath, 'project.zip');
        const projectPath = path.join(templatePath, 'project');

        // Check if template.json exists
        const hasMetadata = await fs.access(metadataPath).then(() => true).catch(() => false);
        if (!hasMetadata) {
          console.warn(`[TemplateService] Skipping ${templateId}: missing template.json`);
          continue;
        }

        // Check template format: prefer zip over source directory
        const hasZip = await fs.access(projectZipPath).then(() => true).catch(() => false);
        const hasProject = await fs.access(projectPath).then(() => true).catch(() => false);

        if (!hasZip && !hasProject) {
          console.warn(`[TemplateService] Skipping ${templateId}: missing both project.zip and project/ directory`);
          continue;
        }

        const format: 'zip' | 'source' = hasZip ? 'zip' : 'source';

        // Read and parse metadata
        try {
          const metadataContent = await fs.readFile(metadataPath, 'utf-8');
          const metadata: TemplateMetadata = JSON.parse(metadataContent);

          // Validate required fields
          if (!metadata.id || !metadata.name) {
            console.warn(`[TemplateService] Skipping ${templateId}: missing required fields (id, name)`);
            continue;
          }

          // Check if preview image exists
          const previewPath = metadata.preview
            ? path.join(templatePath, metadata.preview)
            : path.join(templatePath, 'preview.png');
          const hasPreview = await fs.access(previewPath).then(() => true).catch(() => false);

          templates.push({
            ...metadata,
            templatePath,
            projectPath,
            hasPreview,
            format,
            isUserImported,
          });

          console.log(`[TemplateService] ✅ Loaded template: ${metadata.name} (${templateId}) [${format}] ${isUserImported ? '[USER]' : '[BUILTIN]'}`);
        } catch (error) {
          console.error(`[TemplateService] Failed to parse ${templateId}/template.json:`, error);
          continue;
        }
      }
    } catch (error) {
      console.error(`[TemplateService] Failed to scan ${scanDir}:`, error);
    }
  }

  console.log(`[TemplateService] Scanned ${templates.length} templates`);
  templatesCache = templates;
  lastScanTime = now;

  return templates;
}

/**
 * Get all available templates
 */
export async function getAllTemplates(): Promise<Template[]> {
  return await scanTemplates();
}

/**
 * Get template by ID
 */
export async function getTemplateById(templateId: string): Promise<Template | null> {
  const templates = await scanTemplates();
  return templates.find(t => t.id === templateId) || null;
}

/**
 * Copy directory recursively (including all files)
 */
async function copyDirectory(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });

  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDirectory(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

/**
 * Extract zip template to target directory
 * Requires zip to have a single wrapper directory containing project files
 */
export async function extractZipTemplate(zipPath: string, targetPath: string): Promise<void> {
  try {
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(targetPath, true);
    console.log(`[TemplateService] Extracted ${zipPath} to ${targetPath}`);

    // Check for wrapper directory (standard zip format)
    const entries = await fs.readdir(targetPath, { withFileTypes: true });
    const visibleEntries = entries.filter(e => !e.name.startsWith('.'));
    const directories = visibleEntries.filter(e => e.isDirectory());

    // If only one directory exists, unwrap it
    if (directories.length === 1 && visibleEntries.length === 1) {
      const wrapperDir = directories[0];
      const wrapperPath = path.join(targetPath, wrapperDir.name);
      const tempPath = path.join(targetPath, '..', `temp-unwrap-${Date.now()}`);

      console.log(`[TemplateService] Unwrapping directory: ${wrapperDir.name}`);

      await fs.rename(wrapperPath, tempPath);

      const innerEntries = await fs.readdir(tempPath, { withFileTypes: true });
      for (const entry of innerEntries) {
        const srcPath = path.join(tempPath, entry.name);
        const destPath = path.join(targetPath, entry.name);
        await fs.rename(srcPath, destPath);
      }

      await fs.rmdir(tempPath);
      console.log(`[TemplateService] ✅ Unwrapped wrapper directory`);
    }
  } catch (error) {
    console.error(`[TemplateService] Failed to extract zip:`, error);
    throw new Error(`Failed to extract template zip: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Create project from template
 */
export async function createProjectFromTemplate(
  templateId: string,
  projectName?: string
): Promise<{ projectId: string; name: string }> {
  // Get template
  const template = await getTemplateById(templateId);
  if (!template) {
    throw new Error(`Template not found: ${templateId}`);
  }

  // Generate project ID
  const timestamp = Date.now();
  const randomStr = Math.random().toString(36).substring(2, 15);
  const projectId = `project-${timestamp}-${randomStr}`;

  // Use template name as default project name
  const finalProjectName = projectName || template.name;

  // Target project path
  const targetPath = path.join(PROJECTS_DIR_ABSOLUTE, projectId);

  try {
    // Extract or copy template based on format
    if (template.format === 'zip') {
      console.log(`[TemplateService] Extracting zip template ${templateId} to ${projectId}...`);
      const zipPath = path.join(template.templatePath, 'project.zip');
      await extractZipTemplate(zipPath, targetPath);
    } else {
      console.log(`[TemplateService] Copying source template ${templateId} to ${projectId}...`);
      await copyDirectory(template.projectPath, targetPath);
    }

    // Update package.json name if exists
    const packageJsonPath = path.join(targetPath, 'package.json');
    const hasPackageJson = await fs.access(packageJsonPath).then(() => true).catch(() => false);

    if (hasPackageJson) {
      try {
        const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
        packageJson.name = projectId;
        await fs.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n', 'utf-8');
        console.log(`[TemplateService] Updated package.json name to ${projectId}`);
      } catch (error) {
        console.warn(`[TemplateService] Failed to update package.json:`, error);
      }
    }

    // Create project record in database
    const projectType = template.projectType || 'nextjs'; // Default to 'nextjs' if not specified
    const nowIso = new Date().toISOString();
    await db.insert(projects).values({
      id: projectId,
      name: finalProjectName,
      description: `从模板创建: ${template.name}`,
      repoPath: targetPath,
      status: 'idle',
      templateType: 'nextjs',
      fromTemplate: templateId,
      projectType: projectType,
      planConfirmed: true, // 模板项目跳过 plan 确认
      createdAt: nowIso,
      updatedAt: nowIso,
      lastActiveAt: nowIso,
    });

    // Create welcome message
    const welcomeMessage = `🎉 **${template.name}** 项目已经复制成功！

您现在可以：
- 点击右侧 **▶ 启动** 按钮预览项目效果
- 在下方输入框中继续与 AI 对话，修改和完善代码
- 查看右侧项目文件，了解项目结构

开始探索和定制您的项目吧！`;

    await db.insert(messages).values({
      id: generateId(),
      projectId,
      role: 'assistant',
      messageType: 'chat',
      content: welcomeMessage,
      cliSource: 'system',
      createdAt: nowIso,
    });

    console.log(`[TemplateService] ✅ Created project ${projectId} from template ${templateId}`);

    return {
      projectId,
      name: finalProjectName,
    };
  } catch (error) {
    // Cleanup on failure
    try {
      await fs.rm(targetPath, { recursive: true, force: true });
    } catch {}

    console.error(`[TemplateService] Failed to create project from template:`, error);
    throw new Error(`Failed to create project from template: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Invalidate templates cache (useful for development)
 */
export function invalidateTemplatesCache(): void {
  templatesCache = null;
  lastScanTime = 0;
  console.log('[TemplateService] Cache invalidated');
}

/**
 * Files and directories to exclude when exporting project as template
 */
const EXPORT_EXCLUDE_PATTERNS = {
  // Common excludes
  common: [
    '.env',
    '.env.local',
    '.env.*.local',
    '.git',
    '*.db',
    '*.sqlite',
    '*.sqlite3',
    '*.db-journal',
  ],
  // Next.js specific
  nextjs: [
    'node_modules',
    '.next',
    '.turbo',
    '.pnpm-store',
    'out',
  ],
  // Python specific
  'python-fastapi': [
    '.venv',
    'venv',
    '__pycache__',
    '*.pyc',
    '*.pyo',
    '*.pyd',
    '.pytest_cache',
    '*.egg-info',
  ],
};

/**
 * Check if a file/directory should be excluded from export
 */
function shouldExclude(name: string, projectType: 'nextjs' | 'python-fastapi'): boolean {
  const patterns = [
    ...EXPORT_EXCLUDE_PATTERNS.common,
    ...EXPORT_EXCLUDE_PATTERNS[projectType],
  ];

  for (const pattern of patterns) {
    // Exact match
    if (pattern === name) return true;
    // Glob pattern match (simple * wildcard)
    if (pattern.includes('*')) {
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
      if (regex.test(name)) return true;
    }
  }
  return false;
}

/**
 * Recursively add directory contents to zip, excluding specified patterns
 */
async function addDirectoryToZip(
  zip: AdmZip,
  dirPath: string,
  zipPath: string,
  projectType: 'nextjs' | 'python-fastapi'
): Promise<void> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    if (shouldExclude(entry.name, projectType)) {
      console.log(`[TemplateService] Excluding: ${entry.name}`);
      continue;
    }

    const fullPath = path.join(dirPath, entry.name);
    const entryZipPath = zipPath ? `${zipPath}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      await addDirectoryToZip(zip, fullPath, entryZipPath, projectType);
    } else if (entry.isFile()) {
      const content = await fs.readFile(fullPath);
      zip.addFile(entryZipPath, content);
    }
  }
}

/**
 * Generate template ID from project name (slugify)
 */
function generateTemplateId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^\w\u4e00-\u9fa5-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    || `template-${Date.now()}`;
}

/**
 * Export project as template zip
 */
export async function exportProjectAsTemplate(
  projectId: string,
  options?: {
    templateId?: string;
    name?: string;
    description?: string;
    author?: string;
    version?: string;
  }
): Promise<Buffer> {
  // Get project from database
  const project = await db.query.projects.findFirst({
    where: (p, { eq }) => eq(p.id, projectId),
  });

  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }

  if (!project.repoPath) {
    throw new Error(`Project has no repo path: ${projectId}`);
  }

  // Check if project directory exists
  const dirExists = await fs.access(project.repoPath).then(() => true).catch(() => false);
  if (!dirExists) {
    throw new Error(`Project directory not found: ${project.repoPath}`);
  }

  const projectType = (project.projectType || 'nextjs') as 'nextjs' | 'python-fastapi';
  const templateId = options?.templateId || generateTemplateId(project.name);
  const templateName = options?.name || project.name;
  const templateDescription = options?.description || project.description || '';

  // Create template metadata
  const metadata: TemplateMetadata = {
    id: templateId,
    name: templateName,
    description: templateDescription,
    projectType,
    version: options?.version || '1.0.0',
    author: options?.author || '',
    createdAt: new Date().toISOString().split('T')[0],
  };

  // Create zip
  const zip = new AdmZip();

  // Add template.json
  zip.addFile('template.json', Buffer.from(JSON.stringify(metadata, null, 2), 'utf-8'));

  // Export messages as mock.json for replay
  const projectMessages = await db.select()
    .from(messages)
    .where(eq(messages.projectId, projectId))
    .orderBy(asc(messages.createdAt));

  if (projectMessages.length > 0) {
    const mockMessages = projectMessages.map(msg => {
      const result: {
        role: string;
        messageType: string;
        content: string;
        metadata?: Record<string, unknown>;
      } = {
        role: msg.role,
        messageType: msg.messageType,
        content: msg.content,
      };

      // Parse and include metadata if exists
      if (msg.metadataJson) {
        try {
          result.metadata = JSON.parse(msg.metadataJson);
        } catch {
          // Ignore parse errors
        }
      }

      return result;
    });

    const mockData = { messages: mockMessages };
    zip.addFile('mock.json', Buffer.from(JSON.stringify(mockData, null, 2), 'utf-8'));
    console.log(`[TemplateService] Added mock.json with ${mockMessages.length} messages`);
  }

  // Add project files under project/ directory
  await addDirectoryToZip(zip, project.repoPath, 'project', projectType);

  console.log(`[TemplateService] ✅ Exported project ${projectId} as template ${templateId}`);

  return zip.toBuffer();
}

/**
 * Compare semantic versions (simple implementation)
 * Returns: -1 if v1 < v2, 0 if equal, 1 if v1 > v2
 */
function compareVersions(v1: string, v2: string): number {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);

  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const part1 = parts1[i] || 0;
    const part2 = parts2[i] || 0;

    if (part1 < part2) return -1;
    if (part1 > part2) return 1;
  }

  return 0;
}

/**
 * Validate zip file path for security
 */
function isSecurePath(filepath: string): boolean {
  const normalized = path.normalize(filepath);
  return !normalized.includes('..');
}

/**
 * Import template from zip file
 * Requires zip to have a wrapper directory containing template files
 */
export async function importTemplate(zipBuffer: Buffer): Promise<{ success: boolean; message: string; templateId?: string }> {
  const tempExtractPath = path.join(USER_TEMPLATES_DIR_ABSOLUTE, `temp-import-${Date.now()}`);

  try {
    // Check file size (10MB limit)
    const maxSize = 10 * 1024 * 1024;
    if (zipBuffer.length > maxSize) {
      return { success: false, message: `文件大小超过限制 (${(zipBuffer.length / 1024 / 1024).toFixed(2)}MB > 10MB)` };
    }

    // Extract zip to temp directory
    const zip = new AdmZip(zipBuffer);
    const zipEntries = zip.getEntries();

    // Security check: validate all paths
    for (const entry of zipEntries) {
      if (!isSecurePath(entry.entryName)) {
        return { success: false, message: '检测到不安全的文件路径' };
      }
    }

    zip.extractAllTo(tempExtractPath, true);
    console.log(`[TemplateService] Extracted zip to temp: ${tempExtractPath}`);

    // Check for wrapper directory (standard zip format requires one)
    const entries = await fs.readdir(tempExtractPath, { withFileTypes: true });
    const visibleEntries = entries.filter(e => !e.name.startsWith('.'));
    const directories = visibleEntries.filter(e => e.isDirectory());

    if (directories.length !== 1 || visibleEntries.length !== 1) {
      await fs.rm(tempExtractPath, { recursive: true, force: true });
      return { success: false, message: 'zip 包格式错误：必须包含一个外层文件夹' };
    }

    const wrapperDir = directories[0];
    const templateRoot = path.join(tempExtractPath, wrapperDir.name);
    console.log(`[TemplateService] Found wrapper directory: ${wrapperDir.name}`);

    // Read template.json from wrapper directory
    const metadataPath = path.join(templateRoot, 'template.json');
    const metadataExists = await fs.access(metadataPath).then(() => true).catch(() => false);

    if (!metadataExists) {
      await fs.rm(tempExtractPath, { recursive: true, force: true });
      return { success: false, message: '缺少 template.json 文件' };
    }

    const metadataContent = await fs.readFile(metadataPath, 'utf-8');
    const metadata: TemplateMetadata = JSON.parse(metadataContent);

    // Validate required fields
    if (!metadata.id || !metadata.name || !metadata.version) {
      await fs.rm(tempExtractPath, { recursive: true, force: true });
      return { success: false, message: 'template.json 缺少必需字段 (id, name, version)' };
    }

    if (!metadata.projectType) {
      await fs.rm(tempExtractPath, { recursive: true, force: true });
      return { success: false, message: 'template.json 缺少 projectType 字段' };
    }

    // Check if project.zip or project/ exists
    const projectZipPath = path.join(templateRoot, 'project.zip');
    const projectPath = path.join(templateRoot, 'project');
    const hasZip = await fs.access(projectZipPath).then(() => true).catch(() => false);
    const hasProject = await fs.access(projectPath).then(() => true).catch(() => false);

    if (!hasZip && !hasProject) {
      await fs.rm(tempExtractPath, { recursive: true, force: true });
      return { success: false, message: '缺少 project.zip 或 project/ 目录' };
    }

    // Check for existing template with same ID
    const existingTemplates = await scanTemplates();
    const existingTemplate = existingTemplates.find(t => t.id === metadata.id);

    if (existingTemplate) {
      // Compare versions
      if (!existingTemplate.version) {
        await fs.rm(tempExtractPath, { recursive: true, force: true });
        return { success: false, message: `模板 ${metadata.id} 已存在但缺少版本信息，无法升级` };
      }

      const versionCompare = compareVersions(metadata.version, existingTemplate.version);

      if (versionCompare < 0) {
        await fs.rm(tempExtractPath, { recursive: true, force: true });
        return { success: false, message: `不允许降级 (当前版本: ${existingTemplate.version}, 导入版本: ${metadata.version})` };
      }

      if (versionCompare === 0) {
        await fs.rm(tempExtractPath, { recursive: true, force: true });
        return { success: false, message: `模板 ${metadata.id} 版本 ${metadata.version} 已存在` };
      }

      // Version is higher, remove old template
      if (existingTemplate.isUserImported) {
        console.log(`[TemplateService] Removing old version ${existingTemplate.version} of ${metadata.id}`);
        await fs.rm(existingTemplate.templatePath, { recursive: true, force: true });
      } else {
        await fs.rm(tempExtractPath, { recursive: true, force: true });
        return { success: false, message: `无法覆盖内置模板 ${metadata.id}` };
      }
    }

    // Move to final location (move the wrapper content, not the temp dir)
    const finalPath = path.join(USER_TEMPLATES_DIR_ABSOLUTE, metadata.id);
    await fs.rename(templateRoot, finalPath);
    await fs.rm(tempExtractPath, { recursive: true, force: true });

    console.log(`[TemplateService] ✅ Imported template: ${metadata.name} (${metadata.id}) v${metadata.version}`);

    // Invalidate cache
    invalidateTemplatesCache();

    return {
      success: true,
      message: `成功导入模板 ${metadata.name} v${metadata.version}`,
      templateId: metadata.id,
    };
  } catch (error) {
    // Cleanup on error
    try {
      await fs.rm(tempExtractPath, { recursive: true, force: true });
    } catch {}

    console.error('[TemplateService] Failed to import template:', error);
    return {
      success: false,
      message: error instanceof Error ? error.message : '导入失败',
    };
  }
}
