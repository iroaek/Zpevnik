import { useDeferredValue, useMemo, useState } from 'react';
import type { Song } from '../domain/song';
import { Icon } from '../ui/Icon';

type QualityFilter = 'all' | 'chords' | 'text' | 'duplicates' | 'rights';

interface QualityIssue {
  type: Exclude<QualityFilter, 'all'>;
  label: string;
}

const reviewFlagLabels: Record<NonNullable<Song['reviewFlags']>[number], QualityIssue> = {
  possible_duplicate: { type: 'duplicates', label: 'Možná duplicita' },
  missing_chords: { type: 'chords', label: 'Chybějící akordy' },
  unrecognized_glyphs: { type: 'text', label: 'Neznámé znaky nebo diakritika' },
  malformed_chord_layout: { type: 'chords', label: 'Rozpadlé umístění akordů' },
  legacy_text_spacing: { type: 'text', label: 'Starší rozložení textu' },
};

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('cs').replace(/[^a-z0-9]+/g, ' ').trim();
}

function duplicateKey(song: Song): string {
  return `${normalize(song.title)}|${normalize(song.authors[0] ?? '')}`;
}

function songIssues(song: Song, duplicateKeys: Set<string>): QualityIssue[] {
  const issues = (song.reviewFlags ?? []).map((flag) => reviewFlagLabels[flag]);
  if (!song.chordsVerified && song.contentFormat !== 'layout_text' && !issues.some((issue) => issue.type === 'chords')) {
    issues.push({ type: 'chords', label: 'Akordy čekají na ověření' });
  }
  if (song.contentFormat === 'layout_text' && !issues.some((issue) => issue.type === 'text')) {
    issues.push({ type: 'text', label: 'Rozvržení z PDF vyžaduje kontrolu' });
  }
  if (duplicateKeys.has(duplicateKey(song)) && !issues.some((issue) => issue.type === 'duplicates')) {
    issues.push({ type: 'duplicates', label: 'Shodný název a interpret' });
  }
  if (song.rightsStatus === 'requires_review' || song.rightsStatus === 'unknown' || !song.source.trim() || !song.license.trim() || !song.attribution.trim()) {
    issues.push({ type: 'rights', label: 'Práva nebo zdroj vyžadují kontrolu' });
  }
  return issues.filter((issue, index, all) => all.findIndex((candidate) => candidate.type === issue.type && candidate.label === issue.label) === index);
}

