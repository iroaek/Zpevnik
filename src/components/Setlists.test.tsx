import 'fake-indexeddb/auto';
import { useState } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { catalogSchema } from '../domain/song';
import catalogJson from '../generated/catalog.json';
import { defaultUserState, type UserState } from '../storage/database';
import { Setlists } from './Setlists';

const catalog = catalogSchema.parse(catalogJson as unknown);

function SetlistsHarness() {
  const [state, setState] = useState<UserState>(defaultUserState);
  return <Setlists
    songs={catalog.songs}
    userState={state}
    onUserStateChange={setState}
    onOpenSong={vi.fn()}
    publicSetlists={[]}
    onOpenPublicSetlist={vi.fn()}
    catalogVersion={catalog.version}
  />;
}

describe('soukromé setlisty', () => {
  afterEach(cleanup);

  it('nový setlist vybere, dovolí přejmenovat a bezpečně odstranit', async () => {
    render(<SetlistsHarness />);

    await userEvent.type(screen.getByLabelText('Název nového setlistu'), 'Zkouška');
    await userEvent.click(screen.getByRole('button', { name: 'Vytvořit' }));
    expect(screen.getByRole('tab', { name: /Zkouška/ })).toHaveAttribute('aria-selected', 'true');

    await userEvent.click(screen.getByRole('button', { name: 'Přejmenovat' }));
    const nameInput = screen.getByLabelText('Nový název');
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'Nedělní setlist');
    await userEvent.click(screen.getByRole('button', { name: 'Uložit název' }));
    expect(screen.getByRole('tab', { name: /Nedělní setlist/ })).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: 'Smazat setlist' }));
    await userEvent.click(screen.getByRole('button', { name: 'Ano, smazat setlist' }));
    expect(screen.queryByRole('tab', { name: /Nedělní setlist/ })).not.toBeInTheDocument();
    expect(screen.getByText('Zatím nemáte žádný setlist.')).toBeVisible();
  });

  it('hromadně přidá píseň, vrátí odebrání a duplikuje setlist', async () => {
    render(<SetlistsHarness />);
    await userEvent.type(screen.getByLabelText('Název nového setlistu'), 'Večer');
    await userEvent.click(screen.getByRole('button', { name: 'Vytvořit' }));
    await userEvent.click(screen.getByRole('button', { name: 'Přidat více písní' }));

    const firstSong = catalog.songs[0];
    await userEvent.click(screen.getByRole('checkbox', { name: new RegExp(firstSong.title, 'i') }));
    await userEvent.click(screen.getByRole('button', { name: 'Přidat vybrané (1)' }));
    expect(screen.getByText(firstSong.title)).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: `Odebrat ${firstSong.title}` }));
    expect(screen.getByRole('button', { name: 'Vrátit zpět' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Vrátit zpět' }));
    expect(screen.getByText(firstSong.title)).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: 'Duplikovat' }));
    expect(screen.getByRole('tab', { name: /Večer – kopie/ })).toHaveAttribute('aria-selected', 'true');
  });
});
