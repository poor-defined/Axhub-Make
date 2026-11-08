import React from 'react';
import { ArrowUpOutlined, LoadingOutlined } from '@ant-design/icons';
import { EDITOR_CHROME } from './theme';

type ComponentPromptFooterProps = {
  newPrototypeAvailable: boolean;
  newPrototype: boolean;
  onNewPrototypeChange: (checked: boolean) => void;
  selectedElementCount: number;
  actionVisible: boolean;
  disabled: boolean;
  loading: boolean;
  actionTitle: string;
  onSend: () => void;
  shortcut: string;
  leadingActions?: React.ReactNode;
  onSave?: () => void;
  saveDisabled?: boolean;
  saving?: boolean;
};

export function ComponentPromptFooter(props: ComponentPromptFooterProps): React.ReactElement {
  const { newPrototype, loading } = props;
  const actionDisabled = props.disabled || loading || props.saving;
  const destinationDisabled = props.selectedElementCount !== 1 || loading || props.saving;
  const explanation = props.selectedElementCount !== 1
    ? '选择一个组件后，可生成独立状态页'
    : newPrototype ? '在独立页面展示组件的不同状态' : '调整当前选中的组件';
  return (
    <div data-we-component-prompt-footer="true" style={{ flexShrink: 0, padding: '0 12px 12px' }}>
      {props.newPrototypeAvailable ? (
        <div data-we-component-states-option="true" style={{ padding: '0 0 10px' }}>
          <label style={{
            display: 'inline-flex', alignItems: 'center', gap: 7, minHeight: 28,
            fontSize: 12, fontWeight: 500, color: EDITOR_CHROME.textSecondary,
            cursor: destinationDisabled ? 'not-allowed' : 'pointer',
          }}>
            <input
              type="checkbox"
              aria-label="生成到新原型"
              checked={newPrototype}
              disabled={destinationDisabled}
              onChange={event => props.onNewPrototypeChange(event.target.checked)}
              style={{ margin: 0, width: 15, height: 15, accentColor: EDITOR_CHROME.accent }}
            />
            生成到新原型
          </label>
          <div aria-live="polite" style={{ color: EDITOR_CHROME.textMuted, fontSize: 11, lineHeight: '18px', paddingLeft: 22 }}>
            {explanation}
          </div>
        </div>
      ) : null}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 10, borderTop: `1px solid ${EDITOR_CHROME.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>{props.leadingActions}</div>
        <div style={{ flex: 1 }} />
        {props.onSave ? (
          <button type="button" aria-label="暂存批注" disabled={props.saveDisabled || loading || props.saving} aria-busy={props.saving}
            onClick={props.onSave} style={{ minHeight: 34, padding: '7px 10px', border: `1px solid ${EDITOR_CHROME.borderStrong}`, borderRadius: 8, background: EDITOR_CHROME.surface, color: EDITOR_CHROME.textSecondary, fontFamily: 'inherit', fontSize: 12, whiteSpace: 'nowrap', cursor: props.saveDisabled || loading || props.saving ? 'not-allowed' : 'pointer' }}>
            {props.saving ? '暂存中…' : '暂存批注'}
          </button>
        ) : null}
        {props.actionVisible ? (
          <>
            {!props.onSave ? <span aria-hidden="true" style={{ color: EDITOR_CHROME.textMuted, fontSize: 10, whiteSpace: 'nowrap' }}>{props.shortcut}</span> : null}
            <button
              type="button"
              data-we-component-prompt-submit="true"
              aria-label={props.actionTitle}
              title={`${props.actionTitle} (${props.shortcut})`}
              disabled={actionDisabled}
              aria-busy={loading}
              onClick={props.onSend}
              style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                minHeight: 34, padding: '7px 12px', border: '1px solid transparent', borderRadius: 8,
                background: actionDisabled ? EDITOR_CHROME.surfaceInteractive : EDITOR_CHROME.accent,
                color: actionDisabled ? EDITOR_CHROME.textMuted : '#fff', fontFamily: 'inherit',
                fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap',
                cursor: actionDisabled ? 'not-allowed' : 'pointer',
              }}
            >
              {loading ? <LoadingOutlined spin /> : <ArrowUpOutlined />}
              {loading ? newPrototype ? '准备截图…' : '处理中…' : newPrototype ? '生成状态页' : '发送修改'}
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
