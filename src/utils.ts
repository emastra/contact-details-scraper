import { CheerioAPI } from 'cheerio';
import { createCheerioRouter, Dataset, log } from 'crawlee';

export function getDomain(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch (error) {
    return null; // Return null for invalid URLs
  }
}

// TODO: check original func qunado usi playwright: https://github.com/vdrmota/Social-Media-and-Contact-Info-Extractor/blob/master/src/helpers.js#L9
async function extractUrlsFromPage(
  $: CheerioAPI,
  pageUrl: string,
  selector: string = 'a', 
  sameDomain: boolean, 
  urlDomain: string
): Promise<string[]> {
  const allLinks = $(selector)
    .map((_, link) => $(link).attr("href"))
    .get()
    .filter((href) => !!href);

  const filteredLinks = allLinks.filter((url) => {
    const linkDomain = getDomain(url);
    return linkDomain && (sameDomain ? linkDomain === urlDomain : true);
  });

  log.info(`Found ${filteredLinks.length} links on ${pageUrl}`); // TODO: Oppure loggo sta cosa nel router, e così evito di passare pageUrl
  return filteredLinks;
}

function createRequestOptions(sources: any, userData: any = {}) {
  return sources
    .map((src: any) => (typeof src === 'string' ? { url: src } : src))
    .filter(({ url }: any) => {
      try {
        return new URL(url).href;
      } catch (err) {
        return false;
      }
    })
    .filter(({ url }: any) => !url.match(/\.(jp(e)?g|bmp|png|mp3|m4a|mkv|avi)$/gi))
    .map((rqOpts: any) => {
      const rqOptsWithData = rqOpts;
      rqOptsWithData.userData = { ...rqOpts.userData, ...userData };
      return rqOptsWithData;
    });
}

function createRequests(requestOptions: any, pseudoUrls?: any) {
  if (!(pseudoUrls && pseudoUrls.length)) {
    return requestOptions.map((opts: any) => ({
      url: opts.url,
      userData: opts.userData || {},
    }));
  }

  const requests: any[] = [];
  requestOptions.forEach((opts: any) => {
    pseudoUrls
      .filter((purl: any) => purl.matches(opts.url))
      .forEach((purl: any) => {
        const request = purl.createRequest(opts);
        requests.push(request);
      });
  });

  return requests;
}

async function addRequestsToQueue({ 
  requests, 
  requestQueue, 
  maxRequestsPerStartUrl, 
  requestsPerStartUrlCounter, 
  startUrl 
}: any) {
  for (const request of requests) {
    // Debugging: Check if the request is valid
    if (!request) {
      log.error(`Invalid request found: ${JSON.stringify(request)}`);
      continue; // Skip invalid requests
    }

    if (maxRequestsPerStartUrl) {
      if (requestsPerStartUrlCounter[startUrl].counter < maxRequestsPerStartUrl) {
        console.log('Request being added:', request);
        request.userData.startUrl = startUrl;
        const { wasAlreadyPresent } = await requestQueue.addRequest(request);
        console.log('Request added:', request);
        if (!wasAlreadyPresent) {
          requestsPerStartUrlCounter[startUrl].counter++;
        }
      } else if (!requestsPerStartUrlCounter[startUrl].wasLogged) {
        log.warning(`Enqueued max pages for start URL: ${startUrl}, will not enqueue any more`);
        requestsPerStartUrlCounter[startUrl].wasLogged = true;
      }
    } else {
      await requestQueue.addRequest(request);
    }
  }
}

export const enqueueUrls = async (options: any = {}) => {
  const {
      $,
      requestQueue,
      selector = 'a',
      sameDomain,
      urlDomain,
      depth,
      startUrl,
      maxRequestsPerStartUrl,
      requestsPerStartUrlCounter,
  } = options;

  const urls = await extractUrlsFromPage($, startUrl, selector, sameDomain, urlDomain);

  const requestOptions = createRequestOptions(urls, { depth: depth + 1 });
  console.log('Created request options...:', requestOptions.slice(0, 2));

  const requests = createRequests(requestOptions);
  console.log('Created requests...:', requests.slice(0, 2));
  await addRequestsToQueue({ requests, requestQueue, startUrl, maxRequestsPerStartUrl, requestsPerStartUrlCounter });
};

