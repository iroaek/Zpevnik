import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DiagnosticsPage } from './DiagnosticsPage';

const mocks = vi.hoisted(() => ({
  clearDiagnostics: vi.fn(async () => undefined),
  loadDiagnostics: vi.fn(async () => [{
    schemaVersion: 1 as const,
    id: 'synthetic-event',
    category: 'pwa' as const,
    event: 'offline_shell_ready',
    level: 'info' as const,
    occurredAt: '2026-08-13T10:00:00.000Z',
  }]),
}));

vi.mock('../storage/database', () => ({
  clearDiagnostics: mocks.clearDiagnostics,
  loadDiagnostics: mocks.loadDiagnostics,
}));

describe('diagnostika zařízení', () => {
  beforeEach(() => {
    mocks.clearDiagnostics.mockClear();
    mocks.loadDiagnostics.mockClear();
    Object.defineProperty(navigator, 'storage', { configurable: true, value: { estimate: vi.fn(async () => ({ usage: 1024, quota: 4096 })) } });
  });
  afterEach(cleanup);

  it('zobrazí lokální stav a dovolí bezpečně vymazat pouze diagnostické záznamy', async () => {
    render(<DiagnosticsPage onBack={vi.fn()} />);
    expect(await screen.findByText('offline_shell_ready')).toBeVisible();
    expect(screen.getByText('1.0 kB / 4.0 kB')).toBeVisible();
    await userEvent.click(screen.getByText('Správa místních záznamů'));
    await userEvent.click(screen.getByRole('button', { name: /Vymazat záznamy/ }));
    expect(mocks.clearDiagnostics).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Zatím nebyla zaznamenána žádná diagnostická událost.')).toBeVisible();
  });
});
