import { createCheerioRouter, Dataset, log } from 'crawlee';

// TODO: add code for choosing router based on user preference
export const router = createCheerioRouter();

/*
TIPS IF WITH PLAYWRIGHT

wait for body if in browser

// Crawl HTML frames
  let frameSocialHandles = {};
  if (considerChildFrames) {
      frameSocialHandles = await helpers.crawlFrames(page);
  }

*/

// router.addDefaultHandler(({ request, $, enqueueLinks, log }) => {
//   console.info('Processing page:', request.loadedUrl);

//   // Set enqueue options
//   const linksToEnqueueOptions = {
//     page,
//     requestQueue,
//     selector: 'a',
//     sameDomain,
//     urlDomain: helpers.getDomain(request.url),
//     startUrl: request.userData.startUrl,
//     depth: request.userData.depth,
//     // These options makes the enqueueUrls call stateful. It would be better to refactor this.
//     maxRequestsPerStartUrl,
//     requestsPerStartUrlCounter,
//   };

//   // Enqueue all links on the page
//   if (typeof maxDepth !== 'number' || request.userData.depth < maxDepth) {
//     await helpers.enqueueUrls(linksToEnqueueOptions);
// }
// });


// router.addHandler('list', async ({ $, crawler, request, proxyInfo }) => {
//   console.log('Scraping a list page:', request.loadedUrl);
//   log.info('Proxy info:', proxyInfo);

//   // await crawler.addRequests(urls.map((url) => ({ url, label: 'detail' })));
// });

// router.addHandler('detail', async ({ $, request, proxyInfo }) => {
//   console.log('Scraping a detail page:', request.loadedUrl);
//   log.info('Proxy info:', proxyInfo);

  

//   // await Dataset.pushData(result);
//   // console.log('Agency successfully added from:', request.loadedUrl);
// });