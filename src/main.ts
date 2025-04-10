import { Actor, ProxyConfigurationOptions } from 'apify';
import { CheerioCrawler, Dataset, createRequestDebugInfo, social, log } from 'crawlee';
import { extractResultFromPage, sanitizeStartUrls } from './utils.js';
import { CheerioAPI } from 'cheerio';
import { RequestLimiter, CrawlStatsTracker } from './utils.js';

interface Input {
    startUrls: { url: string; immobiliareId: number }[];
    maxRequestsPerStartUrl: number;
    maxRequestsPerCrawl?: number;
    maxDepth: number;
    enqueueStrategy: 'all' | 'same-domain' | 'same-hostname' | 'same-origin';
    proxyConfigurationOptions?: ProxyConfigurationOptions;
}

await Actor.init();

const input = await Actor.getInput<Input>();
if (!input) throw new Error('There is no input, please provide some.');
const { 
    startUrls, 
    maxRequestsPerStartUrl, 
    maxRequestsPerCrawl, 
    maxDepth, 
    enqueueStrategy = 'same-domain', 
    proxyConfigurationOptions 
} = input;
log.info(`startUrls has ${startUrls.length} items`);

const proxyConfiguration = await Actor.createProxyConfiguration(proxyConfigurationOptions);

if (maxRequestsPerCrawl) {
    log.info(`Max requests per crawl set to ${maxRequestsPerCrawl}`);
}
if (maxDepth) {
    log.info(`Max depth set to ${maxDepth}`);
}
if (maxRequestsPerStartUrl) {
    log.info(`Max requests per start URL set to ${maxRequestsPerStartUrl}`);
}
if (enqueueStrategy) {
    log.info(`Enqueue strategy is set to ${enqueueStrategy}`);
}
if (proxyConfiguration) {
    log.info('Proxy configuration is set', { proxyConfiguration });
}

// Load and manage request limit state
const STORAGE_KEY = 'per-startUrl-request-counter';
const requestLimiter = await RequestLimiter.load(STORAGE_KEY, maxRequestsPerStartUrl);
setInterval(() => requestLimiter.persist(STORAGE_KEY), 60000);
Actor.on('migrating', () => requestLimiter.persist(STORAGE_KEY));

// Load and manage crawl stats
const STATS_KEY = 'per-startUrl-crawl-stats';
const statsTracker = await CrawlStatsTracker.load(STATS_KEY);
setInterval(() => statsTracker.persist(STATS_KEY), 60000);
Actor.on('migrating', () => statsTracker.persist(STATS_KEY));

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
                strategy: enqueueStrategy,
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

await statsTracker.persist(STATS_KEY);
log.info('Final crawl stats exported to JSON');

await Actor.exit();
