import { z } from 'zod';
import { catalogSchema, type Song } from './domain/song';

const personalSummarySchema = z.object({
  sourceDirectory: z.string().min(1),
  songCount: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
  continuationCandidates: z.number().int().nonnegative(),
  exactDuplicateGroups: z.number().int().nonnegative(),
});

const responseSchema = catalogSchema.extend({ personalSummary: personalSummarySchema });

export type PersonalLibrarySummary = z.infer<typeof personalSummarySchema>;

export interface PersonalLibraryData {
  songs: Song[];
  summary: PersonalLibrarySummary;
}

export async function loadPersonalLibrary(signal?: AbortSignal): Promise<PersonalLibraryData | null> {
  const response = await fetch('/__personal_library/catalog.json', { cache: 'no-store', signal });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Osobní katalog se nepodařilo načíst (${response.status}).`);
  const parsed = responseSchema.parse(await response.json());
  const songs = parsed.songs.filter((song) => song.personalOnly && song.rightsStatus === 'requires_review');
  return { songs, summary: { ...parsed.personalSummary, songCount: songs.length } };
}
