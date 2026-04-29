#!/usr/bin/env node
/**
 * Symlinks .cursor/agents and .cursor/skills to .agents/agents and .agents/skills
 * so Cursor reads the canonical tree without copying. Re-run after clone or if
 * paths were replaced by plain directories.
 */
import fs from 'node:fs/promises'
import path from 'node:path'

const repoRoot = path.resolve(import.meta.dirname, '..')
const srcAgents = path.join(repoRoot, '.agents', 'agents')
const srcSkills = path.join(repoRoot, '.agents', 'skills')
const destAgents = path.join(repoRoot, '.cursor', 'agents')
const destSkills = path.join(repoRoot, '.cursor', 'skills')

async function pathExists(p) {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

/** Remove a path whether it is a file, symlink, or directory tree. */
async function removePath(p) {
  try {
    const st = await fs.lstat(p)
    if (st.isDirectory() && !st.isSymbolicLink()) {
      await fs.rm(p, { recursive: true, force: true })
    } else {
      await fs.unlink(p)
    }
  } catch (e) {
    if (e.code !== 'ENOENT') throw e
  }
}

/**
 * Ensure linkPath is a symlink to targetAbs (directory). Uses a relative link
 * target. On Windows, uses type 'dir' for directory symlinks.
 */
async function ensureDirSymlink(linkPath, targetAbs) {
  const resolvedTarget = path.resolve(targetAbs)
  await fs.mkdir(path.dirname(linkPath), { recursive: true })

  try {
    const st = await fs.lstat(linkPath)
    if (st.isSymbolicLink()) {
      const current = path.resolve(path.dirname(linkPath), await fs.readlink(linkPath))
      if (current === resolvedTarget) return
    }
    await removePath(linkPath)
  } catch (e) {
    if (e.code !== 'ENOENT') throw e
  }

  const rel = path.relative(path.dirname(linkPath), resolvedTarget)
  if (process.platform === 'win32') {
    await fs.symlink(rel, linkPath, 'dir')
  } else {
    await fs.symlink(rel, linkPath)
  }
}

async function main() {
  if (!(await pathExists(srcAgents))) {
    console.warn('[sync-cursor-from-agents] Missing .agents/agents — skip')
    return
  }

  await ensureDirSymlink(destAgents, srcAgents)

  if (await pathExists(srcSkills)) {
    await ensureDirSymlink(destSkills, srcSkills)
  } else {
    console.warn('[sync-cursor-from-agents] Missing .agents/skills — only linked agents')
  }

  const relAgents = path.relative(path.dirname(destAgents), path.resolve(srcAgents))
  const relSkills = (await pathExists(srcSkills))
    ? path.relative(path.dirname(destSkills), path.resolve(srcSkills))
    : '(skipped)'
  console.log(
    `[sync-cursor-from-agents] Linked .cursor/agents → ${relAgents} and .cursor/skills → ${relSkills}`,
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
