import { describe, expect, it, vi } from 'vitest';

import { executePromptCardCurrentElementAction, executePromptCardDocumentAction, resolveComponentPrototypeDestination, resolvePromptSubmitShortcut } from '../../../vendor/axhub-commentary/src/ui/runtime/prompt-card-actions';
import { getAgentPromptBubbleActionState } from '../../../vendor/axhub-commentary/src/ui/agent-prompt-action';
it('submits component requests with Cmd/Ctrl+Enter while preserving annotation saves and IME input', () => {
  expect(resolvePromptSubmitShortcut({ key: 'Enter', metaKey: true, componentComposer: true })).toBe('send');
  expect(resolvePromptSubmitShortcut({ key: 'Enter', ctrlKey: true, generateNewPrototype: true })).toBe('send');
  expect(resolvePromptSubmitShortcut({ key: 'Enter', ctrlKey: true })).toBe('save');
  expect(resolvePromptSubmitShortcut({ key: 'Enter', metaKey: true, componentComposer: true, isComposing: true })).toBe(null);
  expect(resolvePromptSubmitShortcut({ key: 'Enter', componentComposer: true })).toBe(null);
});
it('ignores a previously selected prototype destination immediately when the same selection enters another editing mode', () => {
  const previousSelection = { requested: true, generatorAvailable: true };
  expect(resolveComponentPrototypeDestination(previousSelection)).toBe(true);
  for (const mode of [{ interactionProfile: 'annotation' }, { interactionProfile: 'text-comment' }, { externalAnnotationMode: true }, { generatorAvailable: false }]) {
    const generateNewPrototype = resolveComponentPrototypeDestination({ ...previousSelection, ...mode });
    expect(generateNewPrototype).toBe(false);
    expect(resolvePromptSubmitShortcut({ key: 'Enter', ctrlKey: true, generateNewPrototype })).toBe('save');
  }
});
it('routes new-prototype generation without saving text or executing changes on the source page', async () => {
  const edit = vi.fn(), save = vi.fn(), send = vi.fn(), generate = vi.fn();
  const target = {} as Element;
  expect(await executePromptCardCurrentElementAction({ currentTarget: target, onConfirmText: edit, onConfirmNote: save, onSendCurrentElementPromptToAgent: send, generateNewPrototype: true, note: '登录状态', onGenerateComponentStates: generate })).toBe(true);
  expect(generate).toHaveBeenCalledWith(target, '登录状态');
  expect(edit).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled();
});

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

describe('prompt card current element action', () => {
  it('keeps the vendored execution action loading while its element task is running', () => {
    const state = getAgentPromptBubbleActionState({
      visualState: 'awake',
      pageTaskRunning: true,
      pageTaskSessionReady: true,
      currentTaskRunning: true,
      currentTaskSessionReady: true,
      onSendCurrentElementPromptToAgent: () => undefined,
      getAgentBridgeConnected: () => true,
      hasReusableConversation: true,
    });

    expect(state.disabled).toBe(true);
    expect(state.loading).toBe(true);
    expect(state.dismissBubble).toBe(true);
  });

  it('leaves vendored bubble dismissal to the task lifecycle', async () => {
    const target = {} as Element;
    const sendDeferred = createDeferred<void>();
    const onConfirmText = vi.fn().mockResolvedValue(undefined);
    const onConfirmNote = vi.fn().mockResolvedValue(undefined);
    const onDismissSelection = vi.fn();
    const onSendCurrentElementPromptToAgent = vi.fn(() => sendDeferred.promise);

    const actionOptions = {
      currentTarget: target,
      onConfirmText,
      onConfirmNote,
      onDismissSelection,
      onSendCurrentElementPromptToAgent,
    };
    const resultPromise = executePromptCardCurrentElementAction(actionOptions);

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(onConfirmText).toHaveBeenCalledTimes(1);
    expect(onConfirmNote).toHaveBeenCalledTimes(1);
    expect(onSendCurrentElementPromptToAgent).toHaveBeenCalledWith(target);
    expect(onDismissSelection).not.toHaveBeenCalled();

    sendDeferred.resolve();
    await expect(resultPromise).resolves.toBe(true);
    expect(onDismissSelection).not.toHaveBeenCalled();
  });

  it('keeps the vendored bubble available when task startup fails', async () => {
    const target = {} as Element;
    const onDismissSelection = vi.fn();

    const actionOptions = {
      currentTarget: target,
      onConfirmText: vi.fn().mockResolvedValue(undefined),
      onConfirmNote: vi.fn().mockResolvedValue(undefined),
      onDismissSelection,
      onSendCurrentElementPromptToAgent: vi.fn().mockRejectedValue(new Error('启动失败')),
    };

    await expect(executePromptCardCurrentElementAction(actionOptions)).rejects.toThrow('启动失败');

    expect(onDismissSelection).not.toHaveBeenCalled();
  });
});


it('persists the component note before handing off documentation so clearing selection does not lose the draft', async () => {
 const order:string[]=[]; const target={} as Element;
 const onConfirmNote=vi.fn(async()=>{order.push('save')});
 const onDocumentComponent=vi.fn(async()=>{order.push('capture')});
 await executePromptCardDocumentAction({currentTarget:target,note:'草稿说明',onConfirmNote,onDocumentComponent});
 expect(order).toEqual(['save','capture']);expect(onDocumentComponent).toHaveBeenCalledWith(target,'草稿说明');
 onConfirmNote.mockRejectedValueOnce(new Error('保存失败'));
 await expect(executePromptCardDocumentAction({currentTarget:target,note:'草稿说明',onConfirmNote,onDocumentComponent})).rejects.toThrow('保存失败');
 expect(onDocumentComponent).toHaveBeenCalledTimes(1);
});
