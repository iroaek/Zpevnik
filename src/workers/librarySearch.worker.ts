/// <reference lib="webworker" />

import { searchLibraryDocuments, type LibrarySearchDocument } from '../domain/librarySearch';

type IncomingMessage =
  | { type: 'index'; documents: LibrarySearchDocument[] }
  | { type: 'search'; requestId: number; query: string };

let documents: LibrarySearchDocument[] = [];

self.addEventListener('message', (event: MessageEvent<IncomingMessage>) => {
  if (event.data.type === 'index') {
    documents = event.data.documents;
    return;
  }
  self.postMessage({
    type: 'result',
    requestId: event.data.requestId,
    ids: searchLibraryDocuments(documents, event.data.query),
  });
});

export {};
