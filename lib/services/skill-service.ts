/**
 * Skill Service - Manage skills for Claude SDK
 */

import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import matter from 'gray-matter';
import AdmZip from 'adm-zip';
import {
  SKILLS_DIR_ABSOLUTE,
  USER_SKILLS_DIR_ABSOLUTE,
} from '@/lib/config/paths';

export interface SkillMeta {
  name: string;
  displayName?: string;
  description: string;
  path: string;
  source: 'builtin' | 'user';
  size: number;
}

// Flag to track if builtin skills have been initialized in this process
let builtinSkillsInitialized = false;

/**
 * Copy directory recursively, skip node_modules
 */
async function copyDirSkipNodeModules(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    // Skip node_modules directory
    if (entry.name === 'node_modules') {
      continue;
    }

    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDirSkipNodeModules(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

/**
 * Copy a builtin skill to user-skills directory (overwrite if exists)
 */
async function ensureSkillInUserDir(builtinSkillPath: string, skillName: string): Promise<void> {
  const targetDir = path.join(USER_SKILLS_DIR_ABSOLUTE, skillName);

  // Always overwrite to ensure latest version
  if (fsSync.existsSync(targetDir)) {
    // Remove old files but preserve node_modules if exists
    const nodeModulesPath = path.join(targetDir, 'node_modules');
    const hasNodeModules = fsSync.existsSync(nodeModulesPath);

    if (hasNodeModules) {
      // Preserve node_modules: remove all other files/dirs first
      const entries = await fs.readdir(targetDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name !== 'node_modules') {
          await fs.rm(path.join(targetDir, entry.name), { recursive: true, force: true });
        }
      }
    } else {
      await fs.rm(targetDir, { recursive: true, force: true });
    }
  }

  await copyDirSkipNodeModules(builtinSkillPath, targetDir);
  console.log(`[SkillService] Copied builtin skill to user-skills: ${skillName}`);
}

/**
 * Initialize all builtin skills to user-skills directory
 * Called on app startup, only runs once per process
 */
export async function initializeBuiltinSkills(): Promise<void> {
  // Skip if already initialized in this process
  if (builtinSkillsInitialized) {
    return;
  }

  if (!fsSync.existsSync(SKILLS_DIR_ABSOLUTE)) {
    console.log('[SkillService] Builtin skills directory not found, skipping initialization');
    builtinSkillsInitialized = true;
    return;
  }

  try {
    const entries = await fs.readdir(SKILLS_DIR_ABSOLUTE, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillPath = path.join(SKILLS_DIR_ABSOLUTE, entry.name);
      const skillMdPath = path.join(skillPath, 'SKILL.md');

      if (fsSync.existsSync(skillMdPath)) {
        await ensureSkillInUserDir(skillPath, entry.name);
      }
    }
    console.log('[SkillService] Builtin skills initialization completed');
    builtinSkillsInitialized = true;
  } catch (error) {
    console.error('[SkillService] Error initializing builtin skills:', error);
  }
}

/**
 * Calculate directory size recursively
 */
async function getDirSize(dirPath: string): Promise<number> {
  let totalSize = 0;
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        totalSize += await getDirSize(fullPath);
      } else {
        const stat = await fs.stat(fullPath);
        totalSize += stat.size;
      }
    }
  } catch {
    // Ignore errors
  }
  return totalSize;
}

/**
 * Parse SKILL.md frontmatter
 */
