import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminPage } from './AdminPage';

vi.mock('./AdminUsersPanel', () => ({ AdminUsersPanel: () => <section><h2>Databáze uživatelů</h2></section> }));
vi.mock('./AdminAccessPanel', () => ({ AdminAccessPanel: ({ mode }: { mode: string }) => <section><h2>{mode === 'accounts' ? 'Čekající registrace' : 'Návrhy písní'}</h2></section> }));
vi.mock('./QrCodeGenerator', () => ({ QrCodeGenerator: () => <section><h2>QR kódy</h2></section> }));

describe('samostatná administrace', () => {
  afterEach(cleanup);

  it('odděluje uživatele, žádosti, písně a systém', async () => {
    render(<AdminPage online cloudSync={{ status: 'synced', lastSyncedAt: null, error: null, refresh: vi.fn().mockResolvedValue(undefined) }} onNavigate={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Databáze uživatelů' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: /Žádosti/ }));
    expect(screen.getByRole('heading', { name: 'Čekající registrace' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: /Písně/ }));
    expect(screen.getByRole('heading', { name: 'Návrhy písní' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: /Systém/ }));
    expect(screen.getByRole('heading', { name: 'QR kódy' })).toBeVisible();
  });
});
