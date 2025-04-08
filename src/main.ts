import { Actor } from 'apify';
import { CheerioCrawler, Dataset, RequestList, createRequestDebugInfo, social } from 'crawlee';
// import { router } from './routes.js';
import * as utils from './utils.js';

// TODO: Install Playwright dynamically at runtime:
// https://chatgpt.com/c/67e13f81-a190-8013-bcd9-7410801ffa2a

interface Input {
    startUrls: { url: string; immobiliareId: number }[];
    maxRequestsPerStartUrl: number;
    maxRequestsPerCrawl?: number;
    maxDepth: number;
    sameDomain: boolean;
}

// !!!
// TODO: 
// - devo controllare "referrer" che per le request aggiunte non c'è. 
// - anche mettere sempre l'originalStartUrl che servirà per merge finale

await Actor.init();

const input = await Actor.getInput<Input>();
if (!input) throw new Error('There is no input, please provide some.');

const { startUrls, maxRequestsPerStartUrl, maxRequestsPerCrawl, maxDepth, sameDomain } = input;

const proxyConfiguration = await Actor.createProxyConfiguration(); // TODO: proxyconfig from input

const requestsPerStartUrlCounter: any = (await Actor.getValue('requests-per-startUrl-counter')) || {};
if (maxRequestsPerStartUrl) {
    const persistRequestsPerStartUrlCounter = async () => {
        await Actor.setValue('requests-per-startUrl-counter', requestsPerStartUrlCounter);
    };
    setInterval(persistRequestsPerStartUrlCounter, 60000);
    Actor.on('migrating', persistRequestsPerStartUrlCounter);
}

// I skipped 'porcessing input URLs in case of requestsFromUrl (urls from txt file)' from https://github.com/vdrmota/Social-Media-and-Contact-Info-Extractor/blob/master/src/main.js#L35
// and normalizeUrls at line 42 of the same file above.

const requestQueue = await Actor.openRequestQueue();

const crawler = new CheerioCrawler({
    // requestList, // potrei evitare anche questi se faccio addRequest prima di crawler.run
    requestQueue, 
    proxyConfiguration,
    maxRequestsPerCrawl,
    // requestHandler: router,
    requestHandler: async ({ request, $, log }) => {
        log.info('Processing page:', { url: request.loadedUrl });
        const { depth, referrer, originalUrl, immobiliareId } = request.userData;
        console.log('from requestHandler: request.userData:', request.userData);

        // Set enqueue options
        const linksToEnqueueOptions = {
            $,
            requestQueue,
            selector: 'a',
            sameDomain,
            urlDomain: utils.getDomain(request.url),
            currentUrl: request.url, // or request.loadedUrl
            immobiliareId,
            originalUrl,
            depth,
            // These options makes the enqueueUrls call stateful. It would be better to refactor this.
            maxRequestsPerStartUrl,
            requestsPerStartUrlCounter,
        };
        // console.log('from requestHandler: linksToEnqueueOptions:', linksToEnqueueOptions);

        // Enqueue all links on the page
        if (depth < maxDepth) {
            await utils.enqueueUrls(linksToEnqueueOptions);
        }

        // Generate result
        // const { userData: { depth, referrer } } = request;
        const url = request.url; // add also request.loadedUrl
        const html = $.html();

        const result = {
            // html,
            depth,
            referrerUrl: referrer,
            url,
            domain: utils.getDomain(url)
        };

        // Extract and save handles, emails, phone numbers
        const socialHandles = social.parseHandlesFromHtml(html, { text: $.text(), $ });

        Object.assign(result, socialHandles);

        // Store results
        await Actor.pushData(result);
    },
    failedRequestHandler: async ({ request, error }) => {
        console.error(`Request ${request.url} failed too many times`, error);
        await Dataset.pushData({
            '#debug': createRequestDebugInfo(request),
        });
    },
});

// Add requests to queue
for (const startUrl of startUrls) {
    // update maxRequestsPerStartUrl if necessary
    if (maxRequestsPerStartUrl) {
        if (!requestsPerStartUrlCounter[startUrl.url]) {
            requestsPerStartUrlCounter[startUrl.url] = {
                counter: 1,
                wasLogged: false,
            };
        }
    }
    console.log('from main: adding requests: startUrl:', startUrl);

    await crawler.addRequests([{
        url: startUrl.url,
        userData: {
            depth: 0,
            referrer: null,
            originalUrl: startUrl.url,
            immobiliareId: startUrl.immobiliareId,
        },
    }]);
}

await crawler.run();

// Add this line to export to JSON.
await Dataset.exportToJSON('results');

await Actor.exit();
