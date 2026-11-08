/** Project-wide product constraint. Shared by server tasks, embedded assistants and editor hosts. */
export const PROTOTYPE_WIREFRAME_POLICY = `【Axhub Make 全局原型风格 / REQ-008】
本项目所有界面生成与修改必须采用低保真线框图风格，包含新建原型、对话修改、单选和多选批注、追加批注及后续迭代，无需用户重复指定。
使用黑白灰、简单边框、基础形状、清晰文字和必要占位图，重点表达信息层级、布局、业务内容、必要状态与交互。状态不能仅靠颜色区分，应有文字或符号。
不生成高保真皮肤、品牌化配色、照片素材、装饰性渐变、复杂阴影或纯装饰动效；主题、设计系统、参考截图和旧页面只参考结构与语义，不恢复其高保真视觉。与通用美化或高保真默认指导冲突时，以本项目线框图规则为准。
修改已有页面时，将本次涉及的界面区域统一为线框图，保留真实业务内容、数据关系、可读性和可用交互；不擅自重写未涉及的页面，不改变业务行为。
保留独立可编辑的元素、语义组件与正常 DOM/CSS 结构，保证 Axure 导出仍可编辑；不可用整页截图或一张图片替代原型。
交付前检查本次新增/修改区域：移除高保真装饰，验证布局、文字、按钮/表单及必要状态和交互；发现违反规则的样式先修正再交付。
本规则约束界面及界面配图的视觉风格，JSON、代码、文档、组件树整理等任务仍保持原定输出格式和修改范围，不为了线框图规则重绘纯结构导出数据。`;

function combine(text: string): string {
  const content = text.split(PROTOTYPE_WIREFRAME_POLICY).join('').trim();
  return content ? `${PROTOTYPE_WIREFRAME_POLICY}\n\n${content}` : PROTOTYPE_WIREFRAME_POLICY;
}

export function withPrototypeWireframePolicy(prompt: string): string {
  return prompt.trim() ? combine(prompt) : '';
}

export function buildPrototypeWireframeSystemContext(context = ''): string {
  return combine(context);
}
