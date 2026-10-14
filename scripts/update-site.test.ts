import { spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const command = resolve(process.cwd(), 'update-site.command')
const temporaryDirectories: string[] = []

function run(program: string, args: string[], cwd: string, env = process.env, input?: string) {
  const result = spawnSync(program, args, { cwd, env, input, encoding: 'utf8' })
  if (result.error) throw result.error
  return result
}

function git(cwd: string, ...args: string[]) {
  const result = run('git', args, cwd)
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`)
  return result.stdout.trim()
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'update-site-test-'))
  temporaryDirectories.push(root)
  const repo = join(root, 'site')
  const remote = join(root, 'remote.git')
  const bin = join(root, 'bin')
  const npmLog = join(root, 'npm.log')
  mkdirSync(repo)
  mkdirSync(bin)
  git(root, 'init', '--bare', remote)
  git(repo, 'init', '--initial-branch=main')
  git(repo, 'config', 'user.name', 'Test Author')
  git(repo, 'config', 'user.email', 'test@example.com')
  git(repo, 'config', `url.file://${remote}.insteadOf`, 'https://github.com/example/site.git')
  git(repo, 'remote', 'add', 'origin', 'https://github.com/example/site.git')
  copyFileSync(command, join(repo, 'update-site.command'))
  writeFileSync(join(repo, 'README.md'), 'seed\n')
  git(repo, 'add', '-A')
  git(repo, 'commit', '-m', 'seed')
  git(repo, 'push', 'origin', 'HEAD:main')
  writeFileSync(join(bin, 'npm'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$TEST_NPM_LOG"\nif [ "$*" = "$TEST_FAIL_ON" ]; then exit 23; fi\n')
  chmodSync(join(bin, 'npm'), 0o755)
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}`, TEST_NPM_LOG: npmLog, TEST_FAIL_ON: '' }
  const invoke = (args: string[] = [], input?: string, cwd = repo) =>
    run(join(repo, 'update-site.command'), args, cwd, env, input)
  const remoteHead = () => git(root, '--git-dir', remote, 'rev-parse', 'refs/heads/main')
  const npmCalls = () => readFileSync(npmLog, 'utf8').trim().split('\n')
  return { root, repo, remote, env, invoke, remoteHead, npmCalls, npmLog }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('update-site.command', () => {
  it('uses feat:update for blank input and pushes a new commit from another working directory', () => {
    const test = fixture()
    writeFileSync(join(test.repo, 'change.txt'), 'new content\n')
    const result = test.invoke([], '\n', test.root)

    expect(result.status).toBe(0)
    expect(git(test.repo, 'log', '-1', '--format=%s')).toBe('feat:update')
    expect(test.remoteHead()).toBe(git(test.repo, 'rev-parse', 'HEAD'))
    expect(result.stdout).toContain('https://example.github.io/site/')
  })

  it('joins every argument into a safe custom commit message without prompting', () => {
    const test = fixture()
    writeFileSync(join(test.repo, 'change.txt'), 'new content\n')
    const result = test.invoke(['修复', '公会 商店'])

    expect(result.status).toBe(0)
    expect(git(test.repo, 'log', '-1', '--format=%s')).toBe('修复 公会 商店')
  })

  it('runs the full test command before the production build', () => {
    const test = fixture()
    writeFileSync(join(test.repo, 'change.txt'), 'new content\n')

    expect(test.invoke(['update']).status).toBe(0)
    expect(test.npmCalls()).toEqual(['test', 'run build'])
  })

  it.each(['test', 'run build'])('stops before commit and push when npm %s fails', (failure) => {
    const test = fixture()
    const original = test.remoteHead()
    writeFileSync(join(test.repo, 'change.txt'), 'new content\n')
    test.env.TEST_FAIL_ON = failure

    const result = test.invoke(['update'])

    expect(result.status).not.toBe(0)
    expect(git(test.repo, 'log', '-1', '--format=%s')).toBe('seed')
    expect(test.remoteHead()).toBe(original)
    expect(git(test.repo, 'status', '--porcelain')).toContain('change.txt')
    expect(test.npmCalls()).toEqual(failure === 'test' ? ['test'] : ['test', 'run build'])
  })

  it('stops before validation when remote main is not an ancestor of HEAD', () => {
    const test = fixture()
    const other = join(test.root, 'other')
    git(test.root, 'clone', test.remote, other)
    git(other, 'config', 'user.name', 'Other Author')
    git(other, 'config', 'user.email', 'other@example.com')
    git(other, 'switch', 'main')
    writeFileSync(join(other, 'remote.txt'), 'remote change\n')
    git(other, 'add', '-A')
    git(other, 'commit', '-m', 'remote change')
    git(other, 'push', 'origin', 'HEAD:main')
    const remoteHead = test.remoteHead()
    writeFileSync(join(test.repo, 'change.txt'), 'local change\n')

    const result = test.invoke(['update'])

    expect(result.status).not.toBe(0)
    expect(result.stderr).toMatch(/同步|sync|ancestor/i)
    expect(test.remoteHead()).toBe(remoteHead)
    expect(git(test.repo, 'log', '-1', '--format=%s')).toBe('seed')
    expect(git(test.repo, 'status', '--porcelain')).toContain('change.txt')
    expect(() => readFileSync(test.npmLog, 'utf8')).toThrow()
  })

  it('pushes an existing ahead commit when the working tree has no changes', () => {
    const test = fixture()
    writeFileSync(join(test.repo, 'ahead.txt'), 'already committed\n')
    git(test.repo, 'add', '-A')
    git(test.repo, 'commit', '-m', 'existing ahead commit')
    const aheadHead = git(test.repo, 'rev-parse', 'HEAD')

    const result = test.invoke(['unused message'])

    expect(result.status).toBe(0)
    expect(git(test.repo, 'rev-parse', 'HEAD')).toBe(aheadHead)
    expect(test.remoteHead()).toBe(aheadHead)
    expect(test.npmCalls()).toEqual(['test', 'run build'])
  })
})
