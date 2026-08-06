import { z } from 'zod';

export const RIGHTS_STATUSES = [
  'public_domain',
  'licensed',
  'user_owned',
  'synthetic',
  'requires_review',
  'unknown',
] as const;

export const scoreAssetSchema = z.object({
  instrument: z.enum(['melody', 'violin', 'cello', 'other']),
  format: z.enum(['musicxml', 'mxl']),
  path: z.string().min(1),
  clef: z.string().default('unspecified'),
  arrangementType: z.enum(['original', 'user_arrangement', 'generated_draft']),
  source: z.string().min(1),
  rightsStatus: z.enum(RIGHTS_STATUSES),
  license: z.string().min(1),
  byteSize: z.number().int().nonnegative(),
});

export const songSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  title: z.string().min(1),
  sortTitle: z.string().min(1),
  alternativeTitles: z.array(z.string()),
  authors: z.array(z.string()),
  lyricists: z.array(z.string()),
  composers: z.array(z.string()),
  language: z.string().min(2),
  originalKey: z.string().nullable(),
  timeSignature: z.string().nullable(),
  tempo: z.number().positive().nullable(),
  capo: z.number().int().min(0).max(12).nullable(),
  tags: z.array(z.string()),
  categories: z.array(z.string()),
  difficulty: z.enum(['easy', 'medium', 'hard', 'unknown']),
  firstLine: z.string(),
  chordProPath: z.string().min(1),
  contentBytes: z.number().int().nonnegative(),
  contentFormat: z.enum(['chordpro', 'layout_text']).optional(),
  personalOnly: z.boolean().optional(),
  chordsVerified: z.boolean().optional(),
  reviewFlags: z.array(z.enum([
    'possible_duplicate',
    'missing_chords',
    'unrecognized_glyphs',
    'malformed_chord_layout',
    'legacy_text_spacing',
  ])).optional(),
  scoreAssets: z.array(scoreAssetSchema),
  source: z.string().min(1),
  sourceIdentifier: z.string().min(1),
  rightsStatus: z.enum(RIGHTS_STATUSES),
  license: z.string().min(1),
  attribution: z.string().min(1),
  notes: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const publicSetlistSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  title: z.string().min(1),
  description: z.string(),
  songIds: z.array(z.string()).min(1),
  source: z.string().min(1),
  rightsStatus: z.enum(RIGHTS_STATUSES),
  license: z.string().min(1),
  attribution: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const catalogSchema = z.object({
  schemaVersion: z.literal(3),
  version: z.string().min(8),
  generatedAt: z.string().datetime(),
  songs: z.array(songSchema),
  publicSetlists: z.array(publicSetlistSchema),
});

export type ScoreAsset = z.infer<typeof scoreAssetSchema>;
export type Song = z.infer<typeof songSchema>;
export type PublicSetlist = z.infer<typeof publicSetlistSchema>;
export type Catalog = z.infer<typeof catalogSchema>;

export function isPublishable(song: Song): boolean {
  const blocked = new Set(['requires_review', 'unknown']);
  return Boolean(song.source.trim()) && Boolean(song.license.trim()) && !blocked.has(song.rightsStatus);
}
