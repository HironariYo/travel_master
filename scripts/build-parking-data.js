// 警視庁「時間制限駐車区間案内地図」のオープンデータと内閣府の祝日 CSV から、
// Worker に組み込む src/data/tokyo-parking.json を作る。データが更新されたら実行し直す（npm run build:parking）
//
// 出典: 警視庁 時間制限駐車区間案内地図オープンデータ（https://parking-meter.jp/open-data 、CC BY 4.0）
//       内閣府「国民の祝日」について（https://www8.cao.go.jp/chosei/shukujitsu/gaiyou.html）
import { writeFile } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';

const ATTR_URL = 'https://parking-meter.jp/parkingmeter_attr.csv';
const KML_URL = 'https://parking-meter.jp/parkingmeter.kml.zip';
const HOLIDAY_URL = 'https://www8.cao.go.jp/chosei/shukujitsu/syukujitsu.csv';
const OUT = new URL('../src/data/tokyo-parking.json', import.meta.url);

async function download(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// ZIP から最初の .kml を取り出す（依存パッケージを増やさないための最小限の読み込み）
function extractKml(zip) {
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('ZIP の形式が正しくありません');
  let p = zip.readUInt32LE(eocd + 16);
  const count = zip.readUInt16LE(eocd + 10);
  for (let i = 0; i < count; i++) {
    const method = zip.readUInt16LE(p + 10);
    const size = zip.readUInt32LE(p + 20);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const local = zip.readUInt32LE(p + 42);
    const name = zip.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (!name.endsWith('.kml')) continue;
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const data = zip.subarray(start, start + size);
    return { name, text: (method === 8 ? inflateRawSync(data) : data).toString('utf8') };
  }
  throw new Error('ZIP に .kml がありません');
}

// 値に半角カンマを含まない CSV（値は "..." で囲まれていることがある）
function parseCsv(text) {
  const split = (line) => line.split(',').map((v) => v.replace(/^"(.*)"$/, '$1'));
  const [header, ...lines] = text.replace(/^﻿/, '').trim().split(/\r?\n/);
  const cols = split(header);
  return lines.map((line) => Object.fromEntries(split(line).map((v, i) => [cols[i], v])));
}

const toMinutes = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

// 「日曜・休日を除く」などを、利用できない曜日の区分にする
function closedDays(text) {
  if (!text) return 'none';
  if (text === '日曜・休日を除く') return 'sunHoliday';
  if (text === '土・日曜、休日を除く') return 'weekendHoliday';
  throw new Error(`未対応の制限事項1: ${text}`);
}

const round6 = (n) => Math.round(Number(n) * 1e6) / 1e6;

const [attrCsv, kmlZip, holidayCsv] = await Promise.all([download(ATTR_URL), download(KML_URL), download(HOLIDAY_URL)]);

// 区間の線（KML）
const kml = extractKml(kmlZip);
const lines = new Map();
for (const pm of kml.text.split('<Placemark').slice(1)) {
  const id = Number(/<SimpleData name="識別id">(\d+)</.exec(pm)[1]);
  const parts = [...pm.matchAll(/<coordinates>([^<]+)<\/coordinates>/g)].map((m) =>
    m[1].trim().split(/\s+/).flatMap((pt) => pt.split(',').slice(0, 2).map(round6)),
  );
  lines.set(id, parts);
}

// 区間の属性（CSV）
const zones = [];
for (const r of parseCsv(attrCsv.toString('utf8'))) {
  const id = Number(r['識別id']);
  if (r['普通車'] !== '1') continue; // 二輪車専用などは除く
  if (r['制限事項2'] !== '１月１日〜３日を除く') throw new Error(`未対応の制限事項2: ${r['制限事項2']}`);
  const [from, to] = r['利用時間'].split('-').map(toMinutes);
  zones.push({
    id,
    kind: r['種別'] === 'パーキング・チケット' ? 'ticket' : 'meter',
    from,
    to,
    limit: Number(r['制限時間']),
    fee: Number(r['手数料']),
    closed: closedDays(r['制限事項1']),
    lines: lines.get(id) ?? [],
  });
}

// 祝日（内閣府の CSV は Shift_JIS。今年の前年以降だけ持つ）
const fromYear = new Date().getFullYear() - 1;
const holidays = new TextDecoder('shift_jis')
  .decode(holidayCsv)
  .split(/\r?\n/)
  .slice(1)
  .map((l) => l.split(',')[0])
  .filter(Boolean)
  .map((d) => d.split('/').map(Number))
  .filter(([y]) => y >= fromYear)
  .map(([y, m, d]) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);

const dataDate = /^(\d{4})(\d{2})(\d{2})_/.exec(kml.name);
const out = {
  source: '警視庁 時間制限駐車区間案内地図オープンデータ（CC BY 4.0）を加工して作成',
  sourceUrl: 'https://parking-meter.jp/open-data',
  dataDate: dataDate ? `${dataDate[1]}-${dataDate[2]}-${dataDate[3]}` : null,
  holidays,
  holidaysUntil: holidays.at(-1),
  zones,
};
await writeFile(OUT, JSON.stringify(out));
console.log(
  `zones: ${zones.length}（データ ${out.dataDate}）、祝日: ${holidays.length} 件（${holidays[0]}〜${out.holidaysUntil}）→ ${OUT.pathname}`,
);
