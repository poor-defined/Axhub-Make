import { describe, expect, it } from 'vitest';
import { createEditorRuntimeState, type ElementEditMeta } from '../../../vendor/axhub-commentary/src/core/editor/state';
import { createEditorSummariesService } from '../../../vendor/axhub-commentary/src/core/editor/summaries';
import { PROTOTYPE_WIREFRAME_POLICY, withPrototypeWireframePolicy } from '../../common/prototypeWireframePolicy';
import { applyHostPolicyToAgentMessage } from '../../../vendor/axhub-commentary/src/core/editor/host-prompt-policy';

describe('wireframe annotation prompt output', () => {
  it('protects the actual external conversation context payload without altering its comments', () => {
    const message = { type: 'integration.context.update', payload: { context: {
      systemContext: '', selectedElements: [{ label: '查询按钮' }], extensions: { comments: [{ comment: '改标题' }] },
    } } };
    const outgoing = JSON.parse(JSON.stringify(applyHostPolicyToAgentMessage(message, withPrototypeWireframePolicy)));
    expect(outgoing.payload.context.systemContext).toContain(PROTOTYPE_WIREFRAME_POLICY);
    expect(outgoing.payload.context.extensions).toEqual(message.payload.context.extensions);
    expect(message.payload.context.systemContext).toBe('');
    expect(applyHostPolicyToAgentMessage(message)).toBe(message);
  });
  it('applies the host policy to single, group, append and externally copied prompts without rewriting stored comments', () => {
    const state = createEditorRuntimeState();
    for (const [key, note] of [['a', '调整查询按钮'], ['b', '调整重置按钮']]) {
      state.editMetaByKey.set(key, { elementKey: key, commentId: key, locator: { selectors: [`#${key}`], fingerprint: '', path: [] }, label: key,
        note, images: [], anchor: null, dirtySince: 1, changeKinds: [], styleSummaryLines: [], classSummaryLines: [], textSummary: null } satisfies ElementEditMeta);
    }
    const summaries = createEditorSummariesService({ state, transformPrompt: withPrototypeWireframePolicy,
      buildCopyPromptOverride: () => '外部 AI 请处理当前批注',
    });
    const single = summaries.buildSaveRunPromptForElementKey('a');
    const group = summaries.buildSaveRunPrompt();
    const append = summaries.buildAppendSaveRunPrompt();
    const copied = summaries.buildCopyPrompt();
    for (const prompt of [single, group, append, copied]) expect(prompt).toContain(PROTOTYPE_WIREFRAME_POLICY);
    expect(single).toContain('调整查询按钮'); expect(single).not.toContain('调整重置按钮');
    expect(group).toContain('调整重置按钮');
    expect(copied).toContain('外部 AI 请处理当前批注');
    expect(state.editMetaByKey.get('a')?.note).toBe('调整查询按钮');
  });
  it('keeps empty edits empty and leaves standalone consumers without a host policy unchanged', () => {
    const state = createEditorRuntimeState();
    const summaries = createEditorSummariesService({ state, transformPrompt: withPrototypeWireframePolicy });
    expect(summaries.buildCopyPrompt()).toBe('');
    expect(summaries.buildSaveRunPrompt()).toBe('');
  });
});
