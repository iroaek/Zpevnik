import { useId } from 'react';
import { Icon } from './Icon';

export function SearchField({ value, onChange, label = 'Hledat píseň', placeholder = 'Název, autor, první řádek…' }: {
  value: string; onChange: (value: string) => void; label?: string; placeholder?: string;
}) {
  const id = useId();
  return <div className="search-field"><label className="visually-hidden" htmlFor={id}>{label}</label><Icon name="search" size={20} />
    <input id={id} type="search" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} autoComplete="off" />
    {value && <button type="button" className="icon-button" aria-label="Vymazat hledání" onClick={() => onChange('')}><Icon name="close" size={18} /></button>}
  </div>;
}
