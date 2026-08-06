import { useState } from 'react';
import QRCode from 'qrcode';

function initialInstallUrl(): string {
  const applicationBase = new URL(import.meta.env.BASE_URL, window.location.origin);
  return new URL('install', applicationBase).toString();
}

function normalizeWebUrl(value: string): string {
  const parsed = new URL(value.trim());
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Zadejte úplnou webovou adresu začínající http:// nebo https://.');
  return parsed.toString();
}

export function QrCodeGenerator() {
  const [url, setUrl] = useState(initialInstallUrl);
  const [encodedUrl, setEncodedUrl] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const generate = async () => {
    setBusy(true);
    setError('');
    try {
      const normalized = normalizeWebUrl(url);
      const generated = await QRCode.toDataURL(normalized, {
        width: 768,
        margin: 4,
        errorCorrectionLevel: 'M',
        color: { dark: '#000000', light: '#ffffff' },
      });
      setEncodedUrl(normalized);
      setImageUrl(generated);
    } catch (caught) {
      setEncodedUrl('');
      setImageUrl('');
      setError(caught instanceof Error && caught.message.startsWith('Zadejte') ? caught.message : 'QR kód se nepodařilo vytvořit. Zkontrolujte zadanou adresu.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="backup-card qr-generator-card" aria-labelledby="qr-generator-heading">
      <div className="qr-generator-copy">
        <p className="eyebrow">Pouze administrátor</p>
        <h2 id="qr-generator-heading">Generátor QR kódu</h2>
        <p>Vložte instalační stránku, píseň nebo jiný webový odkaz. QR kód vznikne pouze v tomto zařízení a adresa se neposílá žádné externí službě.</p>
        <form onSubmit={(event) => { event.preventDefault(); void generate(); }}>
          <label htmlFor="qr-generator-url">Odkaz pro QR kód</label>
          <input id="qr-generator-url" type="url" inputMode="url" required maxLength={2048} value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://…" />
          <button type="submit" className="primary-button" disabled={busy}>{busy ? 'Vytvářím…' : 'Vytvořit QR kód'}</button>
        </form>
        {error && <p className="error-message" role="alert">{error}</p>}
      </div>
      {imageUrl && (
        <div className="qr-generator-preview">
          <img src={imageUrl} alt={`QR kód pro adresu ${encodedUrl}`} />
          <a className="secondary-button qr-download" href={imageUrl} download="zpevnik-qr-kod.png">Stáhnout QR jako PNG</a>
          <small>{encodedUrl}</small>
        </div>
      )}
    </section>
  );
}
