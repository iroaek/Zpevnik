import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FirstRunGuide } from './FirstRunGuide';
import { firstRunGuideKey, hasCompletedFirstRunGuide } from './firstRunState';

const userId = '11111111-1111-4111-8111-111111111111';

describe('průvodce prvním spuštěním', () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
        clear: () => values.clear(),
      },
    });
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it('provede uživatele až ke stažení offline knihovny a zapamatuje dokončení', async () => {
    const onClose = vi.fn();
    const onNavigate = vi.fn();
    render(<FirstRunGuide userId={userId} role="member" onClose={onClose} onNavigate={onNavigate} />);

    expect(screen.getByRole('dialog', { name: 'Zpěvník je připravený' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Pokračovat' }));
    expect(screen.getByRole('heading', { name: 'Přihlášení zůstává v zařízení' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Pokračovat' }));
    await userEvent.click(screen.getByRole('button', { name: 'Pokračovat' }));
    await userEvent.click(screen.getByRole('button', { name: 'Pokračovat' }));
    await userEvent.click(screen.getByRole('button', { name: 'Otevřít Offline' }));

    expect(onClose).toHaveBeenCalledOnce();
    expect(onNavigate).toHaveBeenCalledWith('offline');
    expect(window.localStorage.getItem(firstRunGuideKey(userId))).toBe('completed');
    expect(hasCompletedFirstRunGuide(userId)).toBe(true);
  });
});
