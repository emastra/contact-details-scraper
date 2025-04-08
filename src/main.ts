import { Actor } from 'apify';
import { CheerioCrawler, Dataset, RequestList, createRequestDebugInfo, social } from 'crawlee';
import { router } from './routes.js';
import * as utils from './utils.js';

interface Input {
    startUrls: string[];
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

// TODO: Install Playwright dynamically at runtime:
// https://chatgpt.com/c/67e13f81-a190-8013-bcd9-7410801ffa2a

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
const requestList = await RequestList.open('start-urls', startUrls);

// potrei invece iterare startUrls e usare addRequest aggiungendo uerData lì? in quel caso nnon avrei bisogno di requestList
// e di aggiungere RequestList e RequestQueue a CheerioCrawler
requestList.requests.forEach((req) => {
    req.userData = {
        depth: 0,
        referrer: null,
        startUrl: req.url,
    };

    if (maxRequestsPerStartUrl) {
        if (!requestsPerStartUrlCounter[req.url]) {
            requestsPerStartUrlCounter[req.url] = {
                counter: 1,
                wasLogged: false,
            };
        }
    }
});

////////////////////

// TIPS per quando useo in alternativa PlaywrightCrawlwer:
/**
launchContext: {
            useIncognitoPages: true,
        },
        browserPoolOptions: {
            useFingerprints: true,
        },

preNavigationHooks: [
        async ({ blo }) => {
            // Block the provided resourses extensions, plus the 'blockRequests' defaults: [".css", ".jpg", ".jpeg", ".png", ".svg", ".gif", ".woff", ".pdf", ".zip"]
            await blockRequests({
                extraUrlPatterns: ['adsbygoogle.js', '.woff2'],
            });
        },
    ],
    // !! e aggiungi pure waitforloadedcontent del vecchio gotofunction

*/

const crawler = new CheerioCrawler({
    requestList,
    requestQueue, // potrei evitare anche questi se faccio addRequest prima di crawler.run
    proxyConfiguration,
    maxRequestsPerCrawl,
    // requestHandler: router,
    failedRequestHandler: async ({ request, error }) => {
        console.error(`Request ${request.url} failed too many times`, error);
        await Dataset.pushData({
            '#debug': createRequestDebugInfo(request),
        });
    },
    requestHandler: async ({ request, $ }) => {
        console.info('Processing page:', request.loadedUrl);
        console.log('CHECK IF startUrl is in userData:', request.userData);

        // Set enqueue options
        const linksToEnqueueOptions = {
            $,
            requestQueue,
            selector: 'a',
            sameDomain,
            urlDomain: utils.getDomain(request.url),
            startUrl: request.userData.startUrl,
            depth: request.userData.depth,
            // These options makes the enqueueUrls call stateful. It would be better to refactor this.
            maxRequestsPerStartUrl,
            requestsPerStartUrlCounter,
        };

        // Enqueue all links on the page
        if (request.userData.depth < maxDepth) {
            await utils.enqueueUrls(linksToEnqueueOptions);
        }

        // Generate result
        const { userData: { depth, referrer } } = request;
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
});

await crawler.run();
// Add this line to export to JSON.
await Dataset.exportToJSON('results');

await Actor.exit();
