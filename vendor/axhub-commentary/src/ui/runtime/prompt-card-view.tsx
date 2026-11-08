import React from 'react';
import { isMobileDevice } from '../../utils/mobile-detect';
import { createPortal } from 'react-dom';
import { MobileSelectionOverlay } from './mobile-selection-overlay';
import {
  CaretRightFilled,
  CheckCircleFilled,
  ClearOutlined,
  CloseOutlined,
  CopyOutlined,
  DeleteOutlined,
  ExclamationCircleFilled,
  ExportOutlined,
  FileTextOutlined,
  FormatPainterOutlined,
  MessageOutlined,
  PushpinOutlined,
  PushpinFilled,
} from '@ant-design/icons';
import { Dropdown, Input, Popconfirm, Tooltip } from 'antd';
import { computePromptCardPosition } from '../prompt-card-position';
import {
  getDesignToolExportActionState,
  triggerDesignToolExportAction,
} from '../design-tool-export-action';
import {
  getAgentPromptBubbleActionState,
  isAgentPromptActionVisible,
  triggerAgentPromptAction,
} from '../agent-prompt-action';
import { executePromptCardCurrentElementAction, executePromptCardDocumentAction, executePromptCardSaveAction, resolveComponentPrototypeDestination, resolvePromptSubmitShortcut } from './prompt-card-actions';
import { ComponentPromptFooter } from './component-prompt-footer';
import { ComponentCommentComposer } from './component-comment-composer';
import { resolvePromptCardCloseActionTitle } from './prompt-card-shortcut-label';
import { CloseToolIcon, AgentSparkleIcon, IconActionButton } from './action-buttons';
import { resolveExternalEditingStatusDescription } from './external-editing-status-hint';
import { deriveAgentUiState } from './agent-ui-state';
import { PromptImageStrip } from './prompt-image-strip';
import { PromptCardDesignEditor } from './prompt-card-design-editor';
import { resolveRuntimePopupContainer } from './popup-container';
import {
  addPromptCardSkillSelection,
  buildPromptCardSkillSavePayload,
  clearPromptCardSkillTrigger,
  deserializePromptCardSkillSelection,
  filterPromptCardSkills,
  findPromptCardSkillTrigger,
  mergePromptCardSkills,
  type PromptCardSkill,
} from './prompt-card-skills';
import { promptCardStyle } from './styles';
import {
  ANCHOR_GAP_PX,
  EDITOR_CHROME,
  POPUP_LAYER_Z_INDEX,
  PROMPT_CARD_ESTIMATED_HEIGHT,
  PROMPT_CARD_WIDTH,
  PROPERTY_PANEL_RIGHT,
  PROPERTY_PANEL_WIDTH,
  SAFE_PADDING_PX,
  TEXT_INPUT_PLACEHOLDER,
  WEB_EDITOR_POPUP_ROOT_ATTR,
} from './theme';
import type { BreadcrumbsHandle, PromptCardSize, PromptCardViewProps } from './types';
import { formatModifierShortcutLabel } from '../../core/editor/comment-shortcut-settings';
import { createElementLocator, locateElement } from '../../core/locator';
import type { ElementLocator } from '../../web-editor-types';
import { resolveCspNonce } from '../csp-nonce';
import { groupExternalCommentsByAuthor } from '../../external-comments';

function normalizePromptStyleSummaryLine(line: string): string {
  return line.replace(/^样式\s+/u, '').trim();
}

function compactPromptStyleSummaryLines(lines: readonly string[], maxLines = 2): string[] {
  const normalized = lines
    .map((line) => normalizePromptStyleSummaryLine(String(line ?? '')))
    .filter(Boolean);

  if (normalized.length <= maxLines) return normalized;
  const visibleLines = normalized.slice(0, maxLines);
  const overflowCount = normalized.length - maxLines;
  const lastLine = normalized[normalized.length - 1] ?? '';
  if (lastLine.startsWith('还有 ')) {
    return [...visibleLines.slice(0, Math.max(0, maxLines - 1)), lastLine];
  }
  return [...visibleLines, `还有 ${overflowCount} 项样式修改...`];
}

const PROMPT_PRIMARY_FOCUS_EXEMPT_SELECTOR = [
  '[data-we-prompt-primary-focus-exempt="true"]',
  '.ant-color-picker-trigger',
  '.ant-input-number',
  '.ant-segmented',
  '.ant-select',
  '.ant-slider',
  'a[href]',
  'button',
  'input',
  'label',
  'select',
  'textarea',
  '[contenteditable="true"]',
  '[contenteditable="plaintext-only"]',
  '[role="button"]',
  '[role="slider"]',
  '[role="tab"]',
  '[role="textbox"]',
  '[tabindex]',
].join(', ');
const PARENT_SELECT_INPUT_TOUCHED_ATTR = 'data-we-parent-select-input-touched';
type AnnotationInputMode = 'edit' | 'generate';
const ANNOTATION_INPUT_MODE_STORAGE_KEY = 'axhub-commentary-annotation-input-mode';
let annotationInputModeFallback: AnnotationInputMode = 'generate';

function readAnnotationInputModePreference(): AnnotationInputMode {
  try {
    const storedMode = globalThis.localStorage?.getItem(ANNOTATION_INPUT_MODE_STORAGE_KEY);
    if (storedMode === 'edit' || storedMode === 'generate') {
      annotationInputModeFallback = storedMode;
    }
  } catch {
    // Keep the in-memory preference when storage is unavailable.
  }
  return annotationInputModeFallback;
}

function writeAnnotationInputModePreference(mode: AnnotationInputMode): void {
  annotationInputModeFallback = mode;
  try {
    globalThis.localStorage?.setItem(ANNOTATION_INPUT_MODE_STORAGE_KEY, mode);
  } catch {
    // The in-memory preference still survives runtime remounts in this page.
  }
}

function shouldRestorePromptPrimaryFocusFromTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return true;
  }
  return !target.closest(PROMPT_PRIMARY_FOCUS_EXEMPT_SELECTOR);
}

const ANNOTATION_GENERATION_PLACEHOLDER = '输入给 AI 的标注需求，说明生成要求';
const EXTERNAL_REVIEW_PLACEHOLDER = '填写你的评审建议';

function isExternalAuthorNetworkIdentifier(value: string): boolean {
  return /^(?:\d{1,3}\.){3}\d{1,3}$/u.test(value.trim()) || value.includes(':');
}

function resolvePromptCardNotePlaceholder(
  isAnnotationSession: boolean,
  externalAnnotationMode: boolean,
): string {
  if (isAnnotationSession && externalAnnotationMode) return EXTERNAL_REVIEW_PLACEHOLDER;
  if (isAnnotationSession) return ANNOTATION_GENERATION_PLACEHOLDER;
  return '输入给 AI 的需求，/ 选择技能';
}

const ANNOTATION_PANEL_NODE_ID_ATTR = 'data-axhub-annotation-panel-node-id';
const ANNOTATION_MARKER_NODE_ID_ATTR = 'data-axhub-annotation-node-id';

const ANNOTATION_MANUAL_EDIT_DISABLED_MESSAGE = '无法准确定位标注位置，该标注需要由 AI 生成';
const ANNOTATION_MARKDOWN_PLACEHOLDER =
  '输入需求标注，支持 Markdown 格式。输入后即可创建标注节点。建议由 AI 创建标注，定位会更准确。';
const DOCUMENT_SOURCE_MARKDOWN_PLACEHOLDER =
  '编辑所选内容对应的原始 Markdown。保存后会直接更新本地文档。';
const ANNOTATION_EDITOR_PROMPT_CARD_WIDTH = 320;
const annotationEditorShellStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  padding: 0,
};
const externalCommentsToolStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 0,
  marginBottom: 8,
  padding: '8px 10px 2px',
  maxHeight: 280,
  overflowX: 'hidden',
  overflowY: 'auto',
  overscrollBehavior: 'contain',
  borderLeft: `3px solid ${EDITOR_CHROME.accent}`,
  borderRadius: 6,
  background: 'rgba(0, 143, 93, 0.07)',
};
const annotationEditorInputStyle: React.CSSProperties = {
  overflow: 'hidden',
  border: `1px solid ${EDITOR_CHROME.borderStrong}`,
  borderRadius: 12,
  background: EDITOR_CHROME.surfaceMuted,
  boxShadow: `inset 0 0 0 1px ${EDITOR_CHROME.surface}`,
  cursor: 'text',
};

function isAnnotationPanelTarget(element: Element | null): boolean {
  if (!element) return false;
  if (element.getAttribute('data-axhub-annotation-panel-target') === 'true') {
    return true;
  }
  return Boolean(element.closest?.('[data-axhub-annotation-panel-target="true"]'));
}

function readCurrentAnnotationNodeId(element: Element | null): string {
  if (!element) return '';
  for (const attr of [ANNOTATION_PANEL_NODE_ID_ATTR, ANNOTATION_MARKER_NODE_ID_ATTR]) {
    const direct = element.getAttribute?.(attr)?.trim();
    if (direct) return direct;
    const closest = element.closest?.(`[${attr}]`);
    const closestNodeId = closest?.getAttribute?.(attr)?.trim();
    if (closestNodeId) return closestNodeId;
  }
  return '';
}

export function getAnnotationManualEditLocatorState(
  element: Element | null,
  resolveLocator: (locator: ElementLocator) => Element | null = locateElement,
  getCreateBlockReason?: (element: Element | null) => string | undefined,
  resolveAnnotationTarget?: (element: Element | null) => Element | null,
): { disabled: boolean; message: string } {
  const annotationTarget = resolveAnnotationTarget ? resolveAnnotationTarget(element) : element;
  if (!annotationTarget) {
    return { disabled: true, message: ANNOTATION_MANUAL_EDIT_DISABLED_MESSAGE };
  }
  const annotationNodeId = readCurrentAnnotationNodeId(annotationTarget);
  if (annotationNodeId) {
    return { disabled: false, message: '' };
  }
  const createBlockReason = getCreateBlockReason?.(annotationTarget)?.trim();
  if (createBlockReason) {
    return { disabled: true, message: createBlockReason };
  }
  const isPanelTarget = isAnnotationPanelTarget(annotationTarget);
  if (isPanelTarget) {
    return { disabled: true, message: ANNOTATION_MANUAL_EDIT_DISABLED_MESSAGE };
  }
  let locator: ElementLocator;
  try {
    locator = createElementLocator(annotationTarget);
  } catch {
    return { disabled: true, message: ANNOTATION_MANUAL_EDIT_DISABLED_MESSAGE };
  }

  let resolvedElement: Element | null = null;
  try {
    resolvedElement = resolveLocator(locator);
  } catch {
    resolvedElement = null;
  }

  if (!resolvedElement) {
    return { disabled: true, message: ANNOTATION_MANUAL_EDIT_DISABLED_MESSAGE };
  }
  if (resolvedElement !== annotationTarget) {
    return { disabled: true, message: ANNOTATION_MANUAL_EDIT_DISABLED_MESSAGE };
  }
  return { disabled: false, message: '' };
}

