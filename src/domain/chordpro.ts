export interface ChordToken {
  chord: string | null;
  lyric: string;
}

export interface ChordProSection {
  kind: 'verse' | 'chorus' | 'bridge' | 'comment';
  label: string;
  lines: ChordToken[][];
  repeated: boolean;
}

export interface ParsedChordPro {
  metadata: Record<string, string[]>;
  sections: ChordProSection[];
  firstLine: string;
}

export function sanitizeImportedText(value: string): string {
  return value
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    // Starší JSON/PDF importy mohou obsahovat jednu i více doslovných
    // zpětných lomítek před escape sekvencí. Odstranění celé skupiny je
    // důležité, jinak po jednom průchodu zůstane viditelné `\u00a0`.
    .replace(/\\+u(?:00a0|2007|202f)/gi, ' ')
    .replace(/\\+x(?:a0)/gi, ' ')
    .replace(/[\u00A0\u2007\u202F]/g, ' ')
    .split('')
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code === 9 || code === 10 || (code >= 32 && code !== 127);
    })
    .join('')
    .normalize('NFC');
}

export function stripChords(line: string): string {
  return line.replace(/\[[^\]]{1,64}\]/g, '').trim();
}

export function parseChordLine(line: string): ChordToken[] {
  // Odsazení vzniklé převodem rozvržení PDF nemá v responzivním ChordPro
  // význam a na úzkém displeji vytváří falešné prázdné sloupce.
  line = line.trimStart();
  const tokens: ChordToken[] = [];
  const matcher = /\[([^\]\n]{1,64})\]/g;
  let cursor = 0;
  let activeChord: string | null = null;
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(line)) !== null) {
    const lyric = line.slice(cursor, match.index);
    if (lyric || activeChord !== null) tokens.push({ chord: activeChord, lyric });
    activeChord = match[1].trim();
    cursor = matcher.lastIndex;
  }
  const tail = line.slice(cursor);
  if (tail || activeChord !== null || tokens.length === 0) tokens.push({ chord: activeChord, lyric: tail });
  return tokens;
}

function sectionFingerprint(section: ChordProSection): string {
  return section.lines
    .map((line) => line.map((token) => `${token.chord ?? ''}:${token.lyric}`).join('|'))
    .join('\n');
}

export function parseChordPro(source: string): ParsedChordPro {
  const text = sanitizeImportedText(source);
  const metadata: Record<string, string[]> = {};
  const sections: ChordProSection[] = [];
  let current: ChordProSection = { kind: 'verse', label: '', lines: [], repeated: false };
  let verseNumber = 1;

  const pushCurrent = () => {
    if (current.lines.some((line) => line.some((token) => token.lyric || token.chord))) sections.push(current);
  };

  for (const rawLine of text.split('\n')) {
    const directive = rawLine.trim().match(/^\{([^}:]+)(?::\s*(.*))?\}$/);
    if (directive) {
      const key = directive[1].trim().toLowerCase();
      const value = (directive[2] ?? '').trim();
      if (['start_of_chorus', 'soc', 'start_of_bridge', 'sob'].includes(key)) {
        pushCurrent();
        current = {
          kind: key.includes('chorus') || key === 'soc' ? 'chorus' : 'bridge',
          label: value || (key.includes('chorus') || key === 'soc' ? 'Refrén' : 'Mezihra'),
          lines: [],
          repeated: false,
        };
      } else if (['end_of_chorus', 'eoc', 'end_of_bridge', 'eob'].includes(key)) {
        pushCurrent();
        verseNumber += 1;
        current = { kind: 'verse', label: `${verseNumber}.`, lines: [], repeated: false };
      } else if (key === 'comment' || key === 'c') {
        pushCurrent();
        sections.push({ kind: 'comment', label: value, lines: [], repeated: false });
        current = { kind: 'verse', label: `${verseNumber}.`, lines: [], repeated: false };
      } else {
        metadata[key] = [...(metadata[key] ?? []), value];
      }
      continue;
    }
    current.lines.push(parseChordLine(rawLine));
  }
  pushCurrent();

  const seenChoruses = new Set<string>();
  for (const section of sections) {
    if (section.kind !== 'chorus') continue;
    const fingerprint = sectionFingerprint(section);
    section.repeated = seenChoruses.has(fingerprint);
    seenChoruses.add(fingerprint);
  }

  const firstLine = sections
    .flatMap((section) => section.lines)
    .map((line) => line.map((token) => token.lyric).join('').trim())
    .find(Boolean) ?? '';
  return { metadata, sections, firstLine };
}

export function metadataValue(metadata: Record<string, string[]>, ...keys: string[]): string {
  for (const key of keys) {
    const value = metadata[key]?.[0];
    if (value) return value;
  }
  return '';
}

export function metadataList(metadata: Record<string, string[]>, ...keys: string[]): string[] {
  return keys
    .flatMap((key) => metadata[key] ?? [])
    .flatMap((value) => value.split(/[;,]/))
    .map((value) => value.trim())
    .filter(Boolean);
}