async function parseSkillMd(skillPath: string): Promise<{ name: string; displayName?: string; description: string } | null> {
  const skillMdPath = path.join(skillPath, 'SKILL.md');
  try {
    const content = await fs.readFile(skillMdPath, 'utf-8');
    const { data } = matter(content);
    if (data.name && data.description) {
      return {
        name: String(data.name),
        displayName: data.displayName ? String(data.displayName) : undefined,
        description: String(data.description),
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Scan skills from a directory
 */
async function scanSkillsFromDir(
  dirPath: string,
  source: 'builtin' | 'user'
): Promise<SkillMeta[]> {
  const skills: SkillMeta[] = [];

  try {
    if (!fsSync.existsSync(dirPath)) {
      return skills;
    }

    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillPath = path.join(dirPath, entry.name);
      const parsed = await parseSkillMd(skillPath);

      if (parsed) {
        const size = await getDirSize(skillPath);
        skills.push({
          name: parsed.name,
          displayName: parsed.displayName,
          description: parsed.description,
          path: skillPath,
          source,
          size,
        });
      }
    }
  } catch (error) {
    console.error(`[SkillService] Error scanning skills from ${dirPath}:`, error);
  }

  return skills;
}

/**
 * Get all skills (builtin + user)
 * User skills override builtin skills with same name
 */
export async function getAllSkills(): Promise<SkillMeta[]> {
  // Scan builtin skills
  const builtinSkills = await scanSkillsFromDir(SKILLS_DIR_ABSOLUTE, 'builtin');

  // Scan user skills
  const userSkills = await scanSkillsFromDir(USER_SKILLS_DIR_ABSOLUTE, 'user');

  // Merge: user skills override builtin with same name
  const skillMap = new Map<string, SkillMeta>();
  for (const skill of builtinSkills) {
    skillMap.set(skill.name, skill);
  }
  for (const skill of userSkills) {
    skillMap.set(skill.name, skill);
  }

  return Array.from(skillMap.values());
}

/**
 * Import skill from folder or ZIP
 */
export async function importSkill(sourcePath: string): Promise<SkillMeta> {
  const stat = await fs.stat(sourcePath);
  let skillDir: string;

  if (stat.isDirectory()) {
    // Import from folder
    const parsed = await parseSkillMd(sourcePath);
    if (!parsed) {
      throw new Error('Invalid skill: SKILL.md not found or missing name/description');
    }

    // Copy to user skills directory
    const targetDir = path.join(USER_SKILLS_DIR_ABSOLUTE, parsed.name);
    await copyDir(sourcePath, targetDir);
    skillDir = targetDir;
  } else if (sourcePath.endsWith('.zip')) {
    // Import from ZIP
    const zip = new AdmZip(sourcePath);
    const tempDir = path.join(USER_SKILLS_DIR_ABSOLUTE, `_temp_${Date.now()}`);
    zip.extractAllTo(tempDir, true);

    // Find SKILL.md in extracted contents
    const skillPath = await findSkillMdDir(tempDir);
    if (!skillPath) {
      await fs.rm(tempDir, { recursive: true, force: true });
      throw new Error('Invalid ZIP: SKILL.md not found');
    }

    const parsed = await parseSkillMd(skillPath);
    if (!parsed) {
      await fs.rm(tempDir, { recursive: true, force: true });
      throw new Error('Invalid skill: SKILL.md missing name/description');
    }

    // Move to final location
    const targetDir = path.join(USER_SKILLS_DIR_ABSOLUTE, parsed.name);
    if (fsSync.existsSync(targetDir)) {
      await fs.rm(targetDir, { recursive: true, force: true });
    }
    await fs.rename(skillPath, targetDir);

    // Cleanup temp
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    skillDir = targetDir;
  } else {
    throw new Error('Unsupported file type. Please provide a folder or ZIP file.');
  }

  // Return the imported skill meta
  const parsed = await parseSkillMd(skillDir);
  if (!parsed) {
    throw new Error('Failed to parse imported skill');
  }

  const size = await getDirSize(skillDir);
  return {
    name: parsed.name,
    description: parsed.description,
    path: skillDir,
    source: 'user',
    size,
  };
}

/**
 * Find directory containing SKILL.md (handles nested structures)
 */
async function findSkillMdDir(baseDir: string): Promise<string | null> {
  // Check if SKILL.md exists in base dir
  const directPath = path.join(baseDir, 'SKILL.md');
  if (fsSync.existsSync(directPath)) {
    return baseDir;
  }

  // Check immediate subdirectories
  try {
    const entries = await fs.readdir(baseDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const subPath = path.join(baseDir, entry.name, 'SKILL.md');
        if (fsSync.existsSync(subPath)) {
          return path.join(baseDir, entry.name);
        }
      }
    }
  } catch {
    // Ignore errors
  }

  return null;
}

/**
 * Copy directory recursively
 */
async function copyDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

/**
 * Delete a user skill (builtin skills cannot be deleted)
 */
export async function deleteSkill(skillName: string): Promise<void> {
  const skills = await getAllSkills();
  const skill = skills.find(s => s.name === skillName);

  if (!skill) {
    throw new Error(`Skill not found: ${skillName}`);
  }

  if (skill.source === 'builtin') {
    throw new Error('Cannot delete builtin skills');
  }

  await fs.rm(skill.path, { recursive: true, force: true });
}

/**
 * Get skill paths for SDK plugins configuration
 * All skills in user-skills directory are enabled by default
 * Creates plugin wrapper with .claude-plugin/marketplace.json
 */
export async function getEnabledSkillPaths(): Promise<string[]> {
  const skills = await getAllSkills();
  // Only use skills from user-skills directory (where builtin skills are copied to)
  const userSkills = skills.filter(s => s.source === 'user');

  if (userSkills.length === 0) {
    return [];
  }

  // Create plugin wrapper directory
  const wrapperDir = path.join(USER_SKILLS_DIR_ABSOLUTE, '.claude-plugin');

  // Ensure directory exists
  await fs.mkdir(wrapperDir, { recursive: true });

  // Build relative paths using actual directory names (from skill.path)
  const skillsRelativePaths = userSkills.map(skill => {
    const dirName = path.basename(skill.path);
    return `./${dirName}`;
  });

  // Create marketplace.json
  const manifest = {
    name: 'goodable-skills',
    metadata: {
      description: 'Goodable managed skills',
      version: '1.0.0'
    },
    plugins: [
      {
        name: 'skills',
        description: 'User enabled skills',
        source: './',
        strict: false,
        skills: skillsRelativePaths
      }
    ]
  };

  await fs.writeFile(
    path.join(wrapperDir, 'marketplace.json'),
    JSON.stringify(manifest, null, 2),
    'utf-8'
  );

  console.log(`[SkillService] Created plugin wrapper with ${userSkills.length} skills:`, skillsRelativePaths);

  // Return user-skills directory (parent of .claude-plugin)
  return [USER_SKILLS_DIR_ABSOLUTE];
}

/**
 * Get skill detail (read SKILL.md content)
 */
export async function getSkillDetail(skillName: string): Promise<{ meta: SkillMeta; content: string } | null> {
  const skills = await getAllSkills();
  const skill = skills.find(s => s.name === skillName);

  if (!skill) {
    return null;
  }

  try {
    const skillMdPath = path.join(skill.path, 'SKILL.md');
    const content = await fs.readFile(skillMdPath, 'utf-8');
    return { meta: skill, content };
  } catch {
    return null;
  }
}
