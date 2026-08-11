import type { VerifiedOfflineGrant } from '../auth/offlineGrant';
import type { SecureProfile, SecureSession } from '../auth/secureAccess';
import type { Song } from '../domain/song';
import type { PendingMutation, StoredOfflineGrantRecord, UserState } from '../storage/database';

export type OnlineSessionResult =
  | { status: 'authenticated'; session: SecureSession; profile: SecureProfile }
  | { status: 'unauthenticated' };

export interface AuthRepository {
  getOnlineSession(signal?: AbortSignal): Promise<OnlineSessionResult>;
  issueOfflineGrant(profile: SecureProfile, deviceId: string): Promise<VerifiedOfflineGrant>;
  getOfflineGrant(): Promise<StoredOfflineGrantRecord | null>;
  saveOfflineGrant(grant: StoredOfflineGrantRecord): Promise<void>;
  removeOfflineGrant(): Promise<void>;
  signOut(): Promise<void>;
}

export interface SongRepository {
  getLocalSongs(userId?: string): Promise<Song[]>;
  getLocalSong(id: string, userId?: string): Promise<Song | null>;
  getLocalContentVersion(userId: string): Promise<string | null>;
  removeProtectedContent(userId: string): Promise<number>;
}

export interface SyncRepository {
  synchronize(userId: string, localState: UserState): Promise<UserState>;
  enqueueMutation(mutation: PendingMutation): Promise<void>;
  pendingMutations(userId: string): Promise<PendingMutation[]>;
}
