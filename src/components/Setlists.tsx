import { useMemo, useState } from "react";
import type { SecureProfile } from "../auth/secureAccess";
import { createUuid } from "../domain/browserCompatibility";
import type { PublicSetlist, Song } from "../domain/song";
import { fetchContent } from "../pwa/contentCache";
import {
  createSetlist,
  duplicateSetlist,
  removeSetlist,
  renameSetlist,
  updateSetlistSongs,
  type UserState,
} from "../storage/database";
import { ChordSheet } from "./ChordSheet";
import { SharedSetlists } from "./SharedSetlists";
import { Icon } from "../ui/Icon";

type SetlistCollection = "mine" | "shared" | "public";

interface SetlistsProps {
  songs: Song[];
  userState: UserState;
  onUserStateChange: React.Dispatch<React.SetStateAction<UserState>>;
  onOpenSong: (id: string, sequence?: string[]) => void;
  publicSetlists: PublicSetlist[];
  onOpenPublicSetlist: (id: string) => void;
  catalogVersion: string;
  secureProfile?: SecureProfile | null;
  online?: boolean;
  followedLiveSetlistId?: string;
  onFollowLiveSetlist?: (setlistId: string) => void;
}

export function Setlists({
  songs,
  userState,
  onUserStateChange,
  onOpenSong,
  publicSetlists,
  onOpenPublicSetlist,
  catalogVersion,
  secureProfile = null,
  online = true,
  followedLiveSetlistId = '',
  onFollowLiveSetlist = () => undefined,
}: SetlistsProps) {
  const [name, setName] = useState("");
  const [selectedId, setSelectedId] = useState(userState.setlists[0]?.id ?? "");
  const [printSources, setPrintSources] = useState<Record<string, string>>({});
  const [printMode, setPrintMode] = useState(false);
  const [editingName, setEditingName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [message, setMessage] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [songQuery, setSongQuery] = useState("");
  const [songsToAdd, setSongsToAdd] = useState<string[]>([]);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [undo, setUndo] = useState<{
    setlistId: string;
    songId: string;
    index: number;
    title: string;
  } | null>(null);
  const [collection, setCollection] = useState<SetlistCollection>("mine");
  const [menuId, setMenuId] = useState("");
  const selectedIdExists = userState.setlists.some(
    (setlist) => setlist.id === selectedId,
  );
  const effectiveSelectedId = selectedIdExists
    ? selectedId
    : (userState.setlists[0]?.id ?? "");
  const selected = userState.setlists.find(
    (setlist) => setlist.id === effectiveSelectedId,
  );
  const songsById = useMemo(
    () => new Map(songs.map((song) => [song.id, song])),
    [songs],
  );
  const addCandidates = useMemo(() => {
    const needle = songQuery
      .trim()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("cs");
    return songs
      .filter((song) => {
        const searchable = `${song.title} ${song.authors.join(" ")}`
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLocaleLowerCase("cs");
        return !needle || searchable.includes(needle);
      })
      .slice(0, 60);
  }, [songQuery, songs]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    const id = createUuid();
    const setlistName = name.trim();
    onUserStateChange((current) => createSetlist(current, setlistName, id));
    setSelectedId(id);
    setName("");
    setMessage(`Setlist „${setlistName}“ byl vytvořen a je vybraný.`);
  };

  const move = (index: number, direction: -1 | 1) => {
    if (!selected) return;
    const next = [...selected.songIds];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onUserStateChange((current) =>
      updateSetlistSongs(current, selected.id, next),
    );
  };

  const remove = (songId: string, index: number) => {
    if (!selected) return;
    const next = [...selected.songIds];
    next.splice(index, 1);
    onUserStateChange((current) =>
      updateSetlistSongs(current, selected.id, next),
    );
    setUndo({
      setlistId: selected.id,
      songId,
      index,
      title: songsById.get(songId)?.title ?? "Píseň",
    });
    setMessage("Píseň byla ze setlistu odebrána.");
  };

  const restoreRemoved = () => {
    if (!undo) return;
    onUserStateChange((current) => {
      const target = current.setlists.find(
        (setlist) => setlist.id === undo.setlistId,
      );
      if (!target) return current;
      const next = [...target.songIds];
      next.splice(Math.min(undo.index, next.length), 0, undo.songId);
      return updateSetlistSongs(current, undo.setlistId, next);
    });
    setMessage(`Píseň „${undo.title}“ byla vrácena.`);
    setUndo(null);
  };

  const dropAt = (targetIndex: number) => {
    if (!selected || draggedIndex === null || draggedIndex === targetIndex)
      return;
    const next = [...selected.songIds];
    const [moved] = next.splice(draggedIndex, 1);
    next.splice(targetIndex, 0, moved);
    onUserStateChange((current) =>
      updateSetlistSongs(current, selected.id, next),
    );
    setDraggedIndex(null);
    setMessage("Pořadí setlistu bylo změněno.");
  };

  const addSelectedSongs = () => {
    if (!selected || songsToAdd.length === 0) return;
    const unique = songsToAdd.filter((id) => !selected.songIds.includes(id));
    onUserStateChange((current) =>
      updateSetlistSongs(current, selected.id, [
        ...selected.songIds,
        ...unique,
      ]),
    );
    setSongsToAdd([]);
    setSongQuery("");
    setAddOpen(false);
    setMessage(`${unique.length} písní bylo přidáno do setlistu.`);
  };

  const duplicateById = (sourceId: string) => {
    const source = userState.setlists.find(
      (setlist) => setlist.id === sourceId,
    );
    if (!source) return;
    const id = createUuid();
    onUserStateChange((current) => duplicateSetlist(current, source.id, id));
    setSelectedId(id);
    setMessage(`Setlist „${source.name}“ byl duplikován.`);
  };
  const duplicateSelected = () => selected && duplicateById(selected.id);

  const copySharedSetlist = (sharedName: string, songIds: string[]) => {
    const id = createUuid();
    const copyName = `${sharedName} – moje kopie`;
    onUserStateChange((current) =>
      updateSetlistSongs(createSetlist(current, copyName, id), id, songIds),
    );
    setSelectedId(id);
    setMessage(
      `Setlist „${sharedName}“ byl uložen jako vaše soukromá offline kopie.`,
    );
  };

  const saveName = (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected || !editingName.trim()) return;
    const nextName = editingName.trim();
    onUserStateChange((current) =>
      renameSetlist(current, selected.id, nextName),
    );
    setRenaming(false);
    setMessage(`Setlist byl přejmenován na „${nextName}“.`);
  };

  const deleteSelected = () => {
    if (!selected) return;
    const deletedName = selected.name;
    const remaining = userState.setlists.filter(
      (setlist) => setlist.id !== selected.id,
    );
    onUserStateChange((current) => removeSetlist(current, selected.id));
    setSelectedId(remaining[0]?.id ?? "");
    setConfirmDelete(false);
    setRenaming(false);
    setPrintMode(false);
    setMessage(
      `Setlist „${deletedName}“ byl odstraněn pouze z tohoto zařízení.`,
    );
  };

  const preparePrint = async () => {
    if (!selected) return;
    const entries = await Promise.all(
      selected.songIds.map(async (id) => {
        const song = songs.find((candidate) => candidate.id === id);
        if (!song) return [id, ""] as const;
        try {
          const response = await fetchContent(
            song.chordProPath,
            "songs",
            catalogVersion,
          );
          return [id, response.ok ? await response.text() : ""] as const;
        } catch {
          return [id, ""] as const;
        }
      }),
    );
    setPrintSources(Object.fromEntries(entries));
    setPrintMode(true);
  };

  return (
    <section className="setlists-page" aria-labelledby="setlists-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Pořadí na večer</p>
          <h1 id="setlists-heading">Setlisty</h1>
        </div>
      </div>
      <p className="lead setlists-intro">
        Vytvořte si vlastní pořadí písní. Po přihlášení se setlisty
        synchronizují mezi vašimi zařízeními; bez připojení zůstávají bezpečně
        uložené zde.
      </p>
      <div
        className={`setlist-collection-switch setlist-collection-switch--${collection}`}
        role="tablist"
        aria-label="Druh setlistů"
      >
        <span aria-hidden="true" />
        <button
          type="button"
          role="tab"
          aria-selected={collection === "mine"}
          onClick={() => setCollection("mine")}
        >
          <Icon name="list" />
          Moje <small>{userState.setlists.length}</small>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={collection === "shared"}
          onClick={() => setCollection("shared")}
        >
          <Icon name="users" />
          Sdílené
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={collection === "public"}
          onClick={() => setCollection("public")}
        >
          <Icon name="wifi" />
          Veřejné <small>{publicSetlists.length}</small>
        </button>
      </div>
      {collection === "public" && (
        <section
          className="public-setlists collection-panel"
          aria-labelledby="public-setlists-heading"
        >
          <div className="results-heading">
            <h2 id="public-setlists-heading">Veřejné setlisty</h2>
            <span>Mají vlastní QR odkaz</span>
          </div>
          {publicSetlists.length ? (
            publicSetlists.map((setlist) => (
              <button
                type="button"
                className="song-card"
                onClick={() => onOpenPublicSetlist(setlist.id)}
                key={setlist.id}
              >
                <span className="song-card__main">
                  <strong>{setlist.title}</strong>
                  <span>{setlist.description}</span>
                </span>
                <span className="song-card__meta">
                  {setlist.songIds.length} <Icon name="music" size={17} />{" "}
                  <Icon name="chevronRight" size={17} />
                </span>
              </button>
            ))
          ) : (
            <p className="empty-state">
              Zatím nejsou zveřejněné žádné veřejné setlisty.
            </p>
          )}
        </section>
      )}
      {collection === "shared" && (
        <div className="collection-panel">
          <SharedSetlists
            songs={songs}
            profile={secureProfile}
            online={online}
            selectedLocal={selected}
            onOpenSong={onOpenSong}
            followedLiveSetlistId={followedLiveSetlistId}
            onFollowLive={onFollowLiveSetlist}
            onCopyToMySetlists={(sharedName, songIds) => {
              copySharedSetlist(sharedName, songIds);
              setCollection("mine");
            }}
          />
        </div>
      )}
      {collection === "mine" && (
        <div className="collection-panel">
          <div className="results-heading private-heading">
            <h2>Moje soukromé setlisty</h2>
            <span>Offline i mezi zařízeními</span>
          </div>
          <form className="new-setlist" onSubmit={submit}>
            <label>
              Název nového setlistu
              <input
                value={name}
                maxLength={100}
                onChange={(event) => setName(event.target.value)}
                placeholder="Např. Sobota u ohně"
              />
            </label>
            <button className="primary-button" type="submit">
              Vytvořit
            </button>
          </form>
          {message && (
            <p className="success-message" role="status">
              {message}
            </p>
          )}
          {userState.setlists.length === 0 ? (
            <p className="empty-state">Zatím nemáte žádný setlist.</p>
          ) : (
            <>
              <div
                className="setlist-tabs setlist-overview-grid"
                role="tablist"
                aria-label="Setlisty"
              >
                {userState.setlists.map((setlist) => (
                  <article
                    className={
                      setlist.id === effectiveSelectedId
                        ? "setlist-overview-card setlist-overview-card--active"
                        : "setlist-overview-card"
                    }
                    key={setlist.id}
                  >
                    <button
                      type="button"
                      role="tab"
                      aria-selected={setlist.id === effectiveSelectedId}
                      onClick={() => {
                        setSelectedId(setlist.id);
                        setPrintMode(false);
                        setRenaming(false);
                        setConfirmDelete(false);
                        setMenuId("");
                      }}
                    >
                      <span>
                        <strong>{setlist.name}</strong>
                        <small>{setlist.songIds.length} písní · soukromý</small>
                      </span>
                      <Icon name="chevronRight" />
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Akce setlistu ${setlist.name}`}
                      aria-expanded={menuId === setlist.id}
                      onClick={() =>
                        setMenuId((current) =>
                          current === setlist.id ? "" : setlist.id,
                        )
                      }
                    >
                      <Icon name="menu" />
                    </button>
                    {menuId === setlist.id && (
                      <div className="setlist-card-menu" role="menu">
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setSelectedId(setlist.id);
                            setCollection("shared");
                            setMenuId("");
                          }}
                        >
                          <Icon name="upload" />
                          Sdílet členům
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setSelectedId(setlist.id);
                            setEditingName(setlist.name);
                            setRenaming(true);
                            setMenuId("");
                          }}
                        >
                          <Icon name="edit" />
                          Přejmenovat
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            duplicateById(setlist.id);
                            setMenuId("");
                          }}
                        >
                          <Icon name="copy" />
                          Duplikovat
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          className="danger"
                          onClick={() => {
                            setSelectedId(setlist.id);
                            setConfirmDelete(true);
                            setMenuId("");
                          }}
                        >
                          <Icon name="trash" />
                          Smazat
                        </button>
                      </div>
                    )}
                  </article>
                ))}
              </div>
              {selected && (
                <div className="setlist-detail">
                  <div className="setlist-detail-heading">
                    <span>
                      <p className="eyebrow">Vybraný setlist</p>
                      <h2>{selected.name}</h2>
                      <small>{selected.songIds.length} písní</small>
                    </span>
                    <div className="button-row">
                      <button
                        type="button"
                        className="primary-button"
                        onClick={() => setAddOpen((value) => !value)}
                      >
                        Přidat více písní
                      </button>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={duplicateSelected}
                      >
                        Duplikovat
                      </button>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => {
                          setEditingName(selected.name);
                          setRenaming(true);
                          setConfirmDelete(false);
                        }}
                      >
                        Přejmenovat
                      </button>
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={selected.songIds.length === 0}
                        onClick={preparePrint}
                      >
                        Náhled a tisk
                      </button>
                      <button
                        type="button"
                        className="danger-button"
                        onClick={() => {
                          setConfirmDelete(true);
                          setRenaming(false);
                        }}
                      >
                        Smazat setlist
                      </button>
                    </div>
                  </div>
                  {addOpen && (
                    <section
                      className="setlist-multi-add"
                      aria-labelledby="setlist-multi-add-heading"
                    >
                      <div className="results-heading">
                        <h3 id="setlist-multi-add-heading">
                          Přidat více písní
                        </h3>
                        <span>Vybráno {songsToAdd.length}</span>
                      </div>
                      <label>
                        Hledat píseň
                        <input
                          type="search"
                          value={songQuery}
                          onChange={(event) => setSongQuery(event.target.value)}
                          placeholder="Název nebo autor…"
                        />
                      </label>
                      <div className="setlist-song-picker">
                        {addCandidates.map((song) => {
                          const alreadyAdded = selected.songIds.includes(
                            song.id,
                          );
                          return (
                            <label
                              key={song.id}
                              className={alreadyAdded ? "disabled" : ""}
                            >
                              <input
                                type="checkbox"
                                checked={
                                  songsToAdd.includes(song.id) || alreadyAdded
                                }
                                disabled={alreadyAdded}
                                onChange={(event) =>
                                  setSongsToAdd((current) =>
                                    event.target.checked
                                      ? [...current, song.id]
                                      : current.filter((id) => id !== song.id),
                                  )
                                }
                              />
                              <span>
                                <strong>{song.title}</strong>
                                <small>
                                  {alreadyAdded
                                    ? "Už je v setlistu"
                                    : song.authors.join(", ") ||
                                      "Autor neuveden"}
                                </small>
                              </span>
                            </label>
                          );
                        })}
                      </div>
                      <div className="button-row">
                        <button
                          type="button"
                          className="primary-button"
                          disabled={songsToAdd.length === 0}
                          onClick={addSelectedSongs}
                        >
                          Přidat vybrané ({songsToAdd.length})
                        </button>
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => {
                            setAddOpen(false);
                            setSongsToAdd([]);
                          }}
                        >
                          Zrušit
                        </button>
                      </div>
                    </section>
                  )}
                  {renaming && (
                    <form className="setlist-inline-form" onSubmit={saveName}>
                      <label>
                        Nový název
                        <input
                          value={editingName}
                          maxLength={100}
                          autoFocus
                          onChange={(event) =>
                            setEditingName(event.target.value)
                          }
                        />
                      </label>
                      <div className="button-row">
                        <button
                          type="submit"
                          className="primary-button"
                          disabled={!editingName.trim()}
                        >
                          Uložit název
                        </button>
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => setRenaming(false)}
                        >
                          Zrušit
                        </button>
                      </div>
                    </form>
                  )}
                  {confirmDelete && (
                    <div
                      className="confirm-row setlist-delete-confirm"
                      role="alert"
                    >
                      <strong>
                        Opravdu odstranit setlist „{selected.name}“?
                      </strong>
                      <span>
                        Písně zůstanou v knihovně; odstraní se pouze toto pořadí
                        v tomto zařízení.
                      </span>
                      <div className="button-row">
                        <button
                          type="button"
                          className="danger-button"
                          onClick={deleteSelected}
                        >
                          Ano, smazat setlist
                        </button>
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => setConfirmDelete(false)}
                        >
                          Zrušit
                        </button>
                      </div>
                    </div>
                  )}
                  {undo?.setlistId === selected.id && (
                    <div className="undo-bar" role="status">
                      <span>„{undo.title}“ byla odebrána.</span>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={restoreRemoved}
                      >
                        Vrátit zpět
                      </button>
                    </div>
                  )}
                  {selected.songIds.map((songId, index) => {
                    const song = songsById.get(songId);
                    if (!song) return null;
                    return (
                      <div
                        className={`setlist-row ${draggedIndex === index ? "setlist-row--dragging" : ""}`}
                        draggable
                        onDragStart={() => setDraggedIndex(index)}
                        onDragEnd={() => setDraggedIndex(null)}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={() => dropAt(index)}
                        key={`${songId}-${index}`}
                      >
                        <span
                          className="order-number"
                          aria-label={`Pořadí ${index + 1}`}
                        >
                          {index + 1}
                        </span>
                        <button
                          className="setlist-song"
                          type="button"
                          onClick={() => onOpenSong(songId, selected.songIds)}
                        >
                          {song.title}
                          <small>Podržte a přetáhněte pro změnu pořadí</small>
                        </button>
                        <button
                          type="button"
                          className="icon-button"
                          aria-label={`Posunout ${song.title} nahoru`}
                          disabled={index === 0}
                          onClick={() => move(index, -1)}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className="icon-button"
                          aria-label={`Posunout ${song.title} dolů`}
                          disabled={index === selected.songIds.length - 1}
                          onClick={() => move(index, 1)}
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          className="icon-button"
                          aria-label={`Odebrat ${song.title}`}
                          onClick={() => remove(songId, index)}
                        >
                          ×
                        </button>
                      </div>
                    );
                  })}
                  {selected.songIds.length === 0 && (
                    <p className="empty-state">
                      Písně přidáte z detailu skladby.
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
      {printMode && selected && (
        <section className="setlist-print" aria-label="Tiskový náhled setlistu">
          <div className="print-preview-actions">
            <h2>Tiskový náhled: {selected.name}</h2>
            <button
              type="button"
              className="primary-button"
              onClick={() => window.print()}
            >
              Vytisknout celý setlist
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => setPrintMode(false)}
            >
              Zavřít náhled
            </button>
          </div>
          {selected.songIds.map((id) => {
            const song = songs.find((candidate) => candidate.id === id);
            return song ? (
              <article className="print-song" key={id}>
                <h1>{song.title}</h1>
                <p>{song.authors.join(", ")}</p>
                {printSources[id] ? (
                  <ChordSheet
                    source={printSources[id]}
                    notation={userState.settings.notation}
                    fontSize={18}
                  />
                ) : (
                  <p>Obsah se nepodařilo načíst.</p>
                )}
              </article>
            ) : null;
          })}
        </section>
      )}
    </section>
  );
}
