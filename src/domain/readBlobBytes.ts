export async function readBlobBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === 'function') {
    return new Uint8Array(await blob.arrayBuffer());
  }

  return new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) resolve(new Uint8Array(reader.result));
      else reject(new Error('Vybraný soubor se nepodařilo načíst.'));
    };
    reader.onerror = () => reject(reader.error ?? new Error('Vybraný soubor se nepodařilo načíst.'));
    reader.onabort = () => reject(new Error('Načítání souboru bylo zrušeno.'));
    reader.readAsArrayBuffer(blob);
  });
}

export async function readBlobText(blob: Blob): Promise<string> {
  if (typeof blob.text === 'function') return blob.text();

  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('Vybraný soubor se nepodařilo přečíst.'));
    };
    reader.onerror = () => reject(reader.error ?? new Error('Vybraný soubor se nepodařilo přečíst.'));
    reader.onabort = () => reject(new Error('Načítání souboru bylo zrušeno.'));
    reader.readAsText(blob, 'utf-8');
  });
}
