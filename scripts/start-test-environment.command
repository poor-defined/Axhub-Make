#!/bin/zsh -l

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
umask 077
repo_dir="${0:A:h:h}"
printf 'Axhub Make · 本地开发启动器\n\n'

for tool in node pnpm; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    printf '缺少命令：%s，请先安装对应工具。\n按回车键关闭……' "$tool"
    read -r launcher_reply
    exit 1
  fi
done

# 固定入口调用当前工作区内的启动逻辑，不绑定分支、版本或构建产物名称。
node "$repo_dir/scripts/development-launcher.mjs"
launcher_exit_code=$?
if [[ "$launcher_exit_code" -ne 0 ]]; then
  printf '\n启动失败，退出码：%s\n按回车键关闭……' "$launcher_exit_code"
  read -r launcher_reply
fi
exit "$launcher_exit_code"
