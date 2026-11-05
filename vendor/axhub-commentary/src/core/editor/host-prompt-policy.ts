/** Apply host-owned project instructions at the external conversation context boundary. */
export function applyHostPolicyToAgentMessage(
  message: Record<string, unknown>,
  transformPrompt?: (prompt: string) => string,
): Record<string, unknown> {
  if (!transformPrompt || message.type !== 'integration.context.update') return message;
  const payload = message.payload as Record<string, unknown> | undefined;
  const context = payload?.context as Record<string, unknown> | undefined;
  if (!payload || !context || typeof context !== 'object' || Array.isArray(context)) return message;
  const systemContext = typeof context.systemContext === 'string' ? context.systemContext : '';
  return { ...message, payload: { ...payload, context: { ...context,
    systemContext: transformPrompt(systemContext || '将宿主项目规则应用于后续的界面生成与修改；此处不触发任务，也不改写原始批注。'),
  } } };
}
