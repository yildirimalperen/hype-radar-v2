import gplayPkg from 'google-play-scraper';
import {
  PLAY_COLLECTIONS, CHART_DEPTH, PLAY_DETAIL_CONCURRENCY, PLAY_DETAIL_DELAY_MS, PLAY_DETAIL_DEADLINE_MS,
} from '../config.js';

const gplay = gplayPkg.default ?? gplayPkg;

// Throttle altında tek istek dakikalarca asılı kalabiliyor, got da 429'da
// Retry-After kadar bekleyip tekrar deniyor; süre sınırı ancak istekler de
// sınırlıysa işe yarar. Düşen oyun sıra tabanlı skorlanır, tekrar denemeye değmez.
const DETAIL_REQUEST = { timeout: 20_000, retry: 0 };

/** Bir ülke + chart için sıralı oyun listesi (Play GAME kategorisi). */
export async function fetchPlayChart(country, chart, category = 'GAME') {
  const collection = PLAY_COLLECTIONS[chart];
  if (!collection) return [];
  const res = await gplay.list({
    collection,
    category,
    num: CHART_DEPTH,
    country,
    lang: 'en',
    throttle: 10,
  });
  return res.map((a, i) => ({
    storeId: a.appId,
    title: a.title,
    publisher: a.developer,
    icon: a.icon ?? null,
    url: a.url ?? null,
    rank: i + 1,
  }));
}

/**
 * Play detayları. realInstalls Play'in verdiği GERÇEK kümülatif kurulum sayısı —
 * radardaki tek ölçülmüş (tahmin olmayan) indirme metriği.
 */
export async function enrichPlayApps(appIds, country = 'us', deadlineMs = PLAY_DETAIL_DEADLINE_MS) {
  const out = new Map();
  const queue = [...appIds];
  // Play throttle'a girince aynı iş 7 dakikadan 3 saate çıkabiliyor; süre dolunca
  // kuyruk bırakılır, eldekiyle devam edilir. Detaysız oyun sıra tabanlı skorlanır.
  const stopAt = Date.now() + deadlineMs;
  const workers = Array.from({ length: PLAY_DETAIL_CONCURRENCY }, async () => {
    while (queue.length && Date.now() < stopAt) {
      const appId = queue.shift();
      try {
        const d = await gplay.app({ appId, country, lang: 'en', requestOptions: DETAIL_REQUEST });
        out.set(appId, {
          storeId: appId,
          title: d.title,
          publisher: d.developer,
          icon: d.icon ?? null,
          url: d.url ?? null,
          genres: d.genre ? [d.genre] : null,
          releasedAt: d.released ? new Date(d.released).toISOString() : null,
          ratingCount: d.ratings ?? null,
          ratingAvg: d.score ?? null,
          // Node kütüphanesinde alan adı maxInstalls: Play'in verdiği kesin kümülatif kurulum.
          realInstalls: d.maxInstalls ?? d.realInstalls ?? null,
          installsBucket: d.installs ?? null,
          iapRange: d.IAPRange ?? (d.offersIAP ? 'IAP var' : null),
          price: d.price ?? 0,
          version: d.version ?? null,
          updatedAt: d.updated ? new Date(d.updated > 1e12 ? d.updated : d.updated * 1000).toISOString() : null,
        });
      } catch {
        // tek uygulama düşerse radar durmaz
      }
      await new Promise((r) => setTimeout(r, PLAY_DETAIL_DELAY_MS));
    }
  });
  await Promise.all(workers);
  out.skipped = queue.length;
  return out;
}
