import { StartPromptCard, type StartPromptCardIcon } from './StartPromptCard';
import { StartPromptGrid } from './StartPromptGrid';
import type { ReactNode } from 'react';

export type ThemeStartPromptCard = {
  id: string;
  title: string;
  prompt: string;
  icon: StartPromptCardIcon;
};

export function ThemeStartPromptGrid({
  cards,
  ariaLabel = '主题来源',
  disabled,
  copyOnSelect = false,
  selectPrompt,
  onCopyPrompt,
  onExecutePrompt,
  trailingCard,
}: {
  cards: readonly ThemeStartPromptCard[];
  ariaLabel?: string;
  disabled: boolean;
  copyOnSelect?: boolean;
  selectPrompt: (prompt: string) => void;
  onCopyPrompt: (card: ThemeStartPromptCard) => void | Promise<void>;
  onExecutePrompt?: (card: ThemeStartPromptCard) => void | Promise<void>;
  trailingCard?: ReactNode;
}) {
  return (
    <StartPromptGrid ariaLabel={ariaLabel}>
      {cards.map((card) => (
        <StartPromptCard
          key={card.id}
          title={card.title}
          icon={card.icon}
          selectionDisabled={disabled}
          onSelect={() => {
            if (disabled || !card.prompt.trim()) return;
            if (copyOnSelect) {
              void onCopyPrompt(card);
              return;
            }
            selectPrompt(card.prompt);
          }}
          onCopy={() => onCopyPrompt(card)}
          onExecute={onExecutePrompt ? () => onExecutePrompt(card) : undefined}
        />
      ))}
      {trailingCard}
    </StartPromptGrid>
  );
}
