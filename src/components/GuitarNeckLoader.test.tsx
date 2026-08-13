import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { GuitarNeckLoader } from './GuitarNeckLoader';

describe('Animované načítání zpěvníku', () => {
  afterEach(cleanup);

  it('má čitelný stav i bez animace', () => {
    const view = render(<GuitarNeckLoader message="Připravuji knihovnu" />);
    expect(screen.getByRole('status', { name: 'Připravuji knihovnu' })).toBeVisible();
    expect(view.container.querySelectorAll('.guitar-neck__string')).toHaveLength(6);
    expect(view.container.querySelectorAll('.guitar-neck__note')).toHaveLength(3);
  });
});