async function copyPromptCardTextToClipboard(text: string): Promise<void> {
  try {
    if (
      typeof navigator !== 'undefined' &&
      navigator.clipboard &&
      typeof navigator.clipboard.writeText === 'function'
    ) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // Fall through to the legacy selection-based copy path.
  }

  if (typeof document === 'undefined' || !document.body) {
    throw new Error('Clipboard copy is unavailable');
  }

  const textArea = document.createElement('textarea');
  textArea.value = text;
  textArea.setAttribute('readonly', '');
  textArea.style.position = 'fixed';
  textArea.style.left = '-9999px';
  textArea.style.top = '0';
  textArea.style.opacity = '0';
  document.body.appendChild(textArea);

  try {
    textArea.focus();
    textArea.select();
    const copied =
      typeof document.execCommand === 'function' ? document.execCommand('copy') : false;
    if (!copied) {
      throw new Error('Clipboard copy failed');
    }
  } finally {
    textArea.remove();
  }
}

export function buildPromptCardTaskErrorMessage(options: {
  currentTaskDescription: string;
  sessionId?: string | null;
  taskRef?: {
    provider?: string | null;
    sessionId?: string | null;
    requestId?: string | null;
    error?: string | null;
    code?: string | null;
    output?: string | null;
    chunk?: unknown;
    details?: unknown;
  } | null;
}): string {
  const { currentTaskDescription, sessionId, taskRef } = options;
  const serializeDiagnosticValue = (value: unknown): string => {
    if (value === undefined || value === null) return '';
    if (typeof value === 'string') return value.trim();
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  };
  const taskSessionId = String(taskRef?.sessionId ?? sessionId ?? '').trim();
  return (
    [
      ...(currentTaskDescription ? [currentTaskDescription] : []),
      taskSessionId ? `Session ${taskSessionId}` : '',
      taskRef?.provider ? `Provider ${taskRef.provider}` : '',
      taskRef?.requestId ? `Request ${taskRef.requestId}` : '',
      taskRef?.code ? `Code ${taskRef.code}` : '',
      taskRef?.error ? `Error ${taskRef.error}` : '',
      taskRef?.output ? `Output ${taskRef.output}` : '',
      serializeDiagnosticValue(taskRef?.chunk)
        ? `Chunk ${serializeDiagnosticValue(taskRef?.chunk)}`
        : '',
      serializeDiagnosticValue(taskRef?.details)
        ? `Details ${serializeDiagnosticValue(taskRef?.details)}`
        : '',
    ]
      .filter(Boolean)
      .join('\n') || 'AI 修改失败'
  );
}

export function dismissPromptCardTerminalState(options: {
  currentTarget: Element | null;
  currentTaskTerminal: boolean;
  onDismissSelection?: () => void;
}): boolean {
  const { currentTarget, currentTaskTerminal, onDismissSelection } = options;

  if (!currentTaskTerminal || !currentTarget) {
    return false;
  }

  onDismissSelection?.();
  return true;
}

