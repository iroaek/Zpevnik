interface GuitarNeckLoaderProps {
  message?: string;
  compact?: boolean;
}

export function GuitarNeckLoader({ message = 'Připravuji váš zpěvník…', compact = false }: GuitarNeckLoaderProps) {
  return (
    <main className={`guitar-loader${compact ? ' guitar-loader--compact' : ''}`} role="status" aria-live="polite" aria-label={message}>
      <div className="guitar-loader__halo" aria-hidden="true" />
      <div className="guitar-neck" aria-hidden="true">
        <span className="guitar-neck__nut" />
        <span className="guitar-neck__fret guitar-neck__fret--1" />
        <span className="guitar-neck__fret guitar-neck__fret--2" />
        <span className="guitar-neck__fret guitar-neck__fret--3" />
        <span className="guitar-neck__fret guitar-neck__fret--4" />
        <span className="guitar-neck__fret guitar-neck__fret--5" />
        {Array.from({ length: 6 }, (_, index) => <i className={`guitar-neck__string guitar-neck__string--${index + 1}`} key={index} />)}
        <b className="guitar-neck__note guitar-neck__note--one" />
        <b className="guitar-neck__note guitar-neck__note--two" />
        <b className="guitar-neck__note guitar-neck__note--three" />
      </div>
      <div className="guitar-loader__copy">
        <strong>{message}</strong>
        <span>Texty a akordy ladíme do správné polohy</span>
      </div>
      <div className="guitar-loader__progress" aria-hidden="true"><span /></div>
    </main>
  );
}
