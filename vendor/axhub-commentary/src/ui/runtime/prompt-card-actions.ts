export function resolveComponentPrototypeDestination(options: {
  requested: boolean;
  generatorAvailable: boolean;
  interactionProfile?: string;
  externalAnnotationMode?: boolean;
}): boolean {
  return options.requested && options.generatorAvailable && !options.externalAnnotationMode
    && options.interactionProfile !== 'annotation' && options.interactionProfile !== 'text-comment';
}

export function resolvePromptSubmitShortcut(options: {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  isComposing?: boolean;
  componentComposer?: boolean;
  generateNewPrototype?: boolean;
}): 'send' | 'save' | null {
  if (options.isComposing || options.key !== 'Enter' || !(options.metaKey || options.ctrlKey)) return null;
  return options.componentComposer || options.generateNewPrototype ? 'send' : 'save';
}

export async function executePromptCardCurrentElementAction(options: {
  currentTarget: Element | null;
  onConfirmText: () => Promise<void>;
  onConfirmNote: () => Promise<void>;
  generateNewPrototype?: boolean;
  note?: string;
  onGenerateComponentStates?: (element: Element, note: string) => void | Promise<void>;
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

  if (options.generateNewPrototype) {
    if (!currentTarget || !options.onGenerateComponentStates || !options.note?.trim()) return false;
    await options.onGenerateComponentStates(currentTarget, options.note);
    return true;
  }

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
