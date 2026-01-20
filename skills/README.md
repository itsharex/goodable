# Skills Integration Guide

## Directory Structure

Each skill must be a directory with the following structure:

```
skills/
└── <skill-name>/
    ├── SKILL.md          # Required: skill definition
    ├── package.json      # Optional: npm dependencies
    ├── requirements.txt  # Optional: Python dependencies
    ├── scripts/          # Optional: helper scripts
    └── ...
```

## SKILL.md Format

Required frontmatter fields:

```yaml
---
name: skill-name        # Must match directory name
displayName: 技能中文名  # Optional: display name for UI (Chinese recommended)
description: "..."      # Brief description for AI to decide when to use
---

# Skill content (markdown instructions for AI)
```

## Dependencies

### Node.js (package.json)

```json
{
  "name": "skill-name",
  "version": "1.0.0",
  "dependencies": {
    "package": "^x.x.x"
  }
}
```

AI will auto-detect and run `npm install` when `node_modules` is missing.

### Python (requirements.txt)

```
package-name==x.x.x
another-package>=x.x.x
```

AI will auto-detect and run `pip install -r requirements.txt` when needed.

Note: Python scripts should use standard library or common packages (lxml, pillow, etc.) that AI can install via pip.

## Runtime Behavior

1. On app startup, builtin skills are copied to `~/Library/Application Support/goodable/user-skills/` (macOS) or `%APPDATA%/goodable/user-skills/` (Windows)
2. `node_modules` is preserved during updates
3. All skills in user-skills directory are enabled by default

## Key Notes

- Directory name should match `name` field in SKILL.md
- Keep dependencies minimal (affects first-run install time)
- Scripts should use relative paths from skill directory
- Test on both macOS and Windows if using shell scripts
- For Python: prefer cross-platform packages, avoid OS-specific modules
