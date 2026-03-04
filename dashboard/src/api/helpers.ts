import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type { IncomingMessage } from 'http'

export const queuePath = join(homedir(), '.claude/orchestrator/queue.json')

export function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = ''
    req.on('data', (chunk: Buffer) => { body += chunk.toString() })
    req.on('end', () => resolve(body))
  })
}

/**
 * Read a YAML config file, merging a .local.yml override if it exists.
 * Returns the merged content as a string (for regex-based value extraction).
 */
export function readConfigWithLocal(basePath: string): string {
  let content = readFileSync(basePath, 'utf-8')
  const localPath = basePath.replace(/\.yml$/, '.local.yml')
  if (existsSync(localPath)) {
    // Merge local overrides: for each key-value in local, replace in merged content
    const localContent = readFileSync(localPath, 'utf-8')
    for (const line of localContent.split('\n')) {
      const kvMatch = line.match(/^(\s+)(\w+):\s*(.+)/)
      if (kvMatch) {
        const [, indent, key, val] = kvMatch
        const pattern = new RegExp(`^(\\s+${key}:\\s*).+$`, 'm')
        if (pattern.test(content)) {
          content = content.replace(pattern, `${indent}${key}: ${val}`)
        } else {
          // Key exists only in local — append after last line of the relevant section
          content += `\n${indent}${key}: ${val}`
        }
      }
    }
  }
  return content
}

/**
 * Get the local config override path for writes.
 * Creates the local file from the base if it doesn't exist.
 */
export function getLocalConfigPath(basePath: string): string {
  const localPath = basePath.replace(/\.yml$/, '.local.yml')
  if (!existsSync(localPath)) {
    writeFileSync(localPath, '# Local overrides (not committed)\n')
  }
  return localPath
}

/**
 * Write a setting to the local config override file.
 * If the key already exists in the local file, update it.
 * If not, find the section and add the key.
 */
export function writeLocalConfig(basePath: string, pattern: RegExp, replacement: string) {
  const localPath = getLocalConfigPath(basePath)
  let content = readFileSync(localPath, 'utf-8')
  if (pattern.test(content)) {
    content = content.replace(pattern, replacement)
  } else {
    // Read the base config to find which section the key belongs to
    const baseContent = readFileSync(basePath, 'utf-8')
    // Extract the key name from the pattern source
    const keyMatch = replacement.match(/^\s*(\w+):/)
    if (keyMatch) {
      const key = keyMatch[1]
      // Find the section this key belongs to in the base config
      let section = ''
      for (const line of baseContent.split('\n')) {
        const sectionMatch = line.match(/^(\w[^:]*):$/)
        if (sectionMatch) section = sectionMatch[1]
        if (line.match(new RegExp(`^\\s+${key}:`))) break
      }
      // Add section header if not in local file, then add key
      if (section && !content.includes(`${section}:`)) {
        content += `\n${section}:\n`
      }
      content += replacement.replace(/^\$1/, '  ') + '\n'
    }
  }
  writeFileSync(localPath, content, 'utf-8')
}

export function ensureQueue() {
  const dir = join(homedir(), '.claude/orchestrator')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  if (!existsSync(queuePath)) {
    writeFileSync(queuePath, JSON.stringify({ items: [] }, null, 2) + '\n')
  }
}

export function readQueue() {
  ensureQueue()
  return JSON.parse(readFileSync(queuePath, 'utf-8'))
}

export function writeQueue(data: Record<string, unknown>) {
  writeFileSync(queuePath, JSON.stringify(data, null, 2) + '\n')
}
