import { sanitizeImportedText, stripChords } from './chordpro.js';
import { isValidChordSymbol, normalizeSharpSpelling, parseChord, renderPitch, type ChordNotation } from './chords.js';

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
  malformedChordTokens: string[];
  containsUnknownGlyphs: boolean;
}

interface ChordMarker {
  chord: string;
  index: number;
}

const BEAT_SEPARATOR_PATTERN = /^(?:[-–—_.]+|[|:]+)$/;
const UNKNOWN_GLYPH_PATTERN = /�|\(cid:\d+\)/;

function normalizedHeader(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function metadataValue(value: string): string {
  return value.replace(/[{}\r\n]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function recognizedChord(rawToken: string, notation: ChordNotation): string | null {
  let token = rawToken.trim().replace(/♯/g, '#').replace(/♭/g, 'b');
  token = token.replace(/^[|:]+/, '').replace(/[|:,;.]+$/, '');
  if (token.startsWith('(') && token.endsWith(')')) token = token.slice(1, -1);
  token = token.replace(/^_+|[_*]+$/g, '').replace(/5-$/, 'b5');
  if (!token || token.length > 24) return null;
  if (!isValidChordSymbol(token, notation)) return null;
  return normalizeSharpSpelling(token, notation);
}

export function chordMarkers(line: string, notation: ChordNotation): ChordMarker[] {
  return [...line.matchAll(/[^\s|]+/g)]
    .map((match) => ({ chord: recognizedChord(match[0], notation), index: match.index ?? 0 }))
    .filter((marker): marker is ChordMarker => Boolean(marker.chord));
}

export function looksLikeChordLine(line: string, notation: ChordNotation): boolean {
  const tokens = [...line.matchAll(/[^\s|]+/g)].filter((match) => !BEAT_SEPARATOR_PATTERN.test(match[0]));
  if (tokens.length === 0) return false;
  const recognized = chordMarkers(line, notation).length;
  return recognized > 0 && recognized / tokens.length >= 0.6;
}

function likelyMalformedChordToken(rawToken: string, notation: ChordNotation): string | null {
  const token = rawToken.trim().replace(/^[|:]+|[|:,;.]+$/g, '').replace(/^_+|[_*]+$/g, '');
  if (!token || BEAT_SEPARATOR_PATTERN.test(token) || recognizedChord(token, notation)) return null;
  const notePrefix = notation === 'czech'
    ? /^(?:[A-H](?:is|es|[#b])?)/
    : /^(?:[A-G](?:[#b])?)/;
  const root = token.match(notePrefix)?.[0];
  if (!root) return null;
  const suffix = token.slice(root.length);
  if (!suffix || !/(?:\d|[#b/()+\-−°ø]|maj|min|mi|dim|aug|sus|add|no)/i.test(suffix)) return null;
  return token;
}

export function findLikelyMalformedChordTokens(source: string, notation: ChordNotation): string[] {
  const malformed = new Set<string>();
  for (const line of source.split('\n')) {
    const tokens = [...line.matchAll(/[^\s|]+/g)].map((match) => match[0]);
    const significantTokens = tokens.filter((token) => !BEAT_SEPARATOR_PATTERN.test(token));
    const recognizedCount = significantTokens.filter((token) => recognizedChord(token, notation)).length;
    const candidates = significantTokens.map((token) => likelyMalformedChordToken(token, notation)).filter(Boolean) as string[];
    if (recognizedCount === 0 || (recognizedCount + candidates.length) / Math.max(significantTokens.length, 1) < 0.6) continue;
    for (const candidate of candidates) malformed.add(candidate);
  }
  return [...malformed];
}

function inlineChordLine(chordLine: string, lyricLine: string, notation: ChordNotation): { line: string; markers: ChordMarker[] } {
  const expandedChordLine = chordLine.replaceAll('\t', '    ');
  const markers = chordMarkers(expandedChordLine, notation);
  const expandedLyric = lyricLine.replaceAll('\t', '    ');
  const requiredLength = Math.max(expandedLyric.length, ...markers.map((marker) => marker.index));
  const paddedLyric = expandedLyric.padEnd(requiredLength, ' ');
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

function canReceiveChordLine(line: string, notation: ChordNotation): boolean {
  const trimmed = line.trim();
  if (!trimmed || looksLikeChordLine(line, notation)) return false;
  if (/^\{[^}]+\}$/.test(trimmed)) return false;
  if (/^\(?\s*(?:capo|kapo)\b.*\)?$/i.test(trimmed)) return false;
  if (/^(?:úvod|intro|mezihra|outro|solo|ref(?:rén)?|r)\s*:?\s*$/i.test(trimmed)) return false;
  if (/^(?:[EADGBeH]\|\||.*[-|]{6,})/.test(trimmed)) return false;
  return true;
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
    let lyricIndex = index + 1;
    while (lyricIndex < lines.length && !lines[lyricIndex].trim() && lyricIndex - index <= 3) lyricIndex += 1;
    const nextLine = lines[lyricIndex];
    const conversion = nextLine && canReceiveChordLine(nextLine, options.sourceNotation)
      ? inlineChordLine(line, nextLine, options.sourceNotation)
      : standaloneChordLine(line, options.sourceNotation);
    body.push(conversion.line);
    allMarkers.push(...conversion.markers);
    if (nextLine && canReceiveChordLine(nextLine, options.sourceNotation)) index = lyricIndex;
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
    malformedChordTokens: findLikelyMalformedChordTokens(sanitized, options.sourceNotation),
    containsUnknownGlyphs: UNKNOWN_GLYPH_PATTERN.test(sanitized),
  };
}
