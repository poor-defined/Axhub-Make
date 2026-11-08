import { describe, expect, it } from 'vitest';
import { PROTOTYPE_WIREFRAME_POLICY } from './prototypeWireframePolicy';
import { buildPrototypeGenerationPrompt } from '../index/domains/prototype-generation/acpPrototypeAgentClient';
import { buildQuickEditAcpPrompt, buildPrototypeAnnotationAcpPrompt } from '../index/utils/quickEditPrompts';
import { appendPrototypeStartPromptSettings } from '../index/domains/ai-generation/canvasGenerationPromptSettings';
import { buildAcpContextPostMessage, buildAcpContextItemsPostMessage } from '../index/domains/assistant/assistantAcpContext';

describe('wireframe policy at real prompt boundaries', () => {
  it('covers prototype creation, canvas creation and annotation preparation prompts', () => {
    const generation = buildPrototypeGenerationPrompt({ prompt: '生成高保真订单页', generatorElementId: 'test' });
    const canvas = appendPrototypeStartPromptSettings({ prompt: '做一个工作台', settings: {} });
    const annotation = buildPrototypeAnnotationAcpPrompt({ currentFilePath: 'src/prototypes/orders/index.tsx' });
    for (const prompt of [generation, canvas, annotation]) expect(prompt).toContain(PROTOTYPE_WIREFRAME_POLICY);
  });
  it('covers a multi-selection edit without altering its target labels or expanding scope', () => {
    const prompt = buildQuickEditAcpPrompt({ currentFilePath: 'src/prototypes/orders/index.tsx', selectedElements: [
      { tag: 'button', label: '查询', selector: '#search' }, { tag: 'button', label: '重置', selector: '#reset' },
    ] });
    expect(prompt).toContain(PROTOTYPE_WIREFRAME_POLICY);
    expect(prompt).toContain('#search'); expect(prompt).toContain('#reset');
  });
  it('pins the policy into bare conversation context even without a selected file', () => {
    const message = buildAcpContextPostMessage({ version: '1', systemContext: '', currentFile: '', selectedElements: [] });
    expect(message.payload.items).toContainEqual(expect.objectContaining({
      id: 'axhub:project-policy:wireframe', pinned: true, hidden: true, body: PROTOTYPE_WIREFRAME_POLICY,
    }));
  });
  it('sends only project policy when opening an assistant without business context', () => {
    const message = buildAcpContextPostMessage(null);
    expect(message.payload.items).toHaveLength(1);
    expect(message.payload.items[0]).toMatchObject({ id: 'axhub:project-policy:wireframe', body: PROTOTYPE_WIREFRAME_POLICY });
    expect(JSON.stringify(message)).not.toContain('currentFile');
  });
  it('keeps policy in context replacement/append and does not duplicate it', () => {
    const message = buildAcpContextPostMessage({ version: '1', systemContext: '', currentFile: '', selectedElements: [] });
    const append = buildAcpContextItemsPostMessage(message.payload.items, 'append');
    expect(append.payload.items.filter((item) => item.id === 'axhub:project-policy:wireframe')).toHaveLength(1);
    expect(append.payload.items).toContainEqual(expect.objectContaining({ body: PROTOTYPE_WIREFRAME_POLICY }));
  });
});
