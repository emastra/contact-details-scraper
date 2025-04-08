import { CheerioAPI } from 'cheerio';
import { createCheerioRouter, Dataset, log } from 'crawlee';

export function getDomain(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch (error) {
    return null; // Return null for invalid URLs
  }
}

export const enqueueUrls = async (options: any = {}) => {
  // console.log('from enqueueUrls: options.immobiliareId:', options.immobiliareId);
  const {
      $,
      requestQueue,
      selector = 'a',
      sameDomain,
      urlDomain,
      currentUrl,
      immobiliareId,
      originalUrl,
      depth,
      maxRequestsPerStartUrl,
      requestsPerStartUrlCounter,
  } = options;

  const urls = await extractUrlsFromPage($, currentUrl, selector, sameDomain, urlDomain);

  const tempUserData = { depth: depth + 1, currentUrl, originalUrl, immobiliareId };
  const requestOptions = createRequestOptions(urls, tempUserData);
  // console.log('Created request options (slice, to check structure):', requestOptions.slice(0, 2));

  const requests = createRequests(requestOptions);
  // console.log('Created requests (slice, to check structure):', requests.slice(0, 2));
  await addRequestsToQueue({ requests, requestQueue, startUrl: originalUrl, maxRequestsPerStartUrl, requestsPerStartUrlCounter });
};

// TODO: check original func qunado usi playwright: https://github.com/vdrmota/Social-Media-and-Contact-Info-Extractor/blob/master/src/helpers.js#L9
async function extractUrlsFromPage(
  $: CheerioAPI,
  currentUrl: string,
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

  log.info(`Found ${filteredLinks.length} links on ${currentUrl}`); // TODO: Oppure loggo sta cosa nel router, e così evito di passare pageUrl
  return filteredLinks;
}

function createRequestOptions(urls: any, { depth, currentUrl, originalUrl, immobiliareId }: any) {
  return urls
    .map((url: any) => (typeof url === 'string' ? { url } : url))
    .filter(({ url }: any) => {
      try {
        return new URL(url).href;
      } catch (err) {
        return false;
      }
    })
    .filter(({ url }: any) => !url.match(/\.(jp(e)?g|bmp|png|mp3|m4a|mkv|avi)$/gi))
    .map(({ url }: any) => {
      // const rqOptsWithData = rqOpts;
      // rqOptsWithData.userData = { 
      //   ...rqOpts.userData, 
      //   ...tempUserData // !! only depth here
      // };
      // return rqOptsWithData;
      return {
        url,
        userData: {
          depth,
          referrer: currentUrl,
          originalUrl,
          immobiliareId,
        }
      }
    });
}

function createRequests(requestOptions: any, pseudoUrls?: any) {
  // EARLY RETURN if pseudoUrls are not present
  if (!(pseudoUrls && pseudoUrls.length)) {
    const requests = requestOptions.map((opts: any) => ({
      url: opts.url,
      userData: opts.userData || {},
    }));

    return requests;
  }

  // This part is skipped if pseudoUrls is missing or empty
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
  startUrl,
  maxRequestsPerStartUrl, 
  requestsPerStartUrlCounter,
}: any) {
  for (const request of requests) {
    // Debugging: Check if the request is valid
    if (!request) {
      log.error(`Invalid request found: ${JSON.stringify(request)}`);
      continue; // Skip invalid requests
    }

    if (maxRequestsPerStartUrl) {
      if (requestsPerStartUrlCounter[startUrl].counter < maxRequestsPerStartUrl) {
        // console.log('Request being added:', request);
        // request.userData.startUrl = startUrl; // We already have originalUrl in userData
        const { wasAlreadyPresent } = await requestQueue.addRequest(request);
        // console.log('Request added:', request);
        if (!wasAlreadyPresent) {
          requestsPerStartUrlCounter[startUrl].counter++;
        }
      } else if (!requestsPerStartUrlCounter[startUrl].wasLogged) {
        log.info(`Enqueued max pages for start URL: ${startUrl}, will not enqueue any more`);
        requestsPerStartUrlCounter[startUrl].wasLogged = true;
      }
    } else {
      await requestQueue.addRequest(request);
    }
  }
}

