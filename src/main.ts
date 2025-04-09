import { Actor } from 'apify';
import { CheerioCrawler, Dataset, RequestList, createRequestDebugInfo, social } from 'crawlee';
// import { router } from './routes.js';
import * as utils from './utils.js';
import { CheerioAPI } from 'cheerio';

// TODO: Install Playwright dynamically at runtime:
// https://chatgpt.com/c/67e13f81-a190-8013-bcd9-7410801ffa2a

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

const proxyConfiguration = await Actor.createProxyConfiguration(); // TODO: proxyconfig from input

// maxRequestsPerStartUrl stuff
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
// const requestList = await RequestList.open('start-urls');

const crawler = new CheerioCrawler({
    // requestList,
    requestQueue, 
    proxyConfiguration,
    maxRequestsPerCrawl,
    // requestHandler: router,
    requestHandler: async ({ request, $, log }) => {
        log.info('Processing page:', { url: request.loadedUrl });
        const { depth, referrer, originalUrl, immobiliareId } = request.userData;
        // console.log('from requestHandler: request.userData:', request.userData);

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
            // TODO: These options makes the enqueueUrls call stateful. It would be better to refactor this.
            maxRequestsPerStartUrl,
            requestsPerStartUrlCounter,
        };

        // Enqueue all links on the page
        if (depth < maxDepth) {
            await utils.enqueueUrls(linksToEnqueueOptions);
        }

        // Generate result
        const url = request.url; // add also request.loadedUrl
        const html = $.html();

        const result = {
            // html,
            depth,
            immobiliareId,
            startUrl: originalUrl,
            referrerUrl: referrer,
            currentUrl: url,
            domain: utils.getDomain(url)
        };

        // Extract and save handles, emails, phone numbers
        const socialHandles = social.parseHandlesFromHtml(html, { text: $.text(), $ });
        const whatsappResult = utils.extractWhatsAppNumbersFromCheerio($ as CheerioAPI);

        Object.assign(result, socialHandles, whatsappResult);

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

// sanitize, if invalid urls exists addRequest may fail
const cleanStartUrls = utils.sanitizeStartUrls(startUrls);

// Init counters (if needed)
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

// Add requests to queue
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

// TODO: REMOVE this line when on apify platform OR add condition apify isAtHome
await Dataset.exportToJSON('results');

await Actor.exit();


//

// // function used to find the culprit requests of: https://chatgpt.com/c/67f54c7b-54e8-8013-baf6-00c0a6eb634f
// async function findBadRequest(requests: any[]) {
//   if (requests.length === 1) {
//       try {
//           await crawler.addRequests(requests);
//           console.log("✅ No error with:", requests[0]);
//       } catch (err) {
//           console.error("❌ Bad request found:", requests[0]);
//           console.error("Error:", err);
//       }
//       return;
//   }

//   const mid = Math.floor(requests.length / 2);
//   const firstHalf = requests.slice(0, mid);
//   const secondHalf = requests.slice(mid);

//   try {
//       await crawler.addRequests(firstHalf);
//       console.log(`✅ First half (${firstHalf.length}) passed`);
//   } catch {
//       console.warn(`❌ First half (${firstHalf.length}) failed — diving in`);
//       await findBadRequest(firstHalf);
//   }

//   try {
//       await crawler.addRequests(secondHalf);
//       console.log(`✅ Second half (${secondHalf.length}) passed`);
//   } catch {
//       console.warn(`❌ Second half (${secondHalf.length}) failed — diving in`);
//       await findBadRequest(secondHalf);
//   }
// }