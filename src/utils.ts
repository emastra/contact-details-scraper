import { CheerioAPI } from 'cheerio';
import { log, social } from 'crawlee';
import { Actor, KeyValueStore } from 'apify';

export function extractResultFromPage(
  url: string,
  $: CheerioAPI,
  depth: number,
  immobiliareId: number,
  originalUrl: string,
  referrer: string | null
) {
  const html = $.html();
  const domain = getDomain(url);
  const socialHandles = social.parseHandlesFromHtml(html, { text: $.text(), $ });
  const whatsappResult = extractWhatsAppNumbersFromCheerio($);

  return {
      depth,
      immobiliareId,
      startUrl: originalUrl,
      referrerUrl: referrer,
      currentUrl: url,
      domain,
      ...socialHandles,
      ...whatsappResult,
  };
}

function getDomain(url: string): string | null {
    try {
        return new URL(url).hostname;
    } catch (error) {
        return null;
    }
}

function extractWhatsAppNumbersFromCheerio($: CheerioAPI): { whatsapps: string[] } {
    const whatsapps = new Set<string>();
    const regex = /https?:\/\/(?:wa\.me|api\.whatsapp\.com\/send\?phone=)(\d{6,15})/gi;

    const html: string = $.html();
    let match: RegExpExecArray | null;
    while ((match = regex.exec(html)) !== null) {
        whatsapps.add(match[1]);
    }

    $('script').each((_, el) => {
        const scriptContent = $(el).html();
        if (scriptContent) {
            let scriptMatch: RegExpExecArray | null;
            while ((scriptMatch = regex.exec(scriptContent)) !== null) {
                whatsapps.add(scriptMatch[1]);
            }
        }
    });

    return { whatsapps: Array.from(whatsapps) };
}

export function sanitizeStartUrls(startUrls: any[]) {
    return startUrls.filter((entry, index) => {
        if (
            entry &&
            typeof entry === "object" &&
            typeof entry.url === "string" &&
            isValidUrlString(entry.url)
        ) {
            entry.url = entry.url.trim();
            return true;
        } else {
            console.warn(`Invalid URL skipped at index ${index}:`, entry?.url);
            return false;
        }
    });
}

function isValidUrlString(url: string): boolean {
    try {
        const parsed = new URL(url.trim());
        return !!parsed.protocol && !!parsed.hostname;
    } catch {
        return false;
    }
}

export function isJunkUrl(url: string): boolean {
  const junkPatterns = [
    /^(mailto:|tel:)/i,            // Matches mailto: or tel: scheme at the start
    /\/(privacy|terms|cookie|newsletter|login|signup|register)/i,  // Matches common junk paths
    /\.(pdf|doc|docx|xls|xlsx|ppt|pptx)$/i,  // Matches various document file extensions
    /\?share=/i,                   // Matches URLs with ?share= query parameter
    /\/cdn\//i,                    // Matches /cdn/ in the path
    /\/static\//i                  // Matches /static/ in the path
  ];
  
  return junkPatterns.some((pattern) => pattern.test(url));
}

export class RequestLimiter {
  private counters: Record<string, number>;
  private limit: number;
  private loggedUrls: Set<string>;

  constructor(limit: number, initialState: Record<string, number> = {}) {
      this.limit = limit;
      this.counters = initialState;
      this.loggedUrls = new Set();
  }

  canRequest(url: string): boolean {
      return (this.counters[url] || 0) < this.limit;
  }

  registerRequest(url: string): void {
      const current = this.counters[url] || 0;
      const updated = current + 1;
      this.counters[url] = updated;

      if (updated === this.limit && !this.loggedUrls.has(url)) {
          log.info(`Reached max requests for start URL: ${url}`);
          this.loggedUrls.add(url);
      }
  }

  toJSON(): Record<string, number> {
      return this.counters;
  }

  async persist(storageKey: string): Promise<void> {
      await Actor.setValue(storageKey, this.counters);
  }

  static async load(storageKey: string, limit: number): Promise<RequestLimiter> {
      const state = await Actor.getValue<Record<string, number>>(storageKey);
      return new RequestLimiter(limit, state || {});
  }
}

type CrawlStats = {
  totalRequests: number;
  maxDepthReached: number;
};

export class CrawlStatsTracker {
  private stats: Record<string, { enqueued: Set<string> }>;

  private constructor(stats: Record<string, { enqueued: Set<string> }>) {
      this.stats = stats;
  }

  static async load(key: string): Promise<CrawlStatsTracker> {
      const store = await KeyValueStore.open();
      const rawStats = await store.getValue(key) as Record<string, { enqueued: string[] }> || {};
      
      // Convert enqueued URLs from arrays to Sets for faster lookups
      const stats = Object.fromEntries(
          Object.entries(rawStats).map(([key, val]) => [
              key, 
              { enqueued: new Set(val.enqueued) }
          ])
      );
      return new CrawlStatsTracker(stats);
  }

  // Register an enqueued URL for a specific startUrl
  trackEnqueuedLink(startUrl: string, url: string) {
      const stat = this.stats[startUrl] ||= { enqueued: new Set() };
      stat.enqueued.add(url);
  }

  // Get stats, including a sample of enqueued URLs for each startUrl
  getStats() {
      return Object.fromEntries(
          Object.entries(this.stats).map(([key, val]): [string, { enqueuedCount: number; enqueuedSample: string[] }] => {
              return [
                  key, 
                  {
                      enqueuedCount: val.enqueued.size, // Count of enqueued links
                      enqueuedSample: Array.from(val.enqueued).slice(0, 5), // First 5 enqueued URLs
                  }
              ];
          })
      );
  }

  // Persist the stats to the key-value store
  async persist(key: string) {
      const store = await KeyValueStore.open();

      const serializableStats = Object.fromEntries(
          Object.entries(this.stats).map(([startUrl, stat]): [string, { enqueued: string[] }] => {
              return [
                  startUrl, 
                  {
                      enqueued: Array.from(stat.enqueued), // Convert Set to Array for persistence
                  }
              ];
          })
      );

      // Persist the stats to the key-value store
      await store.setValue(key, serializableStats);
  }
}


