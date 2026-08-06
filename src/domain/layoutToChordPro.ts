import { sanitizeImportedText, stripChords } from './chordpro.js';
import { parseChord, renderPitch, type ChordNotation } from './chords.js';

export interface LayoutConversionOptions {
  title: string;
  artist?: string;
  sourceNotation: ChordNotation;
}

export interface LayoutConversionResult {
  chordPro: string;
  chordCount: number;
  firstLine: string;
  originalKey: string | null;
}

interface ChordMarker {
  chord: string;
  index: number;
}

const SUFFIX_PATTERN = /^(?:(?:maj|min|mi|dim|aug|sus|add|no|m|M)|\d{1,2}|[#b+\-−°ø(),])*$/;

function normalizedHeader(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function metadataValue(value: string): string {
  return value.replace(/[{}\r\n]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function recognizedChord(rawToken: string, notation: ChordNotation): string | null {
  let token = rawToken.trim().replaceAll('♯', '#').replaceAll('♭', 'b');
  token = token.replace(/^[|:]+/, '').replace(/[|:,;]+$/, '');
  if (token.startsWith('(') && token.endsWith(')')) token = token.slice(1, -1);
  if (!token || token.length > 24) return null;
  const parsed = parseChord(token, notation);
  if (!parsed || !SUFFIX_PATTERN.test(`${parsed.quality}${parsed.extension}`)) return null;
  return token;
}

export function chordMarkers(line: string, notation: ChordNotation): ChordMarker[] {
  return [...line.matchAll(/\S+/g)]
    .map((match) => ({ chord: recognizedChord(match[0], notation), index: match.index ?? 0 }))
    .filter((marker): marker is ChordMarker => Boolean(marker.chord));
}

export function looksLikeChordLine(line: string, notation: ChordNotation): boolean {
  const tokens = [...line.matchAll(/\S+/g)];
  if (tokens.length === 0) return false;
  const recognized = chordMarkers(line, notation).length;
  return recognized > 0 && recognized / tokens.length >= 0.6;
}

function inlineChordLine(chordLine: string, lyricLine: string, notation: ChordNotation): { line: string; markers: ChordMarker[] } {
  const markers = chordMarkers(chordLine, notation);
  const requiredLength = Math.max(lyricLine.length, ...markers.map((marker) => marker.index));
  const paddedLyric = lyricLine.padEnd(requiredLength, ' ');
  let cursor = 0;
  let output = '';
  for (const marker of markers) {
    const index = Math.max(cursor, marker.index);
    output += paddedLyric.slice(cursor, index);
    output += `[${marker.chord}]`;
    cursor = index;
  }
  output += paddedLyric.slice(cursor);
  return { line: output.trimEnd(), markers };
}

function standaloneChordLine(line: string, notation: ChordNotation): { line: string; markers: ChordMarker[] } {
  return inlineChordLine(line, '', notation);
}

function removeDetectedHeaders(lines: string[], title: string, artist?: string): string[] {
  const titleHeader = normalizedHeader(title);
  const artistHeader = normalizedHeader(artist ?? '');
  let titleRemoved = false;
  let artistRemoved = !artistHeader;
  return lines.filter((line, index) => {
    if (index > 7) return true;
    const normalized = normalizedHeader(line);
    if (!titleRemoved && normalized && normalized === titleHeader) {
      titleRemoved = true;
      return false;
    }
    if (!artistRemoved && normalized && normalized === artistHeader) {
      artistRemoved = true;
      return false;
    }
    return true;
  });
}

export function convertLayoutTextToChordPro(source: string, options: LayoutConversionOptions): LayoutConversionResult {
  const sanitized = sanitizeImportedText(source);
  const lines = removeDetectedHeaders(sanitized.split('\n'), options.title, options.artist);
  const body: string[] = [];
  const allMarkers: ChordMarker[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!looksLikeChordLine(line, options.sourceNotation)) {
      body.push(line);
      continue;
    }
    const nextLine = lines[index + 1];
    const conversion = nextLine?.trim() && !looksLikeChordLine(nextLine, options.sourceNotation)
      ? inlineChordLine(line, nextLine, options.sourceNotation)
      : standaloneChordLine(line, options.sourceNotation);
    body.push(conversion.line);
    allMarkers.push(...conversion.markers);
    if (nextLine?.trim() && !looksLikeChordLine(nextLine, options.sourceNotation)) index += 1;
  }

  const firstParsed = allMarkers
    .map((marker) => parseChord(marker.chord, options.sourceNotation))
    .find((chord) => Boolean(chord));
  const originalKey = firstParsed
    ? renderPitch(firstParsed.root, options.sourceNotation, firstParsed.root.accidental === 'flat' ? 'flat' : 'sharp')
    : null;
  const firstLine = body.map((line) => stripChords(line)).find(Boolean) ?? '';
  const directives = [
    `{title: ${metadataValue(options.title)}}`,
    options.artist ? `{artist: ${metadataValue(options.artist)}}` : '',
    `{chord_notation: ${options.sourceNotation}}`,
  ].filter(Boolean);

  return {
    chordPro: `${directives.join('\n')}\n\n${body.join('\n').trim()}`.normalize('NFC'),
    chordCount: allMarkers.length,
    firstLine,
    originalKey,
  };
}
