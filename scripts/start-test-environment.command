#!/bin/zsh -l

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
umask 077

repo_dir="${0:A:h:h}"
expected_branch='codex/global-ai-wireframe-style'
dev_url='http://127.0.0.1:53818'

finish() {
  local exit_code="$1"
  printf '\n按回车键关闭此窗口……'
  read -r launcher_reply
  exit "$exit_code"
}

printf 'Axhub Make · 开发分支启动器\n\n'
if ! cd "$repo_dir"; then
  printf '找不到代码目录：%s\n' "$repo_dir"
  finish 1
fi

for tool in git node pnpm; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    printf '缺少命令：%s，请先安装对应工具。\n' "$tool"
    finish 1
  fi
done

current_branch=$(git branch --show-current)
if [[ "$current_branch" != "$expected_branch" ]]; then
  printf '当前分支：%s\n需要分支：%s\n请切换到开发分支后重新双击此文件。\n' "$current_branch" "$expected_branch"
  finish 1
fi

# 使用独立状态目录，避免被 CLI 自动转到正在运行的正式版服务。
export AXHUB_MAKE_HOME_DIR="$repo_dir/.local/development-home"
# 开发版使用独立 ACP，避免复用仅允许 53817 的共享服务。
export AXHUB_ASSISTANT_WEB_BASE_URL="http://localhost:32125"
export AXHUB_ASSISTANT_API_BASE_URL="$AXHUB_ASSISTANT_WEB_BASE_URL/api"
dev_state_dir="$AXHUB_MAKE_HOME_DIR/.axhub/make"
if ! mkdir -p "$dev_state_dir"; then
  printf '无法创建开发配置目录：%s\n' "$dev_state_dir"
  finish 1
fi

# 首次启动复用项目目录清单；不复制登录凭据或服务运行信息。
if [[ ! -f "$dev_state_dir/projects.json" && -f "$HOME/.axhub/make/projects.json" ]]; then
  if ! cp "$HOME/.axhub/make/projects.json" "$dev_state_dir/projects.json"; then
    printf '无法读取现有项目列表。\n'
    finish 1
  fi
fi

if [[ ! -d node_modules || ! -x node_modules/.bin/tsx ]]; then
  printf '正在安装项目依赖……\n'
  pnpm install --frozen-lockfile || finish 1
fi

# 每次启动都先更新批注运行包，避免健康的开发服务仍使用旧构建。
pnpm vendor:build:commentary || finish 1

# 重复双击时打开当前工作区正在运行的开发服务。
if node --input-type=module - "$dev_url/api/health" "$dev_state_dir" <<'JS'
const response = await fetch(process.argv[2], { signal: AbortSignal.timeout(1500) }).catch(() => null);
const health = response?.ok ? await response.json().catch(() => null) : null;
process.exit(health?.ok && health.devMode === true && health.projectRoot === process.argv[3] ? 0 : 1);
JS
then
  printf '开发服务已在运行，正在打开浏览器：%s\n' "$dev_url"
  open "$dev_url"
  exit $?
fi

if lsof -nP -iTCP:53818 -sTCP:LISTEN >/dev/null 2>&1; then
  printf '端口 53818 被其他服务占用，请先关闭占用该端口的服务再重试。\n'
  finish 1
fi

printf '代码目录：%s\n分支：%s\n地址：%s\n\n' "$repo_dir" "$current_branch" "$dev_url"
printf '请保持此终端窗口打开；按 Control + C 可停止开发服务。\n\n'

# 先更新本分支的批注运行包，再启动完整开发服务器并自动打开浏览器。
pnpm server:dev -- --host 127.0.0.1 --port 53818
launcher_exit_code=$?
printf '\n开发服务已退出，退出码：%s\n' "$launcher_exit_code"
finish "$launcher_exit_code"
