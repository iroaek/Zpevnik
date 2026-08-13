import { cleanup, render } from '@testing-library/react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChordSheet } from './ChordSheet';

describe('sazba textu a akordů', () => {
  afterEach(cleanup);

  it('drží akord u jeho textového úseku a označí akordový řádek', () => {
    const view = render(<ChordSheet source={'[G]Dlouhý syntetický text [C]pokračuje bezpečně dál'} />);
    expect(view.container.querySelector('.chord-line--with-chords')).not.toBeNull();
    expect(view.container.querySelectorAll('.chord-token[data-has-chord="true"]')).toHaveLength(2);
    expect(view.container.querySelectorAll('.chord')).toHaveLength(2);
  });

  it('nepřidává prázdný akordový řádek k textu bez akordů', () => {
    const view = render(<ChordSheet source={'Samostatný syntetický řádek bez akordu'} />);
    expect(view.container.querySelector('.chord-line--with-chords')).toBeNull();
    expect(view.container.querySelector('.chord')).toBeNull();
  });

  it('nikdy nevykreslí doslovné escape sekvence místo prázdné pozice akordu', () => {
    const view = render(<ChordSheet source={'Syntetický [Am7]text [C]pokračuje\n\\\\u00a0[Dm]další řádek'} />);
    expect(view.container).not.toHaveTextContent('\\u00a0');
    expect(view.container.querySelector('.chord--empty')?.textContent).toBe('\u00a0');
    expect(screen.getByRole('button', { name: /Akord Dm/ })).toBeVisible();
  });

  it('otevře lokální kytarový a klavírní diagram po klepnutí na akord', async () => {
    render(<ChordSheet source={'[G]Syntetický text'} />);
    await userEvent.click(screen.getByRole('button', { name: /Akord G; zobrazit hmat/ }));
    expect(screen.getByRole('dialog', { name: 'Hmat akordu G' })).toBeVisible();
    expect(screen.getByRole('img', { name: 'Kytarový hmat G' })).toBeVisible();
    expect(screen.getByRole('img', { name: 'Klavírní tóny akordu G' })).toBeVisible();
  });

  it('zobrazí F jako barré hmat', async () => {
    render(<ChordSheet source={'[F]Syntetický text'} />);
    await userEvent.click(screen.getByRole('button', { name: /Akord F; zobrazit hmat/ }));
    expect(screen.getByRole('img', { name: 'Kytarový hmat F s barré' })).toBeVisible();
    expect(document.querySelector('.chord-diagrams line.barre')).not.toBeNull();
    expect(screen.getByText(/barré/)).toBeVisible();
  });

  it('umožní soustředit se na jednu sloku bez změny zdrojového textu', async () => {
    const view = render(<ChordSheet focusSections source={'{soc}\n[C]První syntetická věta\n{eoc}\n[G]Druhá syntetická věta'} />);
    const sections = view.container.querySelectorAll('.song-section');
    expect(sections).toHaveLength(2);
    await userEvent.click(sections[0]);
    expect(view.container.querySelector('.chord-sheet')).toHaveClass('chord-sheet--focus-active');
    expect(sections[0]).toHaveClass('song-section--active');
  });

  it('předá hlášený akord do bezpečného návrhu opravy', async () => {
    const onSuggestCorrection = vi.fn();
    render(<ChordSheet source={'[Am7]Syntetický text'} onSuggestCorrection={onSuggestCorrection} />);
    await userEvent.click(screen.getByRole('button', { name: /Akord Am7/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Nahlásit chybný akord nebo polohu' }));
    expect(onSuggestCorrection).toHaveBeenCalledWith('Am7');
  });

  it('v režimu úprav předá přesný akord a směr ručního posunu', async () => {
    const onMoveChord = vi.fn();
    render(<ChordSheet editMode source={'[Fis]První [Gis]druhý úsek'} onMoveChord={onMoveChord} />);
    await userEvent.click(screen.getByRole('button', { name: /Akord F#; upravit polohu/ }));
    expect(screen.getByRole('dialog', { name: 'Úprava polohy akordu F#' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Posunout o jeden znak doprava' }));
    expect(onMoveChord).toHaveBeenCalledWith(0, 1);
  });
});
