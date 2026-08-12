import { cleanup, render } from '@testing-library/react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
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
});