export const PromptCardView = React.forwardRef<BreadcrumbsHandle, PromptCardViewProps>(
  function PromptCardView(props, ref) {
    const {
      options,
      currentTarget,
      selectedElementCount = 1,
      pinnedToTopRight = false,
      onPinnedToTopRightChange,
      propertyPanelOpen = false,
      commentListOpen = false,
      onCommentSaved,
      onPersistComments,
      anchorRect,
      uiMode,
      interactionProfile,
      transactionManager,
      tokensService,
      designAdjustmentTool,
      toolMinimized,
      propertyPanelEnabled,
      styleDesignEnabled,
      bubbleStyleEditorOpen,
      agentVisualState,
      onBubbleStyleEditorOpenChange,
      onSendCurrentElementPromptToAgent,
      onWakeAgent,
      onAgentVisualStateChange,
      getAgentBridgeConnected,
      getHasReusableAgentConversation,
      getSendCurrentElementPromptToAgentBlockReason,
      canExportSelectionToDesignTool,
      onExportSelectionToDesignTool,
      onDocumentComponent,
      onGenerateComponentStates,
      getExportSelectionToDesignToolBlockReason,
      hideExecutionControls = false,
      hideCurrentElementExecutionAction = false,
      hideClearEditsAction = false,
      canClearCurrentElementEdits = true,
      hideContextAppendAction = false,
      externalAnnotationMode = false,
      enabledSkillIds,
      skillOptions,
      onHoverSelectionSuppressedChange,
      onSelectionInteractionLockChange,
      onTargetChange,
      onAnchorRectChange,
      onPromptCardVisibleChange,
      inlineTextEditing,
      onInlineTextEditingChange,
      canEditText,
      savedText,
      draftText,
      textDirty,
      onTextDraftChange,
      onCancelText,
      onConfirmText,
      images,
      onRemoveImage,
      onNotePasteCapture,
      canEditNote,
      savedNoteMeta,
      draftNote,
      noteDirty,
      onDraftChange,
      onClearCurrentElementEdits,
      onDeleteExternalComment,
      onConfirmNote,
      onDismissSelection,
      annotationEnabled,
      canEditAnnotationMarkdown,
      annotationDocumentEditUrl,
      annotationDraftMarkdown,
      annotationDirty,
      annotationLoading,
      annotationSaving,
      onAnnotationDraftChange,
      onConfirmAnnotationMarkdown,
      onDeleteCurrentAnnotationNode,
    } = props;
    const documentSourceMarkdownEditor = options.annotationMarkdownEditorKind === 'document-source';
    const isAnnotationSession = interactionProfile === 'annotation';
    const textCommentMode = interactionProfile === 'text-comment';
    const componentComposer = Boolean(onDocumentComponent && !isAnnotationSession && !externalAnnotationMode && !textCommentMode);
    const purposeComposer = componentComposer && Boolean(props.componentComments) && selectedElementCount === 1;

    const rootRef = React.useRef<HTMLDivElement | null>(null);
    const textComposerRef = React.useRef<HTMLDivElement | null>(null);
    const noteComposerRef = React.useRef<HTMLDivElement | null>(null);
    const inlineTextEditingRef = React.useRef(inlineTextEditing);
    const [portalContainer, setPortalContainer] = React.useState<HTMLElement | null>(null);
    const [promptCardSize, setPromptCardSize] = React.useState<PromptCardSize | null>(null);
    const [sendingCurrentElementPrompt, setSendingCurrentElementPrompt] = React.useState(false);
    const [savingComment, setSavingComment] = React.useState(false);
    const savingCommentRef = React.useRef(false);
    const [refreshKey, setRefreshKey] = React.useState(0);
    const [selectedSkills, setSelectedSkills] = React.useState<PromptCardSkill[]>([]);
    const [promptDismissed, setPromptDismissed] = React.useState(false);
    const [newPrototypeRequested, setGenerateNewPrototype] = React.useState(false);
    // A hidden destination must never carry over into PRD or review editing.
    const generateNewPrototype = resolveComponentPrototypeDestination({
      requested: newPrototypeRequested,
      generatorAvailable: Boolean(onGenerateComponentStates),
      interactionProfile,
      externalAnnotationMode,
    });
    React.useEffect(() => setGenerateNewPrototype(false), [currentTarget, selectedElementCount, isAnnotationSession, externalAnnotationMode, textCommentMode, onGenerateComponentStates]);
    const [externalCommentsToolOpen, setExternalCommentsToolOpen] = React.useState(true);
    const [hoveredExternalCommentId, setHoveredExternalCommentId] = React.useState<string | null>(null);
    const [annotationEditorOpen, setAnnotationEditorOpen] = React.useState(
      () => readAnnotationInputModePreference() === 'edit',
    );
    const setAnnotationInputMode = React.useCallback((mode: AnnotationInputMode) => {
      writeAnnotationInputModePreference(mode);
      setAnnotationEditorOpen(mode === 'edit');
    }, []);
    const [runningElementToolId, setRunningElementToolId] = React.useState<string | null>(null);
    const [elementToolError, setElementToolError] = React.useState('');
    const externalComments = React.useMemo(
      () => savedNoteMeta?.externalComments ?? [],
      [savedNoteMeta?.externalComments, refreshKey],
    );
    const externalCommentGroups = React.useMemo(
      () => groupExternalCommentsByAuthor(externalComments),
      [externalComments, refreshKey],
    );
    const externalCommentEntries = React.useMemo(
      () => externalCommentGroups.flatMap((group) => group.comments.map((comment) => ({ group, comment }))),
      [externalCommentGroups],
    );
    const elementTools = options.getElementTools?.(currentTarget) ?? [];
    const hasElementTools = elementTools.length > 0;
    const skillTrigger = React.useMemo(() => findPromptCardSkillTrigger(draftNote), [draftNote]);
    const promptCardSkills = React.useMemo(
      () => mergePromptCardSkills(skillOptions ?? []),
      [skillOptions],
    );
    const filteredSkills = React.useMemo(
      () => filterPromptCardSkills(skillTrigger?.query ?? '', enabledSkillIds, promptCardSkills),
      [enabledSkillIds, promptCardSkills, skillTrigger?.query],
    );
    const selectedSkillsDirty = React.useMemo(() => {
      const savedSkillIds = savedNoteMeta?.skillIds ?? [];
      const selectedSkillIds = selectedSkills.map((skill) => skill.id);
      return selectedSkillIds.join('\0') !== savedSkillIds.join('\0');
    }, [savedNoteMeta?.skillIds, selectedSkills]);
    const skillMenuOpen = Boolean(
      skillTrigger && !inlineTextEditing && canEditNote && filteredSkills.length > 0,
    );

    React.useEffect(() => {
      inlineTextEditingRef.current = inlineTextEditing;
    }, [inlineTextEditing]);

    React.useEffect(() => {
      setSelectedSkills(
        deserializePromptCardSkillSelection(savedNoteMeta, enabledSkillIds, skillOptions ?? []),
      );
      setRunningElementToolId(null);
      setElementToolError('');
    }, [enabledSkillIds, savedNoteMeta, currentTarget, skillOptions]);

    React.useLayoutEffect(() => {
      setPromptDismissed(false);
    }, [currentTarget, props.commentEditRequest?.revision]);

    React.useLayoutEffect(() => {
      setExternalCommentsToolOpen(true);
    }, [currentTarget, externalAnnotationMode]);

    React.useEffect(() => {
      if (isAnnotationSession && bubbleStyleEditorOpen) {
        onBubbleStyleEditorOpenChange(false);
      }
    }, [bubbleStyleEditorOpen, isAnnotationSession, onBubbleStyleEditorOpenChange]);

    const onConfirmNoteWithSelectedSkills = React.useCallback(async () => {
      const payload = buildPromptCardSkillSavePayload(draftNote, selectedSkills);
      await onConfirmNote({ skillIds: payload.skillIds });
    }, [draftNote, onConfirmNote, selectedSkills]);

    React.useImperativeHandle(
      ref,
      () => ({
        setTarget(element: Element | null) {
          onTargetChange(element);
        },
        setAnchorRect(rect) {
          onAnchorRectChange(rect);
        },
        refresh() {
          setRefreshKey((value) => value + 1);
        },
        enterInlineTextEdit(element?: HTMLElement | null) {
          onInlineTextEditingChange(true, element);
        },
      }),
      [onAnchorRectChange, onInlineTextEditingChange, onTargetChange],
    );

    const focusPromptTextInput = React.useCallback(() => {
      if (inlineTextEditing) return false;
      if (inlineTextEditingRef.current) return false;
      const input = textComposerRef.current?.querySelector('input');
      if (!(input instanceof HTMLInputElement) || input.disabled) return false;

      const activeElement = document.activeElement;
      if (
        activeElement instanceof HTMLElement &&
        activeElement !== input &&
        !textComposerRef.current?.contains(activeElement)
      ) {
        activeElement.blur();
      }

      input.setAttribute(PARENT_SELECT_INPUT_TOUCHED_ATTR, 'false');
      input.focus({ preventScroll: true });
      try {
        input.setSelectionRange(input.value.length, input.value.length);
      } catch {
        // noop
      }
      return true;
    }, [inlineTextEditing]);

    const focusPromptTextarea = React.useCallback(() => {
      if (inlineTextEditing) return false;
      if (inlineTextEditingRef.current) return false;
      const textarea = noteComposerRef.current?.querySelector('textarea');
      if (!(textarea instanceof HTMLTextAreaElement) || textarea.disabled) return false;

      const activeElement = document.activeElement;
      if (
        activeElement instanceof HTMLElement &&
        activeElement !== textarea &&
        !noteComposerRef.current?.contains(activeElement)
      ) {
        activeElement.blur();
      }

      textarea.setAttribute(PARENT_SELECT_INPUT_TOUCHED_ATTR, 'false');
      textarea.focus({ preventScroll: true });
      const cursor = textarea.value.length;
      try {
        textarea.setSelectionRange(cursor, cursor);
      } catch {
        // noop
      }
      return true;
    }, [inlineTextEditing]);

    const ensurePromptPrimaryFocus = React.useCallback(
      (attempts = 6) => {
        if (inlineTextEditingRef.current) return;
        let rafId = 0;
        let remaining = attempts;

        const tick = () => {
          if (inlineTextEditingRef.current) return;
          const textarea = noteComposerRef.current?.querySelector('textarea');
          if (textarea instanceof HTMLTextAreaElement && !textarea.disabled) {
            if (document.activeElement === textarea) return;
            focusPromptTextarea();
          } else {
            const input = textComposerRef.current?.querySelector('input');
            if (!(canEditText && input instanceof HTMLInputElement && !input.disabled)) return;
            if (document.activeElement === input) return;
            focusPromptTextInput();
          }
          remaining -= 1;
          if (remaining > 0) {
            rafId = window.requestAnimationFrame(tick);
          }
        };

        rafId = window.requestAnimationFrame(tick);
        return () => {
          if (rafId) {
            window.cancelAnimationFrame(rafId);
          }
        };
      },
      [canEditText, focusPromptTextInput, focusPromptTextarea, inlineTextEditing],
    );

    const promptPositionBaseVisible = Boolean(
      currentTarget && anchorRect && !toolMinimized && uiMode === 'bubble-card',
    );

    React.useLayoutEffect(() => {
      if (!promptPositionBaseVisible) {
        setPromptCardSize(null);
        return;
      }

      const root = rootRef.current;
      if (!root) return;

      const updateSize = () => {
        const rect = root.getBoundingClientRect();
        if (!Number.isFinite(rect.width) || !Number.isFinite(rect.height)) return;
        const nextSize = {
          width: Math.max(PROMPT_CARD_WIDTH, Math.round(rect.width)),
          height: Math.max(PROMPT_CARD_ESTIMATED_HEIGHT, Math.round(rect.height)),
        };
        setPromptCardSize((prev) => {
          if (prev && prev.width === nextSize.width && prev.height === nextSize.height) {
            return prev;
          }
          return nextSize;
        });
      };

      updateSize();

      if (typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver(() => updateSize());
      observer.observe(root);
      return () => observer.disconnect();
    }, [
      annotationDraftMarkdown,
      annotationEditorOpen,
      canEditText,
      draftNote,
      draftText,
      images.length,
      promptPositionBaseVisible,
      propertyPanelEnabled,
      bubbleStyleEditorOpen,
    ]);

    // Reposition even when resizing the viewport leaves the target rect unchanged.
    const [visualViewportKey, setVisualViewportKey] = React.useState(0);
    React.useEffect(() => {
      const vv = isMobileDevice() ? window.visualViewport : null;
      const handleResize = () => setVisualViewportKey((k) => k + 1);
      window.addEventListener('resize', handleResize);
      vv?.addEventListener('resize', handleResize);
      return () => {
        window.removeEventListener('resize', handleResize);
        vv?.removeEventListener('resize', handleResize);
      };
    }, []);

    const promptPosition = React.useMemo(() => {
      if (!currentTarget || !anchorRect || toolMinimized || uiMode !== 'bubble-card') return null;

      // On mobile, use full viewport width minus padding
      const mobileWidth = isMobileDevice()
        ? Math.max(200, window.innerWidth - 16)
        : (promptCardSize?.width ?? (componentComposer ? 360 : PROMPT_CARD_WIDTH));

      return computePromptCardPosition({
        anchorRect,
        cardWidth: mobileWidth,
        cardHeight: promptCardSize?.height ?? PROMPT_CARD_ESTIMATED_HEIGHT,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        propertyPanelEnabled: (commentListOpen && window.innerWidth > 760) || (propertyPanelEnabled && (!pinnedToTopRight || propertyPanelOpen)),
        pinnedToTopRight,
        stackWithCommentList: purposeComposer && commentListOpen,
        safePaddingPx: SAFE_PADDING_PX,
        propertyPanelWidth: commentListOpen && window.innerWidth > 760 ? 320 : PROPERTY_PANEL_WIDTH,
        propertyPanelRight: commentListOpen && window.innerWidth > 760 ? 52 : PROPERTY_PANEL_RIGHT,
        anchorGapPx: ANCHOR_GAP_PX,
      });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
      anchorRect,
      currentTarget,
      componentComposer,
      purposeComposer,
      promptCardSize,
      propertyPanelEnabled,
      pinnedToTopRight,
      propertyPanelOpen,
      commentListOpen,
      toolMinimized,
      uiMode,
      visualViewportKey,
    ]);

    const promptVisible = Boolean(
      currentTarget &&
        promptPosition &&
        promptCardSize &&
        !toolMinimized &&
        uiMode === 'bubble-card' &&
        !promptDismissed,
    );

    React.useEffect(() => {
      if (!promptVisible || uiMode !== 'bubble-card') {
        setSelectedSkills([]);
      }
      if (!isAnnotationSession && (!promptVisible || uiMode !== 'bubble-card')) {
        setAnnotationEditorOpen(false);
      }
    }, [isAnnotationSession, promptVisible, uiMode]);

    React.useEffect(() => {
      if (!isAnnotationSession && !canEditAnnotationMarkdown) {
        setAnnotationEditorOpen(false);
      }
    }, [canEditAnnotationMarkdown, isAnnotationSession]);

    React.useEffect(() => {
      if (!isAnnotationSession) return;
      setAnnotationEditorOpen(readAnnotationInputModePreference() === 'edit');
    }, [isAnnotationSession]);

    React.useEffect(() => {
      if (!isAnnotationSession && bubbleStyleEditorOpen) {
        setAnnotationEditorOpen(false);
      }
    }, [bubbleStyleEditorOpen, isAnnotationSession]);

    React.useEffect(() => {
      if (!hasElementTools || !bubbleStyleEditorOpen) return;
      onBubbleStyleEditorOpenChange(false);
    }, [bubbleStyleEditorOpen, hasElementTools, onBubbleStyleEditorOpenChange]);

    React.useEffect(() => {
      onPromptCardVisibleChange?.(promptVisible);
    }, [onPromptCardVisibleChange, promptVisible]);

    React.useEffect(() => {
      return () => onPromptCardVisibleChange?.(false);
    }, [onPromptCardVisibleChange]);

    React.useEffect(() => {
      if (
        !promptVisible ||
        !currentTarget ||
        toolMinimized ||
        uiMode !== 'bubble-card' ||
        inlineTextEditing
      )
        return;
      if (!isMobileDevice()) {
        return ensurePromptPrimaryFocus();
      }

      const timerId = window.setTimeout(() => {
        ensurePromptPrimaryFocus(10);
      }, 260);

      return () => {
        window.clearTimeout(timerId);
      };
    }, [
      currentTarget,
      ensurePromptPrimaryFocus,
      inlineTextEditing,
      promptVisible,
      toolMinimized,
      uiMode,
    ]);

    React.useEffect(() => {
      if (!inlineTextEditing || promptVisible) return;
      onInlineTextEditingChange(false);
    }, [inlineTextEditing, onInlineTextEditingChange, promptVisible]);

    React.useEffect(() => {
      if (!inlineTextEditing) return;
      const textarea = noteComposerRef.current?.querySelector('textarea');
      if (textarea instanceof HTMLTextAreaElement) {
        textarea.blur();
      }
      const input = textComposerRef.current?.querySelector('input');
      if (input instanceof HTMLInputElement) {
        input.blur();
      }
    }, [inlineTextEditing]);

    React.useEffect(() => {
      if (!promptVisible || uiMode !== 'bubble-card') return;

      const handleWheel = (event: WheelEvent) => {
        const root = rootRef.current;
        if (!root || !(event.target instanceof Node)) return;
        if (!root.contains(event.target)) return;
        event.preventDefault();
        event.stopPropagation();
      };

      window.addEventListener('wheel', handleWheel, {
        capture: true,
        passive: false,
      });
      return () => {
        window.removeEventListener('wheel', handleWheel, true);
      };
    }, [promptVisible, uiMode]);

    const saveAndCloseNoteComposer = React.useCallback(async () => {
      await onConfirmNoteWithSelectedSkills();
      setSelectedSkills([]);
      const textarea = noteComposerRef.current?.querySelector('textarea');
      if (textarea instanceof HTMLTextAreaElement) {
        textarea.blur();
      }
      onDismissSelection?.();
    }, [onConfirmNoteWithSelectedSkills, onDismissSelection]);

    const handleSaveComment = React.useCallback(async () => {
      if (savingCommentRef.current || !canEditNote) return;
      savingCommentRef.current = true;
      setSavingComment(true); setElementToolError('');
      try {
        await executePromptCardSaveAction({ onConfirmNote: onConfirmNoteWithSelectedSkills, onPersist: onPersistComments, onSaved: onCommentSaved });
      } catch (error) {
        setElementToolError(error instanceof Error ? error.message : '暂存失败，请重试');
      } finally {
        savingCommentRef.current = false; setSavingComment(false);
      }
    }, [canEditNote, onConfirmNoteWithSelectedSkills, onPersistComments, onCommentSaved]);

    const saveAndDismissPromptCard = React.useCallback(async () => {
      setSelectedSkills([]);
      setPromptDismissed(true);

      const activeElement = document.activeElement;
      if (activeElement instanceof HTMLElement && rootRef.current?.contains(activeElement)) {
        activeElement.blur();
      }

      // Hide immediately, but keep the current target alive while persistence
      // callbacks capture and save its draft.
      try {
        await onConfirmText();
        await onConfirmNoteWithSelectedSkills();
        if (
          documentSourceMarkdownEditor ||
          !getAnnotationManualEditLocatorState(
            currentTarget,
            undefined,
            options.getCreateAnnotationBlockReason,
            options.resolveAnnotationTarget,
          ).disabled
        ) {
          await onConfirmAnnotationMarkdown();
        }
      } finally {
        onDismissSelection?.();
      }
    }, [
      currentTarget,
      documentSourceMarkdownEditor,
      onConfirmAnnotationMarkdown,
      onConfirmNoteWithSelectedSkills,
      onConfirmText,
      onDismissSelection,
      options.getCreateAnnotationBlockReason,
      options.resolveAnnotationTarget,
    ]);

    const saveAndCloseAnnotationMarkdownComposer = React.useCallback(async () => {
      if (
        !documentSourceMarkdownEditor &&
        getAnnotationManualEditLocatorState(
          currentTarget,
          undefined,
          options.getCreateAnnotationBlockReason,
          options.resolveAnnotationTarget,
        ).disabled
      ) {
        return;
      }
      await onConfirmAnnotationMarkdown();
      const activeElement = document.activeElement;
      if (activeElement instanceof HTMLElement && rootRef.current?.contains(activeElement)) {
        activeElement.blur();
      }
      onDismissSelection?.();
    }, [
      currentTarget,
      documentSourceMarkdownEditor,
      onConfirmAnnotationMarkdown,
      onDismissSelection,
      options.getCreateAnnotationBlockReason,
      options.resolveAnnotationTarget,
    ]);

    const clearSelectedSkills = React.useCallback(() => {
      setSelectedSkills([]);
    }, []);

    const handleSkillSelect = React.useCallback(
      (skill: PromptCardSkill) => {
        const nextDraftNote = clearPromptCardSkillTrigger(draftNote);
        setSelectedSkills((current) => addPromptCardSkillSelection(current, skill));
        onDraftChange(nextDraftNote);
        window.requestAnimationFrame(() => {
          ensurePromptPrimaryFocus(2);
        });
      },
      [draftNote, ensurePromptPrimaryFocus, onDraftChange],
    );

    const handleSkillRemove = React.useCallback((skillId: string) => {
      setSelectedSkills((current) => current.filter((skill) => skill.id !== skillId));
    }, []);

    React.useEffect(() => {
      setPortalContainer(
        options.container.querySelector(
          `[${WEB_EDITOR_POPUP_ROOT_ATTR}="true"]`,
        ) as HTMLElement | null,
      );
    }, [options.container]);

    React.useEffect(() => {
      if (!promptVisible) {
        onHoverSelectionSuppressedChange(false);
        onSelectionInteractionLockChange(false);
      }
    }, [onHoverSelectionSuppressedChange, onSelectionInteractionLockChange, promptVisible]);

    React.useEffect(() => {
      return () => {
        onHoverSelectionSuppressedChange(false);
        onSelectionInteractionLockChange(false);
      };
    }, [onHoverSelectionSuppressedChange, onSelectionInteractionLockChange]);

    const agentAvailable = isAgentPromptActionVisible({
      currentTarget,
      uiMode,
      toolMinimized,
      onAppendElementToAgentContext: hideContextAppendAction
        ? undefined
        : options.onAppendElementToAgentContext,
      getAgentBridgeAvailable: options.getAgentBridgeAvailable,
      getAssistantPanelOpen: options.getAssistantPanelOpen,
    });
    const designToolExportAction = getDesignToolExportActionState({
      tool: designAdjustmentTool,
      currentTarget,
      uiMode,
      toolMinimized,
      onExportSelectionToDesignTool,
      canExportSelectionToDesignTool,
      getExportSelectionToDesignToolBlockReason,
    });
    const axureSelectionExportAction = getDesignToolExportActionState({
      tool: 'axure', currentTarget, uiMode, toolMinimized, selectedElementCount,
      onExportSelectionToDesignTool, canExportSelectionToDesignTool, getExportSelectionToDesignToolBlockReason,
    });
    const {
      currentTask: currentAgentTask,
      currentTaskRunning,
      currentTaskSessionReady,
      currentTaskTerminal,
      pageTaskRunning,
      pageTaskSessionReady,
      hasReusableConversation,
      effectiveVisualState,
    } = deriveAgentUiState({
      currentTarget,
      visualState: agentVisualState,
      getElementAgentTaskState: options.getElementAgentTaskState,
      getVisibleElementAgentTaskStates: options.getVisibleElementAgentTaskStates,
      getHasReusableAgentConversation,
      getAgentBridgeConnected,
    });
    const dismissTerminalTaskAndSelection = React.useCallback(
      () =>
        dismissPromptCardTerminalState({
          currentTarget,
          currentTaskTerminal,
          onDismissSelection,
        }),
      [currentTarget, currentTaskTerminal, onDismissSelection],
    );
    const handlePromptCardClose = React.useCallback(() => {
      if (generateNewPrototype) { setPromptDismissed(true); onDismissSelection?.(); return; }
      if (dismissTerminalTaskAndSelection()) return;

      void saveAndDismissPromptCard().catch(() => undefined);
    }, [dismissTerminalTaskAndSelection, saveAndDismissPromptCard, generateNewPrototype, onDismissSelection]);
    const currentTaskSessionHref =
      currentAgentTask?.sessionUrl ??
      (currentAgentTask?.sessionId ? `/session/${currentAgentTask.sessionId}` : '');
    const currentTaskDescription = resolveExternalEditingStatusDescription(
      currentAgentTask,
      options.externalEditingStatusDescription,
    );
    const currentTaskErrorMessage =
      currentAgentTask?.status === 'error'
        ? buildPromptCardTaskErrorMessage({
            currentTaskDescription,
            sessionId: currentAgentTask.sessionId,
            taskRef: currentAgentTask.taskRef,
          })
        : '';
    const styleSummaryLines = compactPromptStyleSummaryLines(
      options.getElementStyleSummaryLines?.(currentTarget) ?? [],
    );
    const currentElementHasDraftChanges = noteDirty || textDirty;
    const currentElementBlockReason = (() => {
      const reason = getSendCurrentElementPromptToAgentBlockReason?.(currentTarget);
      if (reason === '当前元素没有可发送给 AI 的编辑' && currentElementHasDraftChanges) {
        return undefined;
      }
      return reason;
    })();
    const currentElementPromptAction = getAgentPromptBubbleActionState({
      visualState: effectiveVisualState,
      sending: sendingCurrentElementPrompt,
      pageTaskRunning,
      pageTaskSessionReady,
      currentTaskRunning,
      currentTaskSessionReady,
      onSendCurrentElementPromptToAgent,
      canWakeAgent: Boolean(onWakeAgent),
      getAgentBridgeConnected,
      getSendCurrentElementPromptToAgentBlockReason: () => currentElementBlockReason,
      hasReusableConversation,
    });

    React.useLayoutEffect(() => {
      if (purposeComposer) return;
      if (!currentElementPromptAction.dismissBubble) return;
      setPromptDismissed(true);
    }, [currentElementPromptAction.dismissBubble, purposeComposer]);

    React.useEffect(() => {
      if (!promptVisible || uiMode !== 'bubble-card' || !currentTaskTerminal) return;

      const handleWindowKeyDown = (event: KeyboardEvent) => {
        if (event.isComposing || event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        dismissTerminalTaskAndSelection();
      };

      window.addEventListener('keydown', handleWindowKeyDown, true);
      return () => {
        window.removeEventListener('keydown', handleWindowKeyDown, true);
      };
    }, [currentTaskTerminal, dismissTerminalTaskAndSelection, promptVisible, uiMode]);

    const wakeAgentForCurrentElementAction = React.useCallback(async (): Promise<boolean> => {
      if (hideExecutionControls) {
        return true;
      }
      const connected = getAgentBridgeConnected?.();
      if (connected !== false && agentVisualState === 'awake') {
        return true;
      }
      if (!onWakeAgent) {
        return connected !== false;
      }

      try {
        const wakeResult = await onWakeAgent();
        if (wakeResult === true) {
          onAgentVisualStateChange?.('awake');
          return true;
        }
      } catch {
        // The wake bridge reports user-facing feedback.
      }
      return false;
    }, [
      agentVisualState,
      getAgentBridgeConnected,
      hideExecutionControls,
      onAgentVisualStateChange,
      onWakeAgent,
    ]);

    const handleConfirmSendCurrentElementPrompt = React.useCallback(async () => {
      if (savingCommentRef.current || sendingCurrentElementPrompt || (generateNewPrototype && selectedElementCount !== 1)) return;
      if (componentComposer && (hideCurrentElementExecutionAction || (!generateNewPrototype && (!currentElementPromptAction.visible || currentElementPromptAction.disabled)))) return;
      if (generateNewPrototype && !draftNote.trim()) return;
      const ready = generateNewPrototype || await wakeAgentForCurrentElementAction();
      if (!ready) return;

      setSendingCurrentElementPrompt(true);
      try {
        const sent = await executePromptCardCurrentElementAction({
          currentTarget,
          onConfirmText,
          onConfirmNote: onConfirmNoteWithSelectedSkills,
          onSendCurrentElementPromptToAgent,
          generateNewPrototype,
          note: [draftNote, ...selectedSkills.map(skill => skill.prompt)].filter(Boolean).join('\n\n'),
          onGenerateComponentStates,
        });
        if (sent) {
          clearSelectedSkills();
        }
      } catch {
        // The runtime bridge already surfaces user-facing feedback.
      } finally {
        setSendingCurrentElementPrompt(false);
      }
    }, [
      clearSelectedSkills,
      componentComposer,
      hideCurrentElementExecutionAction,
      currentElementPromptAction.visible,
      currentElementPromptAction.disabled,
      currentTarget,
      onConfirmNoteWithSelectedSkills,
      onConfirmText,
      onSendCurrentElementPromptToAgent,
      selectedSkills,
      generateNewPrototype, draftNote, onGenerateComponentStates, selectedElementCount, sendingCurrentElementPrompt,
      wakeAgentForCurrentElementAction,
    ]);

    const handlePromptKeyDown = React.useCallback(
      (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
        const isComposing = (event.nativeEvent as KeyboardEvent).isComposing;
        if (isComposing) return;
        const submit = resolvePromptSubmitShortcut({ key: event.key, metaKey: event.metaKey, ctrlKey: event.ctrlKey, isComposing, componentComposer, generateNewPrototype });
        if (submit) {
          event.preventDefault();
          event.stopPropagation();
          if (submit === 'send') { void handleConfirmSendCurrentElementPrompt(); return; }
          void saveAndCloseNoteComposer();
          return;
        }
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        if (generateNewPrototype) { handlePromptCardClose(); return; }
        if (dismissTerminalTaskAndSelection()) return;
        void saveAndCloseNoteComposer();
      },
      [dismissTerminalTaskAndSelection, saveAndCloseNoteComposer, componentComposer, generateNewPrototype, handleConfirmSendCurrentElementPrompt, handlePromptCardClose],
    );

    if (
      !promptPositionBaseVisible ||
      !currentTarget ||
      !promptPosition ||
      toolMinimized ||
      uiMode !== 'bubble-card'
    ) {
      return <div ref={rootRef} style={{ ...promptCardStyle, visibility: 'hidden' }} />;
    }

    const promptTarget = currentTarget;
    const handleElementToolAction = async (tool: (typeof elementTools)[number]) => {
      if (tool.disabled || runningElementToolId) return;
      setRunningElementToolId(tool.id);
      setElementToolError('');
      try {
        await options.onElementToolAction?.(tool, promptTarget);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error ?? '操作失败');
        setElementToolError(message.trim() || '操作失败');
      } finally {
        setRunningElementToolId(null);
      }
    };
    const showPromptTextInput = false;
    const isCurrentAnnotationPanelTarget = isAnnotationPanelTarget(currentTarget);
    const showAnnotationMarkdownEditorButton = Boolean(
      options.showAnnotationMarkdownEditor !== false &&
        annotationEnabled &&
        canEditAnnotationMarkdown &&
        currentTarget,
    );
    const annotationMarkdownEditorOpen = Boolean(
      annotationEditorOpen && showAnnotationMarkdownEditorButton,
    );
    const showAnnotationDocumentEditButton = Boolean(currentTarget && annotationDocumentEditUrl);
    const showNoteComposer = !annotationMarkdownEditorOpen && !bubbleStyleEditorOpen;
    const showAnnotationMarkdownEditor = Boolean(
      annotationMarkdownEditorOpen && !bubbleStyleEditorOpen,
    );
    const annotationModeLabel = annotationEditorOpen ? '编辑' : '生成';
    const annotationManualEditLocatorState = showAnnotationMarkdownEditor
      ? documentSourceMarkdownEditor
        ? { disabled: false, message: '' }
        : getAnnotationManualEditLocatorState(
            currentTarget,
            undefined,
            options.getCreateAnnotationBlockReason,
            options.resolveAnnotationTarget,
          )
      : { disabled: false, message: '' };
    const annotationManualEditDisabled = annotationManualEditLocatorState.disabled;
    const annotationManualEditMessage = annotationManualEditLocatorState.message;
    const showPromptDesignEditor = Boolean(
      currentTarget &&
        transactionManager &&
        bubbleStyleEditorOpen &&
        styleDesignEnabled &&
        !isAnnotationSession &&
        !isCurrentAnnotationPanelTarget &&
        !textCommentMode,
    );
    const styleEditorToggleTitle = bubbleStyleEditorOpen ? '关闭样式编辑' : '打开样式编辑';
    const promptCardSendActionTitle = currentElementPromptAction.title;
    const agentSelectionShortcutSettings = options.getCommentShortcutSettings?.();
    const agentSelectionShortcutLabels = agentSelectionShortcutSettings?.enabled
      ? agentSelectionShortcutSettings.shortcuts
          .filter((shortcut): shortcut is NonNullable<typeof shortcut> => Boolean(shortcut))
          .map((shortcut) => formatModifierShortcutLabel(shortcut))
      : [];
    const agentSelectionShortcutHint =
      agentSelectionShortcutLabels.length > 0
        ? `，长按 ${agentSelectionShortcutLabels.join(' / ')} 也可唤起`
        : '';
    const agentSelectionActionTitle = currentTaskRunning
      ? '添加到 AI 对话'
      : `添加到 AI 对话${agentSelectionShortcutHint}`;
    const showContextAppendExecutionControls = !hideExecutionControls;
    const showPromptCardExecutionActions = !isAnnotationSession || !annotationMarkdownEditorOpen;
    const componentName = selectedElementCount > 1 ? `已选 ${selectedElementCount} 个元素` : currentTarget.getAttribute('aria-label') || currentTarget.getAttribute('data-label') || currentTarget.id || currentTarget.tagName.toLowerCase();
    const appendContextAction = showContextAppendExecutionControls && agentAvailable ? (
      <IconActionButton title={agentSelectionActionTitle} icon={<AgentSparkleIcon />} tone="dark" disabled={!currentTarget} onClick={() => {
        triggerAgentPromptAction({ currentTarget: promptTarget, onAppendElementToAgentContext: options.onAppendElementToAgentContext });
      }} />
    ) : null;
    const clearEditsAction = !hideClearEditsAction && canClearCurrentElementEdits ? (
      <IconActionButton title="清空批注" icon={<ClearOutlined />} tone="dark" disabled={!currentTarget || sendingCurrentElementPrompt} onClick={() => {
        clearSelectedSkills();
        void onClearCurrentElementEdits();
      }} />
    ) : null;
    const notePlaceholder = resolvePromptCardNotePlaceholder(
      isAnnotationSession,
      externalAnnotationMode,
    );
    const promptCardCloseActionTitle = componentComposer
      ? generateNewPrototype ? '关闭（Esc）' : '关闭并保存（Esc）'
      : resolvePromptCardCloseActionTitle(globalThis.navigator?.platform);
    const annotationDeleteAction = !documentSourceMarkdownEditor ? (
      <Popconfirm
        title="删除标注"
        description="删除后该标注节点和页面上的 Marker 都会消失。"
        okText="删除"
        cancelText="取消"
        okButtonProps={{ danger: true }}
        disabled={annotationLoading || annotationSaving || !onDeleteCurrentAnnotationNode}
        getPopupContainer={resolveRuntimePopupContainer}
        onConfirm={() => {
          void onDeleteCurrentAnnotationNode?.();
        }}
      >
        <span style={{ display: 'inline-flex' }}>
          <IconActionButton
            title="删除标注"
            icon={<DeleteOutlined />}
            tone="dark"
            disabled={annotationLoading || annotationSaving || !onDeleteCurrentAnnotationNode}
          />
        </span>
      </Popconfirm>
    ) : null;

    const promptCardNode = (
      <div
        ref={rootRef}
        data-we-selection-lock-root="true"
        style={{
          ...promptCardStyle,
          width: componentComposer ? 360 : isAnnotationSession ? ANNOTATION_EDITOR_PROMPT_CARD_WIDTH : promptCardStyle.width,
          ...(componentComposer ? { padding: 0, gap: 0, borderRadius: 16, background: EDITOR_CHROME.surfaceElevated } : {}),
          left: promptPosition.left,
          top: promptPosition.top,
          visibility: promptVisible ? 'visible' : 'hidden',
          ...(purposeComposer && commentListOpen && window.innerWidth <= 760 ? {
            width: 'calc(100vw - 16px)', maxWidth: 'calc(100vw - 16px)', maxHeight: 'calc(48dvh - 16px)', overflow: 'hidden',
          } : {}),
          // Mobile: full width prompt card
          ...(isMobileDevice()
            ? {
                width: 'calc(100vw - 16px)',
                maxWidth: 'calc(100vw - 16px)',
                borderRadius: 16,
              }
            : {}),
        }}
        onPointerDownCapture={() => onSelectionInteractionLockChange(true)}
        onFocusCapture={() => onSelectionInteractionLockChange(true)}
        onPointerEnter={() => {
          onHoverSelectionSuppressedChange(true);
        }}
        onPointerLeave={() => {
          onHoverSelectionSuppressedChange(false);
        }}
      >
        <style nonce={resolveCspNonce()}>
          {`
            .we-runtime-prompt-card__textarea,
            .we-runtime-prompt-card__textarea:disabled,
            .we-runtime-prompt-card__textarea textarea,
            .we-runtime-prompt-card__textarea textarea:disabled {
              color: ${EDITOR_CHROME.textPrimary} !important;
              -webkit-text-fill-color: ${EDITOR_CHROME.textPrimary} !important;
              scrollbar-width: none;
              -ms-overflow-style: none;
            }

            .we-runtime-prompt-card__textarea::placeholder,
            .we-runtime-prompt-card__textarea textarea::placeholder {
              color: ${EDITOR_CHROME.textMuted} !important;
              -webkit-text-fill-color: ${EDITOR_CHROME.textMuted} !important;
            }

            .we-runtime-prompt-card__textarea::-webkit-scrollbar,
            .we-runtime-prompt-card__textarea textarea::-webkit-scrollbar {
              display: none;
            }

            [data-we-annotation-markdown-editor="true"]:focus-within {
              border-color: ${EDITOR_CHROME.accent} !important;
              box-shadow: 0 0 0 3px ${EDITOR_CHROME.accentSoft};
            }
            [data-we-component-composer="true"]:focus-within {
              border-color: ${EDITOR_CHROME.accent} !important;
              box-shadow: 0 0 0 3px ${EDITOR_CHROME.accentSoft};
            }
            [data-we-component-prompt-footer="true"] button:focus-visible,
            [data-we-component-prompt-footer="true"] input:focus-visible {
              outline: 2px solid ${EDITOR_CHROME.accent};
              outline-offset: 3px;
            }
            [data-we-component-prompt-submit="true"]:not(:disabled):hover {
              background: ${EDITOR_CHROME.accentHover} !important;
            }
          `}
        </style>
        {purposeComposer && props.componentComments && !bubbleStyleEditorOpen ? (
          <ComponentCommentComposer api={props.componentComments} element={currentTarget} label={componentName}
            editRequest={props.commentEditRequest} onSaved={onCommentSaved}
            onClose={() => { setPromptDismissed(true); onDismissSelection?.(); }}
            getLoadState={props.getCommentListLoadState} loadingContent={props.commentListLoadingContent} onRetry={props.onRetryCommentList}
            skillOptions={skillOptions ?? undefined} enabledSkillIds={enabledSkillIds ?? undefined}
            available={{ 'modify-prototype': !hideExecutionControls && !hideCurrentElementExecutionAction && canEditNote,
              'generate-prototype': Boolean(onGenerateComponentStates) && selectedElementCount === 1 && canEditNote,
              'document-component': Boolean(onDocumentComponent) && selectedElementCount === 1 && canEditNote }}
            onExport={axureSelectionExportAction.visible ? () => onExportSelectionToDesignTool?.('axure', currentTarget)
              : designToolExportAction.visible && designAdjustmentTool ? () => onExportSelectionToDesignTool?.(designAdjustmentTool, currentTarget) : undefined}
            exportDisabled={axureSelectionExportAction.visible ? axureSelectionExportAction.disabled : designToolExportAction.disabled}
            exportTitle={axureSelectionExportAction.visible ? axureSelectionExportAction.title : designToolExportAction.title}
            tools={<>
              {styleDesignEnabled ? <IconActionButton title={styleEditorToggleTitle} icon={<FormatPainterOutlined />} tone="dark" onClick={() => onBubbleStyleEditorOpenChange(true)} /> : null}
              <IconActionButton title={pinnedToTopRight ? '取消固定' : '固定到右上角'} icon={<PushpinOutlined />} tone={pinnedToTopRight ? 'accent' : 'dark'} onClick={() => onPinnedToTopRightChange?.(!pinnedToTopRight)} />
            </>}
          />
        ) : <>
        <div
          data-we-annotation-session-toolbar="true"
          style={{
            display: 'flex',
            flexWrap: componentComposer ? 'nowrap' : 'wrap',
            alignItems: 'center',
            gap: 8,
            ...(componentComposer ? { padding: '10px 12px', borderBottom: `1px solid ${EDITOR_CHROME.border}`, flexShrink: 0, gap: 4 } : {}),
          }}
        >
          {componentComposer ? (
            <div style={{ flex: '1 1 80px', minWidth: 0, marginRight: 4 }}>
              <div style={{ color: EDITOR_CHROME.textMuted, fontSize: 10, lineHeight: '15px' }}>组件批注</div>
              <div title={componentName} style={{ color: EDITOR_CHROME.textPrimary, fontSize: 12, lineHeight: '18px', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{componentName}</div>
            </div>
          ) : null}
          {!componentComposer && selectedElementCount > 1 ? (
            <span data-we-selection-count="true" style={{ fontSize: 12, color: EDITOR_CHROME.textMuted }}>
              已选 {selectedElementCount} 个元素
            </span>
          ) : null}
          <div
            data-we-prompt-card-tool-actions="true"
            style={{ display: 'flex', flexWrap: componentComposer ? 'nowrap' : 'wrap', alignItems: 'center', gap: 2, ...(componentComposer ? { flexShrink: 0 } : {}) }}
          >
            {isAnnotationSession && showAnnotationMarkdownEditorButton ? (
              <div
                data-we-annotation-mode-tabs="true"
                role="tablist"
                aria-label={`${annotationModeLabel}标注编辑已选`}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 1,
                  padding: 1,
                  borderRadius: 7,
                  background: EDITOR_CHROME.surface,
                  border: `1px solid ${EDITOR_CHROME.border}`,
                }}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={annotationEditorOpen}
                  style={{
                    border: 0,
                    borderRadius: 6,
                    background: annotationEditorOpen
                      ? EDITOR_CHROME.surfaceInteractive
                      : 'transparent',
                    color: annotationEditorOpen
                      ? EDITOR_CHROME.textPrimary
                      : EDITOR_CHROME.textMuted,
                    padding: '3px 6px',
                    fontSize: 10,
                    fontWeight: 500,
                    lineHeight: '16px',
                    cursor: annotationLoading ? 'default' : 'pointer',
                  }}
                  disabled={annotationLoading}
                  onClick={() => {
                    setAnnotationInputMode('edit');
                    onBubbleStyleEditorOpenChange(false);
                  }}
                >
                  编辑
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={!annotationEditorOpen}
                  style={{
                    border: 0,
                    borderRadius: 6,
                    background: !annotationEditorOpen
                      ? EDITOR_CHROME.surfaceInteractive
                      : 'transparent',
                    color: !annotationEditorOpen
                      ? EDITOR_CHROME.textPrimary
                      : EDITOR_CHROME.textMuted,
                    padding: '3px 6px',
                    fontSize: 10,
                    fontWeight: 500,
                    lineHeight: '16px',
                    cursor: annotationLoading ? 'default' : 'pointer',
                  }}
                  disabled={annotationLoading}
                  onClick={() => {
                    setAnnotationInputMode('generate');
                    onBubbleStyleEditorOpenChange(false);
                  }}
                >
                  生成
                </button>
              </div>
            ) : showAnnotationMarkdownEditorButton ? (
              <IconActionButton
                title={
                  documentSourceMarkdownEditor
                    ? annotationEditorOpen
                      ? '关闭 Markdown 源码编辑'
                      : 'Markdown 源码编辑'
                    : annotationEditorOpen
                      ? '关闭标注编辑'
                      : '标注编辑'
                }
                icon={<FileTextOutlined />}
                tone={annotationEditorOpen ? 'accent' : 'dark'}
                disabled={annotationLoading}
                onClick={() => {
                  const nextAnnotationEditorOpen = !annotationEditorOpen;
                  setAnnotationEditorOpen(nextAnnotationEditorOpen);
                  if (nextAnnotationEditorOpen && bubbleStyleEditorOpen) {
                    onBubbleStyleEditorOpenChange(false);
                  }
                }}
              />
            ) : null}
            {showAnnotationDocumentEditButton ? (
              <IconActionButton
                title="文档编辑"
                icon={<FileTextOutlined />}
                tone="dark"
                onClick={() => {
                  window.open(annotationDocumentEditUrl, '_blank', 'noopener,noreferrer');
                }}
              />
            ) : null}
            {elementTools.map((tool) => {
              const running = runningElementToolId === tool.id;
              return (
                <span key={tool.id} data-we-element-tool={tool.id}>
                  <IconActionButton
                    title={running ? `${tool.label}（正在打开）` : tool.label}
                    icon={tool.icon === 'document' ? <FileTextOutlined /> : <ExportOutlined />}
                    tone="dark"
                    loading={running}
                    disabled={Boolean(tool.disabled || runningElementToolId)}
                    onClick={() => {
                      void handleElementToolAction(tool);
                    }}
                  />
                </span>
              );
            })}
            {!isAnnotationSession && !externalAnnotationMode && externalCommentGroups.length > 0 ? (
              <span data-we-external-comments-tool-toggle="true">
                <IconActionButton
                  title={externalCommentsToolOpen ? '关闭外部批注' : '打开外部批注'}
                  icon={<MessageOutlined />}
                  tone="dark"
                  onClick={() => setExternalCommentsToolOpen((open) => !open)}
                />
              </span>
            ) : null}
            {propertyPanelEnabled &&
            styleDesignEnabled &&
            !hasElementTools &&
            !isAnnotationSession &&
            !textCommentMode &&
            !isCurrentAnnotationPanelTarget ? (
              <IconActionButton
                title={styleEditorToggleTitle}
                icon={<FormatPainterOutlined />}
                tone={bubbleStyleEditorOpen ? 'accent' : 'dark'}
                onClick={() => {
                  const nextBubbleStyleEditorOpen = !bubbleStyleEditorOpen;
                  onBubbleStyleEditorOpenChange(nextBubbleStyleEditorOpen);
                  if (nextBubbleStyleEditorOpen) {
                    setGenerateNewPrototype(false);
                    setAnnotationEditorOpen(false);
                  }
                }}
              />
            ) : null}
            {onDocumentComponent && currentTarget && !textCommentMode ? (
              <button
                type="button"
                data-we-document-component="true"
                title={selectedElementCount !== 1 ? '请选择一个组件或容器' : '截图并将说明引入 PRD 文档'}
                disabled={selectedElementCount !== 1 || savingComment}
                style={{ border: `1px solid ${EDITOR_CHROME.borderStrong}`, borderRadius: 6, background: 'transparent', color: EDITOR_CHROME.textSecondary, padding: '4px 8px', fontFamily: 'inherit', fontSize: 12, whiteSpace: 'nowrap', cursor: selectedElementCount === 1 ? 'pointer' : 'not-allowed' }}
                onClick={() => {
                  void executePromptCardDocumentAction({currentTarget, note: draftNote,
                    onConfirmNote: onConfirmNoteWithSelectedSkills, onDocumentComponent}).catch(() => {
                    // Persistence and capture failures already surface through the runtime feedback.
                  });
                }}
              >引入说明</button>
            ) : null}
            {axureSelectionExportAction.visible && !textCommentMode ? (
              <IconActionButton
                title={axureSelectionExportAction.title}
                icon={<ExportOutlined />}
                tone="dark"
                disabled={axureSelectionExportAction.disabled}
                onClick={() => {
                  triggerDesignToolExportAction({ tool: 'axure', currentTarget: promptTarget, onExportSelectionToDesignTool });
                }}
              />
            ) : null}
            {designAdjustmentTool !== 'axure' && designToolExportAction.visible && !isAnnotationSession && !textCommentMode ? (
              <IconActionButton
                title={designToolExportAction.title}
                icon={<ExportOutlined />}
                tone="dark"
                disabled={designToolExportAction.disabled}
                onClick={() => {
                  triggerDesignToolExportAction({
                    tool: designAdjustmentTool,
                    currentTarget: promptTarget,
                    onExportSelectionToDesignTool,
                  });
                }}
              />
            ) : null}
          </div>
          {!componentComposer ? <div style={{ flex: 1 }} /> : null}
          {showPromptCardExecutionActions && !componentComposer ? (
            <div
              data-we-prompt-card-execution-actions="true"
              style={{ display: 'flex', alignItems: 'center', gap: 2 }}
            >
              {appendContextAction}
              {!hideCurrentElementExecutionAction && (currentElementPromptAction.visible || generateNewPrototype) ? (
                <IconActionButton
                  title={generateNewPrototype ? '生成所选组件的状态说明原型' : promptCardSendActionTitle}
                  label={generateNewPrototype ? '生成组件状态' : onDocumentComponent ? 'AI 生成原型' : undefined}
                  icon={<CaretRightFilled />}
                  tone="accent"
                  loading={generateNewPrototype ? sendingCurrentElementPrompt : currentElementPromptAction.loading}
                  disabled={generateNewPrototype ? sendingCurrentElementPrompt || selectedElementCount !== 1 || !draftNote.trim() : currentElementPromptAction.disabled}
                  onClick={() => {
                    void handleConfirmSendCurrentElementPrompt();
                  }}
                />
              ) : null}
              {clearEditsAction}
            </div>
          ) : null}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 2,
              paddingLeft: 8,
              marginLeft: 2,
              borderLeft: `1px solid ${EDITOR_CHROME.border}`,
              flexShrink: 0,
            }}
          >
            {!isMobileDevice() && onPinnedToTopRightChange ? (
              <IconActionButton
                title={pinnedToTopRight ? '取消固定，跟随元素' : '固定到右上角'}
                icon={pinnedToTopRight ? <PushpinFilled /> : <PushpinOutlined />}
                pressed={pinnedToTopRight}
                tone={pinnedToTopRight ? 'accent' : 'dark'}
                onClick={() => onPinnedToTopRightChange(!pinnedToTopRight)}
              />
            ) : null}
            <IconActionButton
              title={promptCardCloseActionTitle}
              icon={<CloseToolIcon />}
              tone="dark"
              onClick={handlePromptCardClose}
            />
          </div>
        </div>
        <div
          data-we-prompt-card-content-scroll="true"
          style={{
            display: 'flex',
            flex: '1 1 auto',
            flexDirection: 'column',
            minHeight: 0,
            overflowX: 'hidden',
            overflowY: 'auto',
            ...(componentComposer ? { padding: '12px 12px 10px' } : {}),
          }}
        >
          {!isAnnotationSession && !externalAnnotationMode && externalCommentsToolOpen && externalCommentGroups.length > 0 ? (
            <section
              data-we-external-comments-tool="true"
              aria-label="外部批注"
              style={externalCommentsToolStyle}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  paddingBottom: 6,
                  color: EDITOR_CHROME.textSecondary,
                  fontSize: 11,
                  fontWeight: 600,
                  lineHeight: '16px',
                }}
              >
                <div
                  data-we-component-composer={componentComposer ? 'true' : undefined}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                  }}
                >
                  <MessageOutlined />
                  <span>外部批注</span>
                  <span style={{ color: EDITOR_CHROME.textMuted, fontWeight: 400 }}>
                    {externalComments.length}
                  </span>
                </div>
              </div>
              {externalCommentEntries.map(({ group, comment }, entryIndex) => (
                <div
                  key={comment.id}
                  data-we-external-comments-entry={comment.id}
                  data-we-external-comments-author={group.authorId}
                  onMouseEnter={() => setHoveredExternalCommentId(comment.id)}
                  onMouseLeave={() => setHoveredExternalCommentId(null)}
                  style={{
                    display: 'flex',
                    position: 'relative',
                    alignItems: 'flex-start',
                    padding: '8px 0',
                    borderTop: `1px solid ${EDITOR_CHROME.border}`,
                    ...(entryIndex === externalCommentEntries.length - 1
                      ? { paddingBottom: 7 }
                      : {}),
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      data-we-external-comments-author-label="true"
                      data-we-external-comments-author-kind={
                        isExternalAuthorNetworkIdentifier(group.authorName) ? 'network' : 'display'
                      }
                      style={{
                        marginBottom: 2,
                        paddingRight: onDeleteExternalComment ? 20 : 0,
                        color: EDITOR_CHROME.textMuted,
                        fontSize: 10,
                        fontWeight: 600,
                        lineHeight: '14px',
                        letterSpacing: 0,
                        ...(isExternalAuthorNetworkIdentifier(group.authorName)
                          ? { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }
                          : {}),
                        overflowWrap: 'anywhere',
                      }}
                    >
                      评审者 · {group.authorName}
                    </div>
                    <div
                      style={{
                        color: EDITOR_CHROME.textPrimary,
                        fontSize: 11,
                        lineHeight: 1.55,
                        overflowWrap: 'anywhere',
                        whiteSpace: 'pre-wrap',
                      }}
                    >
                      {comment.content}
                    </div>
                  </div>
                  {onDeleteExternalComment ? (
                    <IconActionButton
                      title="删除这条外部批注"
                      icon={<DeleteOutlined />}
                      tone="dark"
                      onClick={() => {
                        void onDeleteExternalComment(comment.id);
                      }}
                      style={{
                        width: 16,
                        minWidth: 16,
                        height: 16,
                        fontSize: 12,
                        position: 'absolute',
                        top: 7,
                        right: 0,
                        background: 'transparent',
                        opacity: hoveredExternalCommentId === comment.id ? 1 : 0,
                        pointerEvents: hoveredExternalCommentId === comment.id ? 'auto' : 'none',
                        transition: 'opacity 160ms ease',
                      }}
                    />
                  ) : null}
                </div>
              ))}
            </section>
          ) : null}
          {elementToolError ? (
            <div
              role="alert"
              style={{
                padding: '6px 10px',
                borderRadius: 8,
                background: 'rgba(255, 77, 79, 0.12)',
                color: EDITOR_CHROME.textDanger,
                fontSize: 11,
                lineHeight: 1.45,
                overflowWrap: 'anywhere',
              }}
            >
              {elementToolError.slice(0, 240)}
            </div>
          ) : null}
          {savedNoteMeta?.commenterName ? (
            <div
              data-we-prompt-card-commenter="true"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                marginBottom: 6,
                padding: '5px 8px',
                borderLeft: `3px solid ${savedNoteMeta.commenterColor || EDITOR_CHROME.accent}`,
                borderRadius: 4,
                background: EDITOR_CHROME.surfaceMuted,
                color: EDITOR_CHROME.textSecondary,
                fontSize: 11,
                lineHeight: 1.35,
              }}
            >
              <span style={{ color: EDITOR_CHROME.textMuted }}>批注者</span>
              <span style={{ color: savedNoteMeta.commenterColor || EDITOR_CHROME.textPrimary, fontWeight: 600 }}>
                {savedNoteMeta.commenterName}
              </span>
            </div>
          ) : null}
          <div
            ref={noteComposerRef}
            onFocusCapture={(event) => {
              if (inlineTextEditing) return;
              if (!shouldRestorePromptPrimaryFocusFromTarget(event.target)) return;
              window.requestAnimationFrame(() => {
                ensurePromptPrimaryFocus(3);
              });
            }}
            onPointerDownCapture={(event) => {
              if (inlineTextEditing) return;
              if (!shouldRestorePromptPrimaryFocusFromTarget(event.target)) return;
              window.requestAnimationFrame(() => {
                ensurePromptPrimaryFocus(3);
              });
            }}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              pointerEvents: inlineTextEditing ? 'none' : 'auto',
            }}
          >
          {showPromptTextInput ? (
            <div ref={textComposerRef}>
              <Input
                value={draftText}
                placeholder={TEXT_INPUT_PLACEHOLDER}
                size="small"
                style={{
                  borderRadius: 12,
                  minHeight: 32,
                  background: EDITOR_CHROME.surfaceMuted,
                  borderColor: EDITOR_CHROME.borderStrong,
                  boxShadow: 'none',
                  color: EDITOR_CHROME.textPrimary,
                }}
                onChange={(event) => {
                  onTextDraftChange(event.target.value);
                }}
                onPressEnter={(event) => {
                  if (isMobileDevice()) {
                    event.preventDefault();
                    event.stopPropagation();
                    return;
                  }
                  event.preventDefault();
                  event.stopPropagation();
                  void onConfirmText();
                }}
                onKeyDown={(event) => {
                  if (event.key !== 'Escape') return;
                  event.preventDefault();
                  event.stopPropagation();
                  if (dismissTerminalTaskAndSelection()) return;
                  onCancelText();
                }}
                onBlur={() => {
                  if (!textDirty) return;
                  void onConfirmText();
                }}
              />
            </div>
          ) : null}
          {showNoteComposer ? (
            <>
              <Dropdown
                open={skillMenuOpen}
                trigger={[]}
                placement="bottomLeft"
                autoAdjustOverflow={{ adjustX: 1, adjustY: 1 }}
                destroyOnHidden
                getPopupContainer={resolveRuntimePopupContainer}
                styles={{ root: { zIndex: POPUP_LAYER_Z_INDEX + 40 } }}
                popupRender={() => (
                  <div
                    data-we-selection-lock-root="true"
                    data-we-prompt-card-skill-menu="true"
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'stretch',
                      gap: 8,
                      padding: 10,
                      width: 'min(420px, calc(100vw - 24px))',
                      maxWidth: 'calc(100vw - 24px)',
                      maxHeight: 'min(420px, calc(100vh - 120px))',
                      overflowX: 'hidden',
                      overflowY: 'auto',
                      borderRadius: 10,
                      background: EDITOR_CHROME.surfaceElevated,
                      border: `1px solid ${EDITOR_CHROME.borderStrong}`,
                      boxShadow: EDITOR_CHROME.shadowCompact,
                    }}
                    onPointerDownCapture={() => onSelectionInteractionLockChange(true)}
                    onPointerEnter={() => {
                      onHoverSelectionSuppressedChange(true);
                    }}
                    onPointerLeave={() => {
                      onHoverSelectionSuppressedChange(false);
                    }}
                    >
                      <div
                        data-we-prompt-card-skill-menu-header="true"
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 2,
                        }}
                      >
                        <span
                          style={{
                            color: EDITOR_CHROME.textPrimary,
                            fontSize: 12,
                            fontWeight: 600,
                            lineHeight: 1.35,
                          }}
                        >
                          选择处理方式
                        </span>
                        <span
                          style={{
                            color: EDITOR_CHROME.textMuted,
                            fontSize: 11,
                            lineHeight: 1.35,
                          }}
                        >
                          点击标签应用，悬停查看详细说明
                        </span>
                      </div>
                      <div
                        data-we-prompt-card-skill-options="true"
                        style={{
                          display: 'flex',
                          flexWrap: 'wrap',
                          alignItems: 'center',
                          gap: 6,
                        }}
                      >
                        {filteredSkills.map((skill) => {
                          const selected = selectedSkills.some(
                            (selectedSkill) => selectedSkill.id === skill.id,
                          );
                          return (
                            <Tooltip
                              key={skill.id}
                              title={skill.description}
                              placement="topLeft"
                              mouseEnterDelay={0.15}
                              getPopupContainer={resolveRuntimePopupContainer}
                            >
                              <button
                                type="button"
                                data-we-prompt-card-skill-tooltip="true"
                                disabled={selected}
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  minHeight: 30,
                                  border: `1px solid ${
                                    selected ? EDITOR_CHROME.borderStrong : EDITOR_CHROME.border
                                  }`,
                                  borderRadius: 999,
                                  background: selected
                                    ? EDITOR_CHROME.surfaceInteractive
                                    : 'transparent',
                                  color: selected
                                    ? EDITOR_CHROME.textMuted
                                    : EDITOR_CHROME.textPrimary,
                                  padding: '6px 10px',
                                  fontSize: 12,
                                  lineHeight: 1.2,
                                  whiteSpace: 'nowrap',
                                  cursor: selected ? 'default' : 'pointer',
                                }}
                                onMouseDown={(event) => {
                                  event.preventDefault();
                                }}
                                onClick={() => {
                                  if (!selected) {
                                    handleSkillSelect(skill);
                                  }
                                }}
                              >
                                {skill.label}
                              </button>
                            </Tooltip>
                          );
                        })}
                      </div>
                    </div>
                )}
              >
                <div
                  style={{
                    position: 'relative',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: selectedSkills.length > 0 ? 6 : 0,
                    minHeight: selectedSkills.length > 0 ? 64 : 44,
                    justifyContent: 'center',
                    borderRadius: 12,
                    background: EDITOR_CHROME.surfaceMuted,
                    border: `1px solid ${EDITOR_CHROME.borderStrong}`,
                  }}
                >
                  {selectedSkills.length > 0 ? (
                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 6,
                        padding: '8px 8px 0',
                      }}
                    >
                      {selectedSkills.map((skill) => (
                        <button
                          key={skill.id}
                          type="button"
                          data-we-prompt-card-skill-tag="true"
                          title={`移除技能：${skill.label}`}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 5,
                            maxWidth: '100%',
                            border: `1px solid ${EDITOR_CHROME.border}`,
                            borderRadius: 999,
                            background: EDITOR_CHROME.surfaceInteractive,
                            color: EDITOR_CHROME.textSecondary,
                            padding: '3px 7px',
                            fontSize: 11,
                            lineHeight: 1.2,
                            cursor: 'pointer',
                          }}
                          onClick={() => handleSkillRemove(skill.id)}
                        >
                          <span
                            style={{
                              minWidth: 0,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {skill.label}
                          </span>
                          <CloseOutlined style={{ fontSize: 9, color: EDITOR_CHROME.textMuted }} />
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {!componentComposer && onGenerateComponentStates && !isAnnotationSession && !externalAnnotationMode && !textCommentMode ? (
                    <div data-we-component-states-option="true" style={{ padding: '7px 10px 2px', fontSize: 12, color: EDITOR_CHROME.textSecondary }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: selectedElementCount === 1 ? 'pointer' : 'not-allowed' }}>
                        <input type="checkbox" aria-label="生成到新原型" checked={generateNewPrototype} disabled={selectedElementCount !== 1 || sendingCurrentElementPrompt} style={{ accentColor: EDITOR_CHROME.accent }} onChange={event => setGenerateNewPrototype(event.target.checked)} />
                        生成到新原型
                      </label>
                      {generateNewPrototype ? <div style={{ paddingTop: 5, fontSize: 11, lineHeight: 1.6 }}>填写状态要求，生成后可逐个查看、比较和批注。</div> : null}
                    </div>
                  ) : null}
                  <Input.TextArea
                    className="we-runtime-prompt-card__textarea"
                    value={draftNote}
                    disabled={!canEditNote || savingComment}
                    readOnly={inlineTextEditing}
                    tabIndex={inlineTextEditing ? -1 : 0}
                    allowClear
                    autoSize={{ minRows: componentComposer ? 3 : 1, maxRows: componentComposer ? 6 : 4 }}
                    placeholder={generateNewPrototype ? '例如：未登录、已登录、语言菜单展开；说明各状态的变化' : notePlaceholder}
                    variant="borderless"
                    styles={{
                      textarea: {
                        color: EDITOR_CHROME.textPrimary,
                        background: 'transparent',
                        minHeight: componentComposer ? 76 : 32,
                        padding: componentComposer ? '10px 12px' : '6px 10px',
                        fontSize: componentComposer ? 13 : 12.5,
                        lineHeight: 1.55,
                        caretColor: EDITOR_CHROME.textPrimary,
                      },
                    }}
                    style={{
                      borderRadius: 12,
                      background: 'transparent',
                      borderColor: 'transparent',
                      boxShadow: 'none',
                    }}
                    onChange={(event) => {
                      onDraftChange(event.target.value);
                    }}
                    onFocus={(event) => {
                      if (!inlineTextEditing) return;
                      event.currentTarget.blur();
                    }}
                    onPasteCapture={onNotePasteCapture}
                    onKeyDown={handlePromptKeyDown}
                    onBlur={(event) => {
                      if (generateNewPrototype) return;
                      const nextTarget = event.relatedTarget;
                      if (componentComposer && nextTarget instanceof Node && rootRef.current?.contains(nextTarget)) return;
                      if (
                        nextTarget instanceof Node &&
                        noteComposerRef.current?.contains(nextTarget)
                      ) {
                        return;
                      }
                      if (!noteDirty && !selectedSkillsDirty) return;
                      void onConfirmNoteWithSelectedSkills();
                    }}
                  />
                </div>
              </Dropdown>
              <PromptImageStrip
                images={images}
                readOnly={Boolean(savedNoteMeta?.readOnly)}
                onRemoveImage={(imageId) => {
                  void onRemoveImage(imageId);
                }}
              />
            </>
          ) : null}
          {showAnnotationMarkdownEditor ? (
            <div data-we-prompt-primary-focus-exempt="true" style={annotationEditorShellStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span
                  style={{
                    minWidth: 0,
                    flex: 1,
                    fontSize: 11,
                    fontWeight: 600,
                    lineHeight: 1.4,
                    color: EDITOR_CHROME.textSecondary,
                  }}
                >
                  {documentSourceMarkdownEditor ? 'Markdown 源码' : '需求标注'}
                </span>
                {annotationDeleteAction}
              </div>
              <div data-we-annotation-markdown-editor="true" style={annotationEditorInputStyle}>
                <Input.TextArea
                  className="we-runtime-prompt-card__textarea"
                  value={annotationDraftMarkdown}
                  disabled={annotationLoading || annotationManualEditDisabled}
                  autoSize={{ minRows: 4, maxRows: 10 }}
                  placeholder={
                    documentSourceMarkdownEditor
                      ? DOCUMENT_SOURCE_MARKDOWN_PLACEHOLDER
                      : annotationManualEditDisabled
                        ? annotationManualEditMessage
                        : ANNOTATION_MARKDOWN_PLACEHOLDER
                  }
                  variant="borderless"
                  styles={{
                    textarea: {
                      color: EDITOR_CHROME.textPrimary,
                      background: 'transparent',
                      minHeight: 96,
                      padding: '10px 12px',
                      fontSize: 12,
                      lineHeight: 1.55,
                      caretColor: EDITOR_CHROME.textPrimary,
                    },
                  }}
                  style={{
                    background: 'transparent',
                    borderColor: 'transparent',
                    boxShadow: 'none',
                  }}
                  onChange={(event) => {
                    onAnnotationDraftChange(event.target.value);
                  }}
                  onKeyDown={(event) => {
                    if ((event.nativeEvent as KeyboardEvent).isComposing) return;
                    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                      event.preventDefault();
                      event.stopPropagation();
                      void saveAndCloseAnnotationMarkdownComposer();
                      return;
                    }
                    if (event.key === 'Escape') {
                      event.stopPropagation();
                    }
                  }}
                />
              </div>
            </div>
          ) : null}
          {showPromptDesignEditor && transactionManager ? (
            <PromptCardDesignEditor
              target={currentTarget}
              transactionManager={transactionManager}
              tokensService={tokensService}
              refreshKey={refreshKey}
              disabled={currentTaskRunning}
              onRefreshRequest={() => {
                setRefreshKey((value) => value + 1);
              }}
              onDeleteElement={options.onDeleteCurrentElement}
            />
          ) : null}
          {!isAnnotationSession && !bubbleStyleEditorOpen && styleSummaryLines.length > 0 ? (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                padding: '8px 10px',
                borderRadius: 12,
                background: 'rgba(255, 255, 255, 0.04)',
                border: `1px solid ${EDITOR_CHROME.border}`,
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  lineHeight: 1.4,
                  color: EDITOR_CHROME.textSecondary,
                }}
              >
                样式编辑
              </span>
              {styleSummaryLines.map((line) => (
                <span
                  key={line}
                  style={{
                    fontSize: 11,
                    lineHeight: 1.45,
                    color: EDITOR_CHROME.textMuted,
                    wordBreak: 'break-word',
                  }}
                >
                  {line}
                </span>
              ))}
            </div>
          ) : null}
          {currentAgentTask ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 6,
                padding: '2px 4px 0',
                marginTop: -2,
              }}
            >
              {currentAgentTask.status === 'completed' ? (
                <CheckCircleFilled style={{ color: '#22c55e', fontSize: 13, marginTop: 3 }} />
              ) : currentAgentTask.status === 'error' ? (
                <ExclamationCircleFilled style={{ color: '#ef4444', fontSize: 13, marginTop: 3 }} />
              ) : (
                <div style={{ marginTop: 2 }}>
                  <AgentSparkleIcon />
                </div>
              )}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  flex: 1,
                  minWidth: 0,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    minWidth: 0,
                  }}
                >
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 500,
                      color:
                        currentAgentTask.status === 'error' ? '#ef4444' : EDITOR_CHROME.textPrimary,
                    }}
                  >
                    {currentAgentTask.status === 'pending'
                      ? 'AI 准备中'
                      : currentAgentTask.status === 'created'
                        ? 'AI 正在修改'
                        : currentAgentTask.status === 'completed'
                          ? 'AI 修改完成'
                          : 'AI 修改失败'}
                  </span>
                  {currentAgentTask.status === 'error' && currentTaskErrorMessage ? (
                    <IconActionButton
                      title="复制错误信息"
                      icon={<CopyOutlined />}
                      tone="danger"
                      style={{
                        width: 20,
                        minWidth: 20,
                        height: 20,
                        fontSize: 12,
                        marginLeft: 1,
                      }}
                      onClick={() => {
                        void copyPromptCardTextToClipboard(currentTaskErrorMessage).catch(
                          () => undefined,
                        );
                      }}
                    />
                  ) : null}
                </div>
                {currentTaskDescription ? (
                  <span
                    style={{
                      fontSize: 11,
                      lineHeight: 1.5,
                      color: EDITOR_CHROME.textMuted,
                      marginTop: 1,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {currentTaskDescription}
                    {currentAgentTask.sessionId ? ` · Session ${currentAgentTask.sessionId}` : ''}
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </div>
        {componentComposer && showPromptCardExecutionActions ? (
          <ComponentPromptFooter
            newPrototypeAvailable={Boolean(onGenerateComponentStates) && showNoteComposer}
            newPrototype={generateNewPrototype}
            onNewPrototypeChange={setGenerateNewPrototype}
            selectedElementCount={selectedElementCount}
            actionVisible={!hideCurrentElementExecutionAction && (currentElementPromptAction.visible || generateNewPrototype)}
            disabled={generateNewPrototype ? sendingCurrentElementPrompt || selectedElementCount !== 1 || !draftNote.trim() : currentElementPromptAction.disabled}
            loading={generateNewPrototype ? sendingCurrentElementPrompt : currentElementPromptAction.loading}
            actionTitle={generateNewPrototype ? '生成所选组件的状态说明原型' : promptCardSendActionTitle}
            onSend={() => { void handleConfirmSendCurrentElementPrompt(); }}
            onSave={() => { void handleSaveComment(); }}
            saveDisabled={!canEditNote || !draftNote.trim() || sendingCurrentElementPrompt}
            saving={savingComment}
            shortcut={/Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? '') ? '⌘ Enter' : 'Ctrl Enter'}
            leadingActions={<>{appendContextAction}{clearEditsAction}</>}
          />
        ) : null}
        </>}
      </div>
    );

    const overlayNode = (
      <MobileSelectionOverlay
        currentTarget={currentTarget}
        promptVisible={promptVisible}
        promptCardTop={promptPosition?.top ?? 0}
        onDismiss={() => {
          void saveAndDismissPromptCard().catch(() => undefined);
        }}
      />
    );

    if (portalContainer) {
      return createPortal(
        <>
          {overlayNode}
          {promptCardNode}
        </>,
        portalContainer,
      );
    }

    return (
      <>
        {overlayNode}
        {promptCardNode}
      </>
    );
  },
);
