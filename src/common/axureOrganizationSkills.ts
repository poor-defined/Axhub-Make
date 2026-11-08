export const AXURE_PRD_SKILL = {
  id: 'organize-axure-by-prd',
  token: '$organize-axure-by-prd',
  label: 'PRD 功能拆解与命名',
  description: '读取项目 PRD 的用户端需求，按功能分类并添加稳定的 [prd:标识]；保留原型画面。',
};
export function usesAxurePrdSkill(instructions: readonly string[]): boolean {
  return instructions.some(text => /(^|\s)\$organize-axure-by-prd(?=\s|$)/u.test(text));
}
