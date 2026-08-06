// @vitest-environment node
import { createRequire } from 'node:module';
import iconv from 'iconv-lite';
import JSZip from 'jszip';
import initSqlJs from 'sql.js';
import { describe, expect, it } from 'vitest';
import { decodeText, importFiles, proposeChordProFromPlainText } from '../scripts/lib/importer.js';

const validChordPro = `{id: synteticky-import}
{title: Syntetický import}
{language: cs}
{source: Vlastní syntetická testovací data}
{source_identifier: fixture-1}
{rights_status: synthetic}
{license: CC0-1.0}
{attribution: Integrační test}
{created_at: 2026-08-05T00:00:00.000Z}
{updated_at: 2026-08-05T00:00:00.000Z}

[C]Vymyšlený řádek`;

describe('importní pipeline', () => {
  it('rozpozná Windows-1250 a zachová českou diakritiku', () => {
    const decoded = decodeText(iconv.encode('Příliš žluťoučký kůň', 'windows-1250'));
    expect(decoded.encoding).toBe('windows-1250');
    expect(decoded.text).toBe('Příliš žluťoučký kůň');
  });

  it('importuje platný ChordPro jako publikovatelný záznam', async () => {
    const result = await importFiles([{ name: 'synteticky.cho', bytes: new TextEncoder().encode(validChordPro) }]);
    expect(result.records).toHaveLength(1);
    expect(result.records[0].status).toBe('publishable');
    expect(result.records[0].song?.rightsStatus).toBe('synthetic');
  });

  it('odmítne publikovat záznam bez údajů o právech', async () => {
    const result = await importFiles([{ name: 'chybi-prava.cho', bytes: new TextEncoder().encode('{title: Bez práv}\n[C]Test') }]);
    expect(result.records[0].status).toBe('rejected');
    expect(result.issues.some((issue) => issue.code === 'MISSING_RIGHTS')).toBe(true);
  });

  it('označí pravděpodobné duplicity a nesloučí je', async () => {
    const csv = `title,authors,source,rights_status,license,attribution,content\nStejná píseň,Autor,test,synthetic,CC0-1.0,test,[C]A\nStejna pisen,Autor,test,synthetic,CC0-1.0,test,[G]B`;
    const result = await importFiles([{ name: 'dvojice.csv', bytes: new TextEncoder().encode(csv) }]);
    expect(result.records).toHaveLength(2);
    expect(result.records.every((record) => record.status === 'requires_manual_review')).toBe(true);
    expect(result.issues.some((issue) => issue.code === 'PROBABLE_DUPLICATE')).toBe(true);
  });

  it('zpracuje podporovaný soubor uvnitř ZIP a izoluje poškozené vstupy', async () => {
    const zip = new JSZip();
    zip.file('data/pisen.cho', validChordPro);
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    const result = await importFiles([
      { name: 'balik.zip', bytes },
      { name: 'rozbite.json', bytes: new TextEncoder().encode('{') },
    ]);
    expect(result.records[0].song?.title).toBe('Syntetický import');
    expect(result.issues.some((issue) => issue.code === 'CORRUPTED_INPUT')).toBe(true);
  });

  it('načte první list XLSX bez spouštění maker', async () => {
    const xlsx = new JSZip();
    xlsx.file('xl/sharedStrings.xml', `<?xml version="1.0"?><sst><si><t>title</t></si><si><t>source</t></si><si><t>rights_status</t></si><si><t>license</t></si><si><t>attribution</t></si><si><t>content</t></si><si><t>Tabulkový test</t></si><si><t>syntetický zdroj</t></si><si><t>synthetic</t></si><si><t>CC0-1.0</t></si><si><t>test</t></si><si><t>[C]Test</t></si></sst>`);
    xlsx.file('xl/worksheets/sheet1.xml', `<?xml version="1.0"?><worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c><c r="E1" t="s"><v>4</v></c><c r="F1" t="s"><v>5</v></c></row><row r="2"><c r="A2" t="s"><v>6</v></c><c r="B2" t="s"><v>7</v></c><c r="C2" t="s"><v>8</v></c><c r="D2" t="s"><v>9</v></c><c r="E2" t="s"><v>10</v></c><c r="F2" t="s"><v>11</v></c></row></sheetData></worksheet>`);
    const result = await importFiles([{ name: 'tabulka.xlsx', bytes: await xlsx.generateAsync({ type: 'uint8array' }) }]);
    expect(result.records[0].song?.title).toBe('Tabulkový test');
    expect(result.records[0].status).toBe('publishable');
  });

  it('načte tabulku písní ze SQLite a databázi bezpečně zavře', async () => {
    const require = createRequire(import.meta.url);
    const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm');
    const SQL = await initSqlJs({ locateFile: () => wasmPath });
    const database = new SQL.Database();
    database.run('CREATE TABLE songs (title TEXT, source TEXT, rights_status TEXT, license TEXT, attribution TEXT, content TEXT)');
    database.run('INSERT INTO songs VALUES (?, ?, ?, ?, ?, ?)', ['Databázový test', 'syntetický zdroj', 'synthetic', 'CC0-1.0', 'test', '[C]Test']);
    const bytes = database.export();
    database.close();
    const result = await importFiles([{ name: 'pisne.sqlite', bytes }]);
    expect(result.records[0].song?.title).toBe('Databázový test');
    expect(result.records[0].status).toBe('publishable');
  });

  it('převede oddělený akordový řádek jen na návrh k ruční kontrole', () => {
    const proposal = proposeChordProFromPlainText('C   G\nVymyšlená věta');
    expect(proposal).toContain('umístění vyžaduje ruční kontrolu');
    expect(proposal).toContain('{rights_status: requires_review}');
  });

  it('eviduje samostatný MusicXML jako part k ručnímu přiřazení', async () => {
    const xml = '<?xml version="1.0"?><score-partwise version="4.0"></score-partwise>';
    const result = await importFiles([{ name: 'skladba/violin.musicxml', bytes: new TextEncoder().encode(xml) }]);
    expect(result.scoreCandidates).toHaveLength(1);
    expect(result.scoreCandidates[0].format).toBe('musicxml');
    expect(result.scoreCandidates[0].status).toBe('requires_manual_review');
  });
});
