import { useEffect, useRef, useState } from 'react';
import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import type { ScoreAsset } from '../domain/song';
import { fetchContent } from '../pwa/contentCache';

const instrumentLabels: Record<ScoreAsset['instrument'], string> = {
  melody: 'Melodie',
  violin: 'Housle',
  cello: 'Violoncello',
  other: 'Jiný part',
};

async function loadScoreText(asset: ScoreAsset, catalogVersion: string): Promise<string> {
  const response = await fetchContent(asset.path, 'scores', catalogVersion);
  if (!response.ok) throw new Error(`Notový soubor se nepodařilo načíst (${response.status}).`);
  if (asset.format === 'musicxml') return response.text();
  const { default: JSZip } = await import('jszip');
  const archive = await JSZip.loadAsync(await response.arrayBuffer(), { checkCRC32: true });
  const container = archive.file('META-INF/container.xml');
  let scorePath = '';
  if (container) {
    const xml = new DOMParser().parseFromString(await container.async('string'), 'application/xml');
    scorePath = xml.querySelector('rootfile')?.getAttribute('full-path') ?? '';
  }
  const score = (scorePath && archive.file(scorePath)) || Object.values(archive.files).find((file) => !file.dir && /\.(musicxml|xml)$/i.test(file.name) && !file.name.startsWith('META-INF/'));
  if (!score) throw new Error('Archiv MXL neobsahuje čitelný MusicXML part.');
  return score.async('string');
}

export function ScoreViewer({ assets, catalogVersion }: { assets: ScoreAsset[]; catalogVersion: string }) {
  const [selectedPath, setSelectedPath] = useState(assets[0]?.path ?? '');
  const [zoom, setZoom] = useState(0.8);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);
  const osmdRef = useRef<OpenSheetMusicDisplay | null>(null);
  const asset = assets.find((candidate) => candidate.path === selectedPath) ?? assets[0];

  useEffect(() => {
    if (!asset || !hostRef.current) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    hostRef.current.replaceChildren();
    loadScoreText(asset, catalogVersion)
      .then(async (xml) => {
        const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
        if (cancelled) return;
        const osmd = new OpenSheetMusicDisplay(hostRef.current!, {
          autoResize: true,
          backend: 'svg',
          drawTitle: true,
          drawingParameters: 'compacttight',
        });
        osmdRef.current = osmd;
        await osmd.load(xml);
        osmd.Zoom = zoom;
        osmd.render();
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'Notový soubor je poškozený nebo nečitelný.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => {
      cancelled = true;
      osmdRef.current = null;
    };
  }, [asset, catalogVersion, zoom]);

  if (assets.length === 0) return <p className="empty-state">Pro tuto píseň nejsou k dispozici žádné notové party.</p>;
  return (
    <section className="score-panel" aria-labelledby="score-heading">
      <div className="section-heading">
        <div><p className="eyebrow">Partitura</p><h2 id="score-heading">Notové party</h2></div>
        <button type="button" className="secondary-button" onClick={() => window.print()}>Vytisknout noty</button>
      </div>
      <div className="score-controls" role="group" aria-label="Výběr notového partu a přiblížení">
        {assets.map((candidate) => (
          <button
            type="button"
            className={candidate.path === asset?.path ? 'chip chip--active' : 'chip'}
            aria-pressed={candidate.path === asset?.path}
            onClick={() => setSelectedPath(candidate.path)}
            key={candidate.path}
          >
            {instrumentLabels[candidate.instrument]}
          </button>
        ))}
        <label className="zoom-control">Zoom
          <input aria-label="Přiblížení not" type="range" min="0.6" max="1.8" step="0.1" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} />
        </label>
      </div>
      <p className="score-note">Notový zápis se v této verzi netransponuje. Transpozice akordů nemění melodii ani instrumentální part.</p>
      {loading && <p role="status">Načítám noty…</p>}
      {error && <p className="error-message" role="alert">{error}</p>}
      <div className="score-host" ref={hostRef} aria-label={`Notový part: ${asset ? instrumentLabels[asset.instrument] : ''}`} />
    </section>
  );
}
