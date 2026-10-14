#!/usr/bin/env bash
set -euo pipefail

cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

if [[ $# -gt 0 ]]; then
  message="$*"
else
  printf '请输入本次更新说明（直接回车使用 feat:update）：'
  IFS= read -r message || true
  if [[ -z "$message" ]]; then
    message='feat:update'
  fi
fi

if [[ "$(git rev-parse --is-inside-work-tree 2>/dev/null || true)" != 'true' ]] ||
  [[ "$(git rev-parse --show-toplevel)" != "$(pwd -P)" ]]; then
  printf '错误：update-site.command 必须位于 Git 仓库根目录。\n' >&2
  exit 1
fi

if ! git remote get-url origin >/dev/null 2>&1; then
  printf '错误：未找到 Git remote origin。\n' >&2
  exit 1
fi

git fetch origin main
if ! git rev-parse --verify origin/main >/dev/null 2>&1; then
  printf '错误：未找到 origin/main，请先同步远端。\n' >&2
  exit 1
fi
if ! git merge-base --is-ancestor origin/main HEAD; then
  printf '错误：远端 main 不是当前提交的祖先，请先同步远端后重试。\n' >&2
  exit 1
fi

npm test
npm run build

git add -A
if git diff --cached --quiet; then
  printf '没有新的文件变化，跳过提交。\n'
else
  git commit -m "$message"
fi

git push origin HEAD:main

remote_url=$(git config --get remote.origin.url)
remote_url=${remote_url%.git}
if [[ "$remote_url" =~ ^(https://github[.]com/|git@github[.]com:|ssh://git@github[.]com/)([^/]+)/([^/]+)$ ]]; then
  owner=${BASH_REMATCH[2]}
  repository=${BASH_REMATCH[3]}
  if [[ "$repository" == "$owner.github.io" ]]; then
    pages_url="https://${owner}.github.io/"
  else
    pages_url="https://${owner}.github.io/${repository}/"
  fi
  printf 'GitHub Pages: %s\n' "$pages_url"
else
  printf '推送完成。请在 GitHub 仓库的 Settings → Pages 中查看站点地址。\n'
fi
