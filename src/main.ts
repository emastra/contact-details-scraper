import { Actor } from 'apify';
import { CheerioCrawler, Dataset, createRequestDebugInfo, social, log } from 'crawlee';
import * as utils from './utils.js';
import { CheerioAPI } from 'cheerio';

interface Input {
    startUrls: { url: string; immobiliareId: number }[];
    maxRequestsPerStartUrl: number;
    maxRequestsPerCrawl?: number;
    maxDepth: number;
    sameDomain: boolean;
}

type RequestCounter = Record<string, { counter: number; wasLogged: boolean }>;

await Actor.init();

const input = await Actor.getInput<Input>();
if (!input) throw new Error('There is no input, please provide some.');
const { startUrls, maxRequestsPerStartUrl, maxRequestsPerCrawl, maxDepth, sameDomain } = input;
log.info(`startUrls has ${startUrls.length} items`);

const proxyConfiguration = await Actor.createProxyConfiguration(); // TODO: proxyconfig from input

const requestsPerStartUrlCounter: RequestCounter = (await Actor.getValue('requests-per-startUrl-counter')) || {};
if (maxRequestsPerStartUrl) {
    const persistRequestsPerStartUrlCounter = async () => {
        await Actor.setValue('requests-per-startUrl-counter', requestsPerStartUrlCounter);
    };
    setInterval(persistRequestsPerStartUrlCounter, 60000);
    Actor.on('migrating', persistRequestsPerStartUrlCounter);
}

const requestQueue = await Actor.openRequestQueue();

const crawler = new CheerioCrawler({
    requestQueue,
    proxyConfiguration,
    maxRequestsPerCrawl,
    requestHandler: async ({ request, $, enqueueLinks }) => {
        log.info('Processing page:', { url: request.loadedUrl });

        const { depth, referrer, originalUrl, immobiliareId } = request.userData;

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
                    if (maxRequestsPerStartUrl) {
                        const counterEntry = requestsPerStartUrlCounter[originalUrl];
                        if (counterEntry.counter < maxRequestsPerStartUrl) {
                            counterEntry.counter++;
                            return req;
                        } else if (!counterEntry.wasLogged) {
                            log.info(`Reached max requests for start URL: ${originalUrl}`);
                            counterEntry.wasLogged = true;
                        }
                        return undefined;
                    }
                    return req;
                },
            });
        }

        // Generate and save result
        const url = request.url;
        const html = $.html();
        const result = {
            depth,
            immobiliareId,
            startUrl: originalUrl,
            referrerUrl: referrer,
            currentUrl: url,
            domain: utils.getDomain(url),
        };

        const socialHandles = social.parseHandlesFromHtml(html, { text: $.text(), $ });
        const whatsappResult = utils.extractWhatsAppNumbersFromCheerio($ as CheerioAPI);

        Object.assign(result, socialHandles, whatsappResult);

        await Actor.pushData(result);
    },
    failedRequestHandler: async ({ request, error }) => {
        console.error(`Request ${request.url} failed too many times`, error);
        await Dataset.pushData({
            '#debug': createRequestDebugInfo(request),
        });
    },
});

// Sanitize start URLs
const cleanStartUrls = utils.sanitizeStartUrls(startUrls);
log.info(`cleanStartUrls has ${cleanStartUrls.length} items`);

// Init counters
if (maxRequestsPerStartUrl) {
    for (const startUrl of cleanStartUrls) {
        if (!requestsPerStartUrlCounter[startUrl.url]) {
            requestsPerStartUrlCounter[startUrl.url] = {
                counter: 1,
                wasLogged: false,
            };
        }
    }
}

// Add initial requests
await crawler.addRequests(cleanStartUrls.map(startUrl => ({
    url: startUrl.url,
    userData: {
        depth: 0,
        referrer: null,
        originalUrl: startUrl.url,
        immobiliareId: startUrl.immobiliareId,
    },
})));

await crawler.run();

if (!Actor.isAtHome()) {
    await Dataset.exportToJSON('results');
    log.info('Results exported to JSON');
}

await Actor.exit();
