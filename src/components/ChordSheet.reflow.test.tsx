import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { ChordSheet } from './ChordSheet';

afterEach(cleanup);
it('zachová řádky intra, prázdné řádky, diakritiku i lomené akordy při zvětšení', () => {
  const source = '[Am7] [C] [Am7] [C]\n[H7/F#]\n\n[Bmaj7]Žluťoučký syntetický text';
  const view = render(<ChordSheet source={source} sourceNotation="czech" fontSize={20} />);
  expect(view.container.querySelectorAll('.chord-line--instrumental')).toHaveLength(2);
  expect(view.container.querySelector('.chord-line--instrumental')?.querySelectorAll('.chord-token')).toHaveLength(4);
  const before = view.container.textContent;
  view.rerender(<ChordSheet source={source} sourceNotation="czech" fontSize={34} />);
  expect(view.container.textContent).toBe(before);
  view.rerender(<ChordSheet source={source} sourceNotation="czech" semitones={1} />);
  expect(view.container.textContent).toContain('C7/G');
  expect(view.container.textContent).toContain('Hmaj7');
});