export function AdminLibraryQualityPanel({ songs, onOpenSong }: { songs: Song[]; onOpenSong: (id: string) => void }) {
  const [filter, setFilter] = useState<QualityFilter>('all');
  const [query, setQuery] = useState('');
  const [compareKey, setCompareKey] = useState('');
  const deferredQuery = useDeferredValue(query);

  const duplicateKeys = useMemo(() => {
    const counts = new Map<string, number>();
    for (const song of songs) counts.set(duplicateKey(song), (counts.get(duplicateKey(song)) ?? 0) + 1);
    return new Set([...counts.entries()].filter(([key, count]) => Boolean(key.split('|')[0]) && count > 1).map(([key]) => key));
  }, [songs]);

  const audited = useMemo(() => songs.map((song) => ({ song, issues: songIssues(song, duplicateKeys) })), [duplicateKeys, songs]);
  const duplicateGroups = useMemo(() => {
    const groups = new Map<string, Song[]>();
    for (const song of songs) {
      const key = duplicateKey(song);
      if (!duplicateKeys.has(key)) continue;
      groups.set(key, [...(groups.get(key) ?? []), song]);
    }
    return groups;
  }, [duplicateKeys, songs]);
  const comparedSongs = duplicateGroups.get(compareKey) ?? [];
  const counts = useMemo(() => ({
    all: audited.filter((entry) => entry.issues.length > 0).length,
    chords: audited.filter((entry) => entry.issues.some((issue) => issue.type === 'chords')).length,
    text: audited.filter((entry) => entry.issues.some((issue) => issue.type === 'text')).length,
    duplicates: audited.filter((entry) => entry.issues.some((issue) => issue.type === 'duplicates')).length,
    rights: audited.filter((entry) => entry.issues.some((issue) => issue.type === 'rights')).length,
  }), [audited]);
  const readyCount = songs.length - counts.all;
  const qualityPercentage = songs.length ? Math.round(readyCount / songs.length * 100) : 100;
  const needle = normalize(deferredQuery);
  const visible = useMemo(() => audited.filter((entry) => entry.issues.length > 0)
    .filter((entry) => filter === 'all' || entry.issues.some((issue) => issue.type === filter))
    .filter((entry) => !needle || normalize([entry.song.title, ...entry.song.authors, entry.song.firstLine].join(' ')).includes(needle))
    .slice(0, 120), [audited, filter, needle]);

  const filters: Array<[QualityFilter, string, number]> = [
    ['all', 'Vše k prověření', counts.all],
    ['chords', 'Akordy', counts.chords],
    ['text', 'Text a diakritika', counts.text],
    ['duplicates', 'Duplicity', counts.duplicates],
    ['rights', 'Práva a zdroje', counts.rights],
  ];

  return <section className="admin-quality" aria-labelledby="admin-quality-heading">
    <header className="admin-command-bar"><span><p className="eyebrow">Kontrola bez automatického slučování</p><h2 id="admin-quality-heading">Kvalita knihovny</h2><small>Nejasné záznamy zůstávají ve frontě, dokud je administrátor ručně neprověří.</small></span><span className="admin-quality-score"><strong>{qualityPercentage} %</strong><small>bez evidovaných problémů</small></span></header>

    <div className="admin-quality-kpis" aria-label="Souhrn kvality knihovny">
      <article><Icon name="check" /><span><small>Připravené</small><strong>{readyCount}</strong></span></article>
      <article><Icon name="music" /><span><small>Akordy</small><strong>{counts.chords}</strong></span></article>
      <article><Icon name="edit" /><span><small>Text</small><strong>{counts.text}</strong></span></article>
      <article><Icon name="copy" /><span><small>Duplicity</small><strong>{counts.duplicates}</strong></span></article>
      <article><Icon name="shield" /><span><small>Práva</small><strong>{counts.rights}</strong></span></article>
    </div>

    <div className="admin-quality-toolbar">
      <label className="search-box"><span className="visually-hidden">Hledat ve frontě kvality</span><Icon name="search" size={19} /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Název, interpret nebo první řádek…" /></label>
      <div className="quick-filter-pills" role="tablist" aria-label="Filtr problémů">{filters.map(([value, label, count]) => <button type="button" role="tab" aria-selected={filter === value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)} key={value}>{label}<small>{count}</small></button>)}</div>
    </div>

    <p className="admin-quality-note"><Icon name="info" size={18} />Duplicity se zde pouze označí. Aplikace nikdy sama nemaže ani neslučuje písně a záznamy s nejasnými právy zůstávají ve stavu ke kontrole.</p>
    {comparedSongs.length > 1 && <section className="duplicate-compare" aria-labelledby="duplicate-compare-heading"><header><span><p className="eyebrow">Ruční rozhodnutí</p><h3 id="duplicate-compare-heading">Porovnání {comparedSongs.length} verzí</h3></span><button type="button" className="icon-button" aria-label="Zavřít porovnání duplicit" onClick={() => setCompareKey('')}>×</button></header><div>{comparedSongs.map((song) => <article key={song.id}><span><strong>{song.title}</strong><small>{song.authors.join(', ') || 'Autor neuveden'}</small></span><dl><div><dt>Formát</dt><dd>{song.contentFormat === 'layout_text' ? 'PDF rozvržení' : 'ChordPro'}</dd></div><div><dt>Akordy</dt><dd>{song.chordsVerified ? 'ověřené' : 'ke kontrole'}</dd></div><div><dt>Práva</dt><dd>{song.rightsStatus}</dd></div><div><dt>Velikost</dt><dd>{song.contentBytes} B</dd></div></dl><p>{song.firstLine || 'První řádek není k dispozici.'}</p><button type="button" className="secondary-button" onClick={() => onOpenSong(song.id)}>Otevřít tuto verzi</button></article>)}</div><p>Vyberte věrohodnější verzi až po kontrole zdroje, práv, textu a poloh akordů. Automatické slučování je záměrně vypnuté.</p></section>}
    <div className="admin-quality-list" aria-busy={deferredQuery !== query}>
      {visible.map(({ song, issues }) => <article key={song.id}>
        <span className="admin-quality-song"><strong>{song.title}</strong><small>{song.authors.join(', ') || 'Autor neuveden'} · {song.contentFormat === 'layout_text' ? 'rozvržení z PDF' : 'ChordPro'}</small><span>{issues.map((issue) => <em className={`quality-badge quality-badge--${issue.type}`} key={`${issue.type}-${issue.label}`}>{issue.label}</em>)}</span></span>
        <span className="admin-quality-actions">{issues.some((issue) => issue.type === 'duplicates') && <button type="button" className="secondary-button" onClick={() => setCompareKey(duplicateKey(song))}>Porovnat verze</button>}<button type="button" className="secondary-button" onClick={() => onOpenSong(song.id)}>Otevřít a prověřit<Icon name="chevronRight" /></button></span>
      </article>)}
      {visible.length === 0 && <p className="empty-state">V tomto filtru nejsou žádné položky k prověření.</p>}
    </div>
    {counts.all > visible.length && <p className="last-update">Zobrazeno prvních {visible.length} z {counts.all} položek. Pro rychlé dohledání použijte filtr nebo hledání.</p>}
  </section>;
}
