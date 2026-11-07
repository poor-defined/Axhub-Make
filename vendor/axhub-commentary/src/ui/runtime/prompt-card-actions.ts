export async function executePromptCardCurrentElementAction(options: {
  currentTarget: Element | null;
  onConfirmText: () => Promise<void>;
  onConfirmNote: () => Promise<void>;
  onSendCurrentElementPromptToAgent?: ((
    element: Element,
  ) => void | Promise<void>) | undefined;
}): Promise<boolean> {
  const {
    currentTarget,
    onConfirmText,
    onConfirmNote,
    onSendCurrentElementPromptToAgent,
  } = options;

  if (!currentTarget || !onSendCurrentElementPromptToAgent) {
    return false;
  }

  await onConfirmText();
  await onConfirmNote();
  await onSendCurrentElementPromptToAgent(currentTarget);
  return true;
}

export async function executePromptCardDocumentAction(options: {
  currentTarget: Element | null;
  note: string;
  onConfirmNote: () => Promise<void>;
  onDocumentComponent?: (element: Element, note: string) => void | Promise<void>;
}): Promise<void> {
  if (!options.currentTarget || !options.onDocumentComponent) return;
  // The host may dismiss the selection immediately after accepting the capture.
  await options.onConfirmNote();
  await options.onDocumentComponent(options.currentTarget, options.note);
}
