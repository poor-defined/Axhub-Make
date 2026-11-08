# Axhub Make

[![License](https://img.shields.io/github/license/lintendo/Axhub-Make)](https://github.com/lintendo/Axhub-Make/blob/main/LICENSE) [![npm version](https://img.shields.io/npm/v/%40axhub%2Fmake)](https://www.npmjs.com/package/@axhub/make) [![npm downloads](https://img.shields.io/npm/dm/%40axhub%2Fmake)](https://www.npmjs.com/package/@axhub/make)

> Axhub Make 不是“又一个 AI 生成页面工具”。
> 它是一条从 **需求分析** 到 **原型生成**、**批注微调**、**原型评审**，再到 **发布交付** 的 AI 产品工作流。

给产品、设计师、业务团队和 AI Agent 用。

你说清楚要什么，Make 会把它变成：

*   可以点击、可以评审、可以发布的交互原型
*   带批注、标注和业务说明的“活 PRD”
*   基于设计系统和专业技能生成的 UI/UX 方案
*   面向新手的免费教程和上手路径
*   可分享、可导出、可交付的原型成果

## 直接启动

运行：

```
npx -y @axhub/make@latest
```

启动后会自动打开管理页面。如果没有打开，复制终端里显示的地址到浏览器。

## 本地开发

项目需求、交付状态和关联实施计划统一维护在[项目需求库](docs/requirements/README.md)。

macOS 双击桌面“启动 Axhub Make 开发分支.command”，或在仓库运行 `./scripts/start-test-environment.command`，即可启动或打开 `http://127.0.0.1:53818`。需要 Node.js 22+ 和 pnpm 10。桌面入口始终调用仓库脚本，使用当前检出的分支，更新代码无需修改命令。首次启动同步依赖并构建批注和管理端；之后按文件内容校验缓存，仅依赖声明变化时重新安装，仅代码、配置或构建资源变化时重新构建。删除或改动构建产物也会触发修复，构建失败不会记录为成功。缓存保存在 `.local/development-launcher-cache.json`，删除即可强制重新准备。

启动器复用健康的开发服务，归档进程已退出的旧记录，并自动检查和启动当前选中项目的 Make 客户端。开发版使用独立的 `.local/development-home` 状态与 ACP 端口 32125；端口被其他服务占用时给出错误，不会结束未知进程。重复双击不会并发构建。保持启动服务的终端打开，按 Control+C 停止管理服务。启动器回归测试：`node --test scripts/development-launcher.test.mjs`。

REQ-011：在“设计”之后的“参考”Tab 导入当前页面链接、ZIP 或单个 HTML。ZIP 可指定入口，并在预览顶部切换 HTML 页面；链接默认只缓存当前页及静态依赖。缓存保存在项目 `.axhub/make/references/`，手动导入的源页面变更后需重新导入。动态生成的外部依赖可能无法缓存，完整 Axure 发布目录建议用 ZIP 导入；“打开来源”可浏览原始页面。

普通原型和参考页的单组件批注窗口提供“生成新原型”“修改原型”“引入说明”三个用途 Tab，各自保留独立草稿、技能与附件。暂存成功后加入右侧列表并准备下一条，同一组件同一用途可以保存多条批注；列表支持用途筛选、编辑、删除及同用途批量发送。导出按钮沿用选中组件导出，不触发 AI。选择“引入说明”并发送后，选择当前项目 `src/resources/` 内的 Markdown PRD，再手动生成、编辑预览并确认追加。截图是真实组件截图，未提供的业务规则标为“待确认”；重复引入仍追加文末。图片保存在 PRD 同级 `assets/component-<UUID>.png`，复制或导出 PRD 时一并携带 `assets/`。参考页修改原型仍通过原宿主确认流程修改缓存 HTML；修改后刷新参考页再截图。

单选组件后进入“生成新原型”Tab，填写所需状态（例如 Header 的未登录、已登录、菜单展开），点击“发送”。宿主窗口展示真实组件截图，可调整新原型名称、状态要求，选择“同页平铺”或“交互切换”；只有点击“确认生成”才创建独立原型并调用已配置的批注 AI。新页面展示原始状态、其他状态及触发条件、变化说明，未知业务规则标为待确认，来源页不进入本次修改执行路径。生成任务可后台运行，完成后打开新原型继续批注；失败重试复用目标，创建响应中断时也使用同一任务标识恢复。来源截图、元信息和确认的主规格保存在新原型中。状态容器遵循共享命名表的 component 作用域，避免复制原 PRD 截图身份。三个用途切换时保留各自草稿，生成新原型仅支持一个组件或容器。定向回归：`pnpm exec vitest run src/common/componentStates.test.ts src/index/domains/prototype-generation/componentStatesSession.test.ts src/index/domains/prototype-generation/useComponentStates.test.ts src/index/components/dialogs/ComponentStatesDialog.test.ts src/server/__tests__/component-states-api.test.ts`。

页面加载统一使用 Skeleton：预览、文档、列表、表格、画布、模板卡片和配置表单使用对应布局，支持暗色、窄屏及 `prefers-reduced-motion`。共用布局和样式维护在 `src/common/loadingSkeleton.ts`，React 通过 `PageSkeleton`／`PreviewIframe` 使用，独立管理模板在开发／构建时展开首屏标记，便携客户端模板内置无外部依赖的首屏骨架。iframe 始终保留真实 DOM 引用及加载回调，导航加载期间不允许操作尚未显示的内容；成功或错误后撤下遮罩。旧“正在等待生成”页由预览 bootstrap 临时装饰，仅接受整页唯一且可见的精确旧占位，生成内容出现或根节点移除后自动撤下，不修改项目原型源文件。按钮操作、上传进度、错误和空状态保持独立反馈。基础回归：`pnpm exec vitest run src/common/loadingSkeleton.test.ts src/components/ui/preview-iframe.test.ts`。

实现主要位于 `src/server/referencePages.ts`、`src/server/managementApi.componentDocumentation.ts`、`src/index/domains/documentation/`，批注动作位于 `vendor/axhub-commentary/src/core/editor/document-component.ts`。运行 `pnpm exec vitest run src/common/componentDocumentation.test.ts src/index/domains/documentation src/index/components/content/ReferencePageView.test.ts src/index/components/dialogs/ComponentDocumentationDialog.test.ts src/server/__tests__/reference-pages.test.ts src/server/__tests__/reference-pages-api.test.ts src/server/__tests__/reference-pages-http.test.ts src/server/__tests__/component-documentation-api.test.ts src/server/__tests__/component-documentation-http.test.ts src/html-template src/vendor/axhub-commentary` 验证本功能；`pnpm exec tsc --noEmit -p tsconfig.node.json` 检查服务端类型，`pnpm admin:build` 构建运行资源。

REQ-008 的全局风格规则位于 `src/common/prototypeWireframePolicy.ts`，统一用于原型/画布生成、对话、单选/多选/追加批注及外部 AI 上下文。AI 生成和修改采用黑白灰低保真线框图，保留业务内容、可编辑元素与交互；局部修改只转换本次涉及的区域。纯文档、JSON 和 Axure 组件树整理仍保持原定输出格式。

线框图回归可运行 `pnpm exec vitest run src/common/prototypeWireframePolicy.test.ts src/common/wireframePromptIntegration.test.ts src/index/domains/assistant/assistantWindowContext.test.ts src/vendor/axhub-commentary/wireframe-prompts.test.ts src/server/assistantWorkRuntime.test.ts src/server/__tests__/ai-runs-api.test.ts src/server/__tests__/ai-image-generation.test.ts`。开发环境和 ACP 可用时，可手动运行 `pnpm exec tsx scripts/regression/req008-wireframe-smoke.mts`，使用已配置的模型执行真实生成与多选批注修改，仅写入系统临时目录并输出风格检查报告；默认读取独立开发配置，也可用 `REQ008_CONFIG_PATH` 指定配置文件。此检查会调用 AI，不属于默认测试套件。

复制可编辑原型到 Axure 时，先采集当前原型并打开组件树确认窗口，可以直接复制原始结构。AI 整理只在窗口中手动点击后执行，已移除“复制时自动 AI 整理”配置，旧的开关偏好不再生效。整页和 React/HTML 批注选区入口共用此流程。

REQ-010：窗口下方可输入整理、命名规范，查看本次对话记录，并继续提出修改要求。AI 使用“设置”里的对话提供方与模型，每轮结合累积要求和上一版方案生成完整新版本；不改变页面视觉或业务内容。失败保留上一版有效结构，支持重试，关闭或切换资源会清空本次对话。每条要求最多 2000 字，最多累计 20 条；达到上限后重新打开窗口开始新一轮。

手动与多轮整理测试可运行 `pnpm exec vitest run src/index/domains/export src/index/components/dialogs/AxureTreeOrganizationDialog.test.ts src/index/utils/exportModalPreferences.test.ts src/server/__tests__/axure-tree-organization-api.test.ts`。开发 ACP 可用时，`REQ010_PROJECT_ID=<开发项目ID> pnpm exec tsx scripts/regression/req010-axure-refinement-smoke.mts` 可验证真实 AI 两轮命名与分组；仅发送合成组件树、不改项目和剪贴板，会使用已配置模型。

整理逻辑位于 `src/common/axureTreeOrganization.ts`，AI 服务入口位于 `src/server/managementApi.axureTreeOrganization.ts`，前端任务与状态位于 `src/index/domains/export/`。首次分析最多接受 2000 个结构节点及受限大小的摘要；已有 SVG、遮罩和分组作为整体保留。失败后可以重试整理或复制原始结构，复制失败可直接重试，不会再次调用 AI。

此分支支持在元素批注时按住 Command 点击多个元素，再次 Command 点击可取消对应选择，Esc 清空整组。多选后填写的批注会应用到所选元素。

REQ-009：选中元素后，使用批注卡片的“仅导出选中元素到 Axure”按钮，打开原有组件树确认窗口，再复制到 Axure。Command 多选导出整组；选中容器包含其内部可见内容，父子选择去重，保留相对位置、裁剪和独立图层。入口不依赖设计工具偏好；整页复制入口仍导出整页。失效、AI 更新中、空内容或采集期间布局变化时中止。SVG 内部 path/g 等节点需改选完整 SVG 容器；无法安全合并的跨容器交错层叠会提示分别导出或选择共同容器。

选区实现位于 `vendor/axhub-commentary/src/axure-selection.ts`、`design-tool-export.ts` 与 `core/editor/selection-export.ts`。运行 `pnpm exec vitest run src/vendor/axhub-commentary src/index/domains/export src/common/axureTreeOrganization.test.ts` 可验证选择快照、合并、真实采集器与整理流程。可用 `REQ009_SMOKE_OUTPUT=/tmp/req009-selection.json pnpm exec vitest run src/vendor/axhub-commentary/selection-axure-real-core.test.ts` 保存两个虚构矩形的真实采集/合并/分组样本，用于本机 Axure Bridge 粘贴验证；默认测试不写剪贴板。

修改 `vendor/axhub-commentary/src/` 后，运行 `pnpm vendor:build:commentary` 更新实际运行的包；相关回归测试使用 `pnpm exec vitest run src/vendor/axhub-commentary`。

批注列表标题栏的 Pin 可将列表固定到 Make 工作区最右侧。固定态由外层宿主承载，跨源或居中的自定义尺寸 iframe 保持原实例、设备逻辑宽度和未暂存草稿，画布使用剩余空间；宿主握手失败时回退到原型内列表。再次点击恢复浮动，固定偏好刷新后保留。关闭列表后重开保留同页勾选，切页清空勾选。页面目录、文档目录与批注列表互斥；窄屏沿用上下布局，不压缩画布。勾选后点击底部“删除”，确认数量即可批量删除，支持跨用途和失效组件的批注；执行中的批注受保护。删除失败会恢复记录和勾选，保留重试入口。更新此宿主布局后需刷新整个管理页面。

预览内容区底部提供画布工具栏：放大、缩小、10%–300% 预设比例、适应宽度、重置到 100% 与拖动模式。支持 Ctrl/Command + 滚轮以指针为中心缩放、Ctrl/Command + 加减号、Ctrl/Command + 0 重置、Shift + 1 适应宽度，以及空格或鼠标中键拖动。输入框保留文字编辑行为，批注列表与工具栏保持正常尺寸；拖动不触发页面按钮。切页复位视图，同页目录关闭后恢复原来的缩放和平移，退出编辑后恢复页面原始样式。

批注用途 Tab 的隔离浏览器回归：`pnpm test:frontend:comment-purpose-tabs`。需要 Node.js 22+ 和本机 Chromium；macOS 自动使用已安装的 Playwright Chromium 或 Google Chrome，其他环境通过 `AXHUB_CHROME_BIN` 指定浏览器可执行文件。测试创建临时页面和独立浏览器配置，挂载真实批注运行时及原生目录，覆盖三类草稿、重复暂存、编辑删除、真实截图、请求路由、状态隔离、Pin 画布让位与目录切换、固定偏好刷新恢复、跨用途批量删除及失败回滚重试，不调用真实 AI。可设置 `COMMENT_PURPOSE_SCREENSHOTS=/tmp/comment-purpose-screenshots` 保存固定列表、原生目录、窄屏和深色截图。

升级到用途 Tab 后，普通组件批注加载时会自动清除旧格式组件批注及其无引用附件，不提供迁移入口。新用途记录、独立文字/样式修改、文字批注、语音及外部评审数据保留。

三个用途均支持不填写文字直接暂存，列表显示“未填写指示”，之后可编辑补充。同一组件可暂存多条空批注，纯空白输入归一化为空；技能和附件照常保留，刷新后记录仍存在。编辑已有批注并清空文字也会保存空值。暂存不会调用 AI，直接发送仍沿用填写指示的要求。

管理端页面、服务端 API 和运行时注入必须通过完整开发服务器一起启动：

```bash
pnpm server:dev -- --host 127.0.0.1 --no-open
```

不要直接启动 Vite，也不要为浏览器验证创建独立的管理端前端服务；独立前端缺少 Make 服务端 API 和运行时注入，并会占用管理端口。

## CLI 启动与打开 AI 应用

默认命令在当前终端前台启动 Make 并打开管理页面。需要命令完成后继续在后台运行时，使用：

```bash
npx -y @axhub/make@latest --background
```

`open` 会启动或复用 Make，再打开指定 AI 应用、注入 Axhub Make 入口并立即激活：

```bash
npx -y @axhub/make@latest open codex
npx -y @axhub/make@latest open cursor
npx -y @axhub/make@latest open workbuddy
npx -y @axhub/make@latest open traework
```

以上 App ID 是当前公开入口。加上 `--background` 可让新建的 Make 服务在后台运行；`--no-open` 只禁止系统浏览器打开管理页面，不影响 AI 应用里的入口激活。

如果目标应用已经运行但没有可用的调试端点，交互式终端会先请求重启确认。自动化或非交互环境可以显式传入 `--restart`，Make 只会请求应用正常退出，不会静默强制结束进程。`--app-path <path>` 可为本次调用指定应用路径，不会持久化。

查看或停止当前用户的 Make Admin 服务：

```bash
npx -y @axhub/make@latest status
npx -y @axhub/make@latest stop
```

这套 `open` 流程是一次性启动与注入，不安装扩展、常驻 companion、LaunchAgent 或 Windows 计划任务。重复调用会更新并激活已有入口。

## 从 Make 打开本地 AI 应用

Make 左上角“打开 AI”菜单的指定目录启动统一委托给 `@axhub/agent-surface`。需要页面集成时，服务端只调用一次组合接口完成项目打开和入口注入：

| 应用 | 指定目录方式 | 当前边界 |
| --- | --- | --- |
| ChatGPT / Codex | Codex 应用命令或项目深链 | 支持 Agent Surface 入口注入 |
| Cursor Agents | 内置 desktop router 的 `--chat` 与目录参数 | 支持 Agent Surface 入口注入 |
| WorkBuddy | `workbuddy://task?action=start&cwd=...` 任务深链 | 支持 Agent Surface 入口注入 |
| TRAEWORK | 不自动打开目录 | 对应 TRAE SOLO / SOLO CN，支持 Agent Surface 入口注入 |
| OpenCode | `opencode://open-project?directory=...` 项目深链 | 仅打开目录，不注入入口 |

用户在「设置」中配置的应用路径仍由 Make 保存，并在检查、退出和启动时作为最高优先级 `appPath` 传给 `@axhub/agent-surface`。只有未配置路径时，ChatGPT、WorkBuddy、TRAEWORK 和 TRAE 的 macOS / Windows 自动探测才交给共享宿主适配器；Cursor 的 Surface 检查与启动也使用同一包。OpenCode 暂无宿主适配器，因此仍由 Make 本地探测。

Agent Surface 的桌面客户端与注入等待由调用参数 `timeoutMs` 控制，未传时统一为 30 秒；Make 可以在特殊冷启动场景显式覆盖，不在宿主适配器中维护不同等待值。

## 让 AI 帮你启动

把下面这段发给你的 AI Agent，让它读取启动说明，然后帮你检查环境、启动 Make，并创建一个以后可以直接双击运行的桌面脚本：

```
请读取这个文档，并按里面的要求启动 Axhub Make：

https://raw.githubusercontent.com/lintendo/Axhub-Make/main/docs/start-axhub-make-with-ai.md
```

## 让 AI 指导你使用

把下面这段发给你的 AI Agent，让它读取使用指导，然后结合你当前的页面和项目指导你使用 Axhub Make：

```
请读取这个文档，并按里面的要求指导我使用 Axhub Make：

https://raw.githubusercontent.com/lintendo/Axhub-Make/main/docs/guide-users-with-axhub-make.md
```

## 产品流程

Axhub Make 把需求挖掘、Spec 对齐、设计规范、原型生成、批注编辑、AI 评审、交付标注和发布串成一条产品工作流。

### 生成：从需求挖掘到可运行原型

先通过需求挖掘把模糊想法拆成用户角色、业务目标、核心流程、页面结构和关键状态，再完成 Spec 对齐。生成时会自动匹配项目里的设计规范 Design，结合行业模板和组件风格，产出可点击、可预览、可继续编辑的交互原型。

<img src="assets/images/make-flow-create.png" alt="Axhub Make 生成原型界面" height="320">

### 编辑（批注）：在真实页面上下文里修改

团队可以直接在页面、模块或具体元素上留下修改意见。批注会成为 AI Agent 可读取的上下文，让文案、布局、状态、流程补充都围绕真实原型完成，不再散落在截图和聊天记录里。

<img src="assets/images/make-flow-comment.png" alt="Axhub Make 批注编辑界面" height="320">

### 评审：用 AI 评审发现产品问题

AI 评审会围绕当前原型、Spec、页面结构和业务流程，检查需求完整性、关键场景覆盖、交互自洽性、信息层级和遗漏状态。团队再基于 AI 扫出的问题做人工确认。

<img src="assets/images/make-flow-review.png" alt="Axhub Make AI 评审界面" height="320">

### 标注：把原型沉淀为可交付说明

将页面结构、组件说明、字段含义、交互规则、业务逻辑、状态变化和设计要求沉淀为标注。原型不只是能看、能点，也能作为研发、测试和业务验收可理解的交付说明。

<img src="assets/images/make-flow-annotation.png" alt="Axhub Make 标注交付界面" height="320">

### 发布：把原型变成可分享、可验收、可交付的产品资产

原型可以发布为在线链接，也可以导出 HTML、交付到 Figma，或通过 Axure 发布链路进入既有团队流程。发布后的成果可用于评审、演示、研发对齐和验收确认。

<img src="assets/images/make-flow-publish.png" alt="Axhub Make 发布交付菜单" height="320">

## 核心特点

### 支持主流 AI Agent

[![Codex](https://registry.npmmirror.com/@lobehub/icons-static-svg/latest/files/icons/codex-color.svg)](https://lobehub.com/icons/codex) [![Claude Code](https://registry.npmmirror.com/@lobehub/icons-static-svg/latest/files/icons/claudecode-color.svg)](https://lobehub.com/icons/claudecode) [![OpenCode](https://registry.npmmirror.com/@lobehub/icons-static-svg/latest/files/icons/opencode.svg)](https://lobehub.com/icons/opencode) [![Cursor](https://registry.npmmirror.com/@lobehub/icons-static-svg/latest/files/icons/cursor.svg)](https://lobehub.com/icons/cursor) [![Trae](https://registry.npmmirror.com/@lobehub/icons-static-svg/latest/files/icons/trae-color.svg)](https://lobehub.com/icons/trae) [![Qwen Code](https://registry.npmmirror.com/@lobehub/icons-static-svg/latest/files/icons/qwen-color.svg)](https://lobehub.com/icons/qwen) [![Qoder](https://registry.npmmirror.com/@lobehub/icons-static-svg/latest/files/icons/qoder-color.svg)](https://lobehub.com/icons/qoder) [![CodeBuddy](https://registry.npmmirror.com/@lobehub/icons-static-svg/latest/files/icons/codebuddy-color.svg)](https://lobehub.com/icons/codebuddy) [![Grok Build](https://registry.npmmirror.com/@lobehub/icons-static-svg/latest/files/icons/grok.svg)](https://lobehub.com/icons/grok) [![DeepSeek](https://registry.npmmirror.com/@lobehub/icons-static-svg/latest/files/icons/deepseek-color.svg)](https://lobehub.com/icons/deepseek) [![Kimi](https://registry.npmmirror.com/@lobehub/icons-static-svg/latest/files/icons/kimi-color.svg)](https://lobehub.com/icons/kimi) [![Doubao](https://registry.npmmirror.com/@lobehub/icons-static-svg/latest/files/icons/doubao-color.svg)](https://lobehub.com/icons/doubao) [![Yuanbao](https://registry.npmmirror.com/@lobehub/icons-static-svg/latest/files/icons/yuanbao-color.svg)](https://lobehub.com/icons/yuanbao) [![Windsurf](https://registry.npmmirror.com/@lobehub/icons-static-svg/latest/files/icons/windsurf.svg)](https://lobehub.com/icons/windsurf) [![Roo Code](https://registry.npmmirror.com/@lobehub/icons-static-svg/latest/files/icons/roocode.svg)](https://lobehub.com/icons/roocode) [![Antigravity](https://registry.npmmirror.com/@lobehub/icons-static-svg/latest/files/icons/antigravity-color.svg)](https://lobehub.com/icons/antigravity)

Axhub Make 可以和主流 Agent 一起工作，把产品需求、页面上下文、批注、标注和项目文件交给合适的 AI 工具处理。当前重点支持 Codex、Claude Code、OpenCode、Cursor、Qoder、CodeBuddy、Grok Build、DeepSeek / Reasonix 等 Agent 形态，同时覆盖 Trae、Qwen Code、Windsurf、Roo Code、Antigravity 以及 Kimi、Doubao、Yuanbao 等国内常用 AI 工具链。

团队可以按习惯选择工具，同时把产物沉淀在同一个 Make 项目中。

### 支持多平台资源导入

Axhub Make 支持从多种平台和格式导入原型资源，包括 Axhub Make ZIP 包、Google Stitch、Axure HTML 原型、Figma Make、V0 App、Google AI Studio 等来源。外部工具产出的页面、工程包和设计资源，可以带回 Make 继续整理、编辑、批注、评审和发布。

团队可以从不同工具起步，最终在同一个工作台里完成原型管理和交付。

### IMAGE2 UI/UX 工作流

Axhub Make 支持 IMAGE2 UI/UX 工作流：先生成高质量 UI 设计稿，再还原为可运行、可交互、可继续编辑的原型，用于评审、标注、发布和开发对齐。

### 团队协作、版本管理和移动办公

Axhub Make 面向产品团队协作设计。团队可以围绕同一个原型项目进行需求讨论、批注修改、AI 评审、交付标注和版本沉淀，让产品、设计、研发、测试和业务方共享同一份上下文。

版本管理用于回溯方案、对比变化和管理交付节点。发布链接和移动端预览支持远程评审、移动办公和客户演示。

### 免费资源库和发布交付

Make 内置新手教程、100+ 设计规范和 10+ 行业原型。原型完成后，可以通过云服务发布、HTML 导出、Figma 交付和 Axure 发布链路进入不同团队的既有工作方式。

## 用户群

扫码添加管理员，加入 Axhub Make 用户群，获取使用交流、问题反馈和新版本动态。

如果你已经加入过 Axhub 其他用户群，不需要重复添加。

<img src="assets/images/axhub-make-user-group-qrcode.png" alt="Axhub Make 用户群二维码" height="128">

## 贡献与安全

参阅 [贡献指南](CONTRIBUTING.md) 和 [安全报告说明](SECURITY.md)。本项目使用 [Apache License 2.0](LICENSE)。

在“项目设置 → 项目信息”可保存“Axure 本地发布目录”和“PRD 文档路径”（目录或具体 Markdown 文件）。两个字段均可留空，保存在当前项目 `.axhub/make/axhub.config.json` 的 `projectInfo.axurePublishDirectory` 与 `projectInfo.prdDocumentPath`，不会同步到其他项目。配置 Axure 本地发布目录后，进入项目会自动导入；“参考”Tab 打开且网页可见时每 5 秒检查内容变化，更新同一条记录并刷新预览。PRD 路径目前仅保存关联配置，自动截图和替换附件尚未启用。

每条参考页提供删除按钮，确认后删除该项目的导入缓存，保留原始发布文件。删除本地发布记录会清空项目设置中对应的本地发布路径，保留原始发布文件；需在项目设置中重新配置路径才能恢复。记录右侧的刷新按钮会立即重新读取当前配置的目录、替换缓存并重新加载预览。“本地发布”后括号显示源目录内已纳入导入的文件最新修改时间（本机时区），而非缓存生成时间；内容相同的重新发布也会更新时间。手动导入记录的删除确认框会显示将删除的本地缓存绝对路径。目录不可读、资源超限或含符号链接时显示错误并保留上一次成功缓存；本地目录遵循单文件 20MB、总量 100MB、1500 个文件的限制。Axure 页面优先按 `data/document.js` 中的页面 URL 识别，避免显示遗留页面和播放器辅助页；未识别到时回退扫描 HTML。

“文档”标签页会优先加入项目设置的 PRD 文档路径：配置为 Markdown 文件时展示该文件，配置为目录时递归列出其中的 Markdown。未选中文档或文件夹时默认打开第一份配置的 PRD，已有选择保持不变。直接读取原文件及配置目录内的图片附件，不复制到项目；清空配置后不再提供该外部路径的访问。

Axure 组件树“整理要求”支持输入 `/` 搜索技能，选择“PRD 功能拆解与命名”后会加入 `$organize-axure-by-prd`；也可按 Enter 选择、Esc 关闭。选择后仍需点击 AI 整理按钮。服务端读取项目设置的 PRD 路径，优先提供用户端需求章节；未选择技能时保持原有整理方式。PRD 未配置、不可读或超出范围限制时提示调整配置，不猜测需求。技能维护于 `client/.workbuddy/skills/organize-axure-by-prd/SKILL.md`，按功能编号分组，名称使用类型前缀与 `[prd:稳定业务标识]`，保留原节点内部 ID。原实例标记丢失、副本标记重复等结果会被拒绝；已有容器内部未出现在摘要中的节点不作已检查承诺。

Axure 组件树整理使用 10 分钟总时限（含 AI 服务准备与模式检查）。超时信息包含所在阶段和等待时间，并与客户端取消区分；原始结构与上一版有效结果保留。运行日志只记录阶段、耗时和错误代码，不记录 PRD 内容。

保存新增或更改后的 PRD 路径时，会弹出“批量规范 PRD 图片名称”预览；已配置路径可在“项目信息”点击“整理图片名称”。按固定模板的 F01–F11 功能编号、总览及登录态建议附件名称，并更新图片引用和说明。预览与“暂不修改”不写入 PRD；只有“确认批量修改”才执行。执行前核对文档和图片摘要，拒绝过期清单及名称冲突，备份原文件到项目 `.axhub/make/prd-image-renames/<批次>/`；失败时回滚，完成后刷新页面。作用范围仅配置的 PRD，其他文档对同一附件的引用不自动修改。

命名规则的唯一来源是 `client/.workbuddy/skills/organize-axure-by-prd/references/naming-rules.json`，包含 PRD 文件名前缀策略、功能后缀、总览／登录态、截图序号和复制组件后缀。服务端用同一算法生成完整附件命名清单，注入 AI 整理上下文（包含已经规范、无需再次改名的附件）；AI 新建标记须与清单一致，错误前缀、自由翻译的后缀及功能编号错配会被拒绝。规范附件的序号在新增图片、调整文档顺序或跨附件目录时保持稳定；同一标记对应多个独立附件会报错。截图继续以附件基础名称查找完全相同的 `[prd:标识]`，不做模糊匹配。已有唯一历史标记保留，其附件需显式对齐；不会自动改动已发布标记。修改 JSON 后重新整理及预览改名，旧命名表生成的 AI 结果、改名确认和截图确认会失效。

命名联动回归可运行 `pnpm exec vitest run src/server/__tests__/prd-naming-rules.test.ts src/server/__tests__/axure-organization-skills.test.ts src/server/__tests__/prd-image-renames.test.ts src/server/__tests__/prd-screenshots.test.ts`，覆盖改表后 AI／改名／截图一致、旧确认失效、稳定序号及副本与截图序号的区别。

Markdown 文档菜单提供“从本地参考发布更新截图”。文档需在项目设置的 PRD 路径范围内，附件基础名称对应原型的 `[prd:标识]`（例如 `cfd-f02-hero.png`）。先扫描当前发布，选择对应页面，生成预览，再明确确认替换；未匹配、同页面标记重复、隐藏区域和加载失败项目保留原图。第一版支持 PNG 附件，固定视窗 1920×1080，按标记的可见内容范围裁切；分组自身为零尺寸时计算可见后代的联合范围。多状态需在发布内容中展开到目标状态，重复器行需独立业务定位，不会自动猜测。

截图使用独立 Chromium/Chrome 进程及临时配置，不复用日常浏览器。自动查找本机 Playwright Chromium 缓存、Chrome 或 Edge；也可设置 `AXHUB_SCREENSHOT_BROWSER` 为浏览器可执行文件路径。截图仅加载本地发布资源，单张不超过 20MB、每批不超过 100MB，最多 50 项、每批约三分钟总预算；截图预览有效期 30 分钟。确认时重新检查 PRD、附件和发布内容摘要，变化后须重新生成。原图备份位于项目 `.axhub/make/prd-screenshot-jobs/<任务>/backup/`，写入失败会恢复原图，Markdown 引用和文件名不变。此入口为手动确认更新，尚未启用发布后自动覆盖 PRD 图片。
