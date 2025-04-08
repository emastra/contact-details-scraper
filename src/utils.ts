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

  const requests = createRequests(requestOptions);
  await addRequestsToQueue({ 
    requests, 
    requestQueue, 
    startUrl: originalUrl, 
    maxRequestsPerStartUrl, 
    requestsPerStartUrlCounter 
  });
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
    // Check if the request is valid
    if (!request) {
      log.error(`Invalid request found: ${JSON.stringify(request)}`);
      continue; // Skip invalid requests
    }

    if (maxRequestsPerStartUrl) {
      if (requestsPerStartUrlCounter[startUrl].counter < maxRequestsPerStartUrl) {
        // request.userData.startUrl = startUrl; // We already have originalUrl in userData
        const { wasAlreadyPresent } = await requestQueue.addRequest(request);
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

export function extractWhatsAppNumbersFromCheerio($: CheerioAPI): { whatsapps: string[]; } {
  const whatsapps = new Set<string>();

  const regex = /https?:\/\/(?:wa\.me|api\.whatsapp\.com\/send\?phone=)(\d{6,15})/gi;

  // Search in full HTML
  const html: string = $.html();
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    whatsapps.add(match[1]);
  }

  // Also search inside <script> tags
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
          // Normalize the URL (e.g. trim whitespace)
          entry.url = entry.url.trim();
          return true;
      } else {
          console.warn(`⛔️ Invalid URL skipped at index ${index}:`, entry?.url);
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

