import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminPage } from './AdminPage';

vi.mock('./AdminUsersPanel', () => ({ AdminUsersPanel: () => <section><h2>Databáze uživatelů</h2></section> }));
vi.mock('./AdminOverview', () => ({ AdminOverview: ({ onOpen }: { onOpen: (tab: string) => void }) => <section><h2>Přehled administrace</h2><button onClick={() => onOpen('users')}>Otevřít uživatele</button></section> }));
vi.mock('./AdminAccessPanel', () => ({ AdminAccessPanel: ({ mode }: { mode: string }) => <section><h2>{mode === 'accounts' ? 'Čekající registrace' : 'Návrhy písní'}</h2></section> }));
vi.mock('./AdminLibraryQualityPanel', () => ({ AdminLibraryQualityPanel: () => <section><h2>Kvalita knihovny</h2></section> }));
vi.mock('./QrCodeGenerator', () => ({ QrCodeGenerator: () => <section><h2>QR kódy</h2></section> }));

describe('samostatná administrace', () => {
  afterEach(cleanup);

  it('nabízí profesionální přehled a odděluje uživatele, žádosti, písně a systém', async () => {
    render(<AdminPage online cloudSync={{ status: 'synced', lastSyncedAt: null, error: null, pendingCount: 0, nextRetryAt: null, refresh: vi.fn().mockResolvedValue(undefined) }} onNavigate={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Přehled administrace' })).toBeVisible();
    await userEvent.click(screen.getByRole('tab', { name: /Uživatelé/ }));
    expect(screen.getByRole('heading', { name: 'Databáze uživatelů' })).toBeVisible();
    await userEvent.click(screen.getByRole('tab', { name: /Žádosti/ }));
    expect(screen.getByRole('heading', { name: 'Čekající registrace' })).toBeVisible();
    await userEvent.click(screen.getByRole('tab', { name: /Písně/ }));
    expect(screen.getByRole('heading', { name: 'Návrhy písní' })).toBeVisible();
    await userEvent.click(screen.getByRole('tab', { name: /Kvalita/ }));
    expect(await screen.findByRole('heading', { name: 'Kvalita knihovny' })).toBeVisible();
    await userEvent.click(screen.getByRole('tab', { name: /Systém/ }));
    expect(screen.getByRole('heading', { name: 'QR kódy' })).toBeVisible();
  });
});
