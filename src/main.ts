import { Actor } from 'apify';
import { CheerioCrawler, Dataset, createRequestDebugInfo, social, log } from 'crawlee';
import { extractResultFromPage, sanitizeStartUrls } from './utils.js';
import { CheerioAPI } from 'cheerio';
import { RequestLimiter, CrawlStatsTracker } from './utils.js';

interface Input {
    startUrls: { url: string; immobiliareId: number }[];
    maxRequestsPerStartUrl: number;
    maxRequestsPerCrawl?: number;
    maxDepth: number;
    sameDomain: boolean;
}

await Actor.init();

const input = await Actor.getInput<Input>();
if (!input) throw new Error('There is no input, please provide some.');
const { startUrls, maxRequestsPerStartUrl, maxRequestsPerCrawl, maxDepth, sameDomain } = input;
log.info(`startUrls has ${startUrls.length} items`);

const proxyConfiguration = await Actor.createProxyConfiguration(); // TODO: proxyconfig from input

if (maxRequestsPerCrawl) {
    log.info(`Max requests per crawl set to ${maxRequestsPerCrawl}`);
}
if (maxDepth) {
    log.info(`Max depth set to ${maxDepth}`);
}
if (maxRequestsPerStartUrl) {
    log.info(`Max requests per start URL set to ${maxRequestsPerStartUrl}`);
}
if (sameDomain) {
    log.info(`Same domain set to ${sameDomain}`);
}
// TODO: log proxy configuration

// Load and manage request limit state
const STORAGE_KEY = 'requests-per-startUrl-counter';
const requestLimiter = await RequestLimiter.load(STORAGE_KEY, maxRequestsPerStartUrl);
setInterval(() => requestLimiter.persist(STORAGE_KEY), 60000);
Actor.on('migrating', () => requestLimiter.persist(STORAGE_KEY));

// Load and manage crawl stats
const statsKey = 'per-startUrl-crawl-stats';
const statsTracker = await CrawlStatsTracker.load(statsKey);
setInterval(() => statsTracker.persist(statsKey), 60000);
Actor.on('migrating', () => statsTracker.persist(statsKey));

const requestQueue = await Actor.openRequestQueue();

const crawler = new CheerioCrawler({
    requestQueue,
    proxyConfiguration,
    maxRequestsPerCrawl,
    requestHandler: async ({ request, $, enqueueLinks }) => {
        log.info('Processing page:', { url: request.loadedUrl });

        const { depth, referrer, originalUrl, immobiliareId } = request.userData;

        statsTracker.registerRequest(originalUrl, depth);

        if (depth < maxDepth) {
            await enqueueLinks({
                selector: 'a',
                requestQueue,
                strategy: sameDomain ? 'same-domain' : 'all',
                userData: {
                    depth: depth + 1,
                    referrer: request.url,
                    originalUrl,
                    immobiliareId,
                },
                transformRequestFunction: (req) => {
                    if (requestLimiter.canRequest(originalUrl)) {
                        requestLimiter.registerRequest(originalUrl);
                        return req;
                    }
                    return undefined;
                },
            });
        }

        const result = extractResultFromPage(
            request.url,
            $ as CheerioAPI,
            depth,
            immobiliareId,
            originalUrl,
            referrer
        );

        await Actor.pushData(result);
    },
    failedRequestHandler: async ({ request, error }) => {
        console.error(`Request ${request.url} failed too many times`, error);
        await Dataset.pushData({
            '#debug': createRequestDebugInfo(request),
        });
    },
});

const cleanStartUrls = sanitizeStartUrls(startUrls);
log.info(`cleanStartUrls has ${cleanStartUrls.length} items`);

await crawler.addRequests(cleanStartUrls.map(startUrl => {
    requestLimiter.registerRequest(startUrl.url); // Count initial request

    return {
        url: startUrl.url,
        userData: {
            depth: 0,
            referrer: null,
            originalUrl: startUrl.url,
            immobiliareId: startUrl.immobiliareId,
        },
    };
}));

await crawler.run();

if (!Actor.isAtHome()) {
    await Dataset.exportToJSON('results');
    log.info('Results exported to JSON');
}

await statsTracker.persist(statsKey);
log.info('Final crawl stats', statsTracker.getStats());

await Actor.exit();
