import { createCheerioRouter, Dataset, log } from 'crawlee';

// TODO for playwright switching: add code for choosing router based on user preference
export const router = createCheerioRouter();

// router.addDefaultHandler(({ request, $, enqueueLinks, log }) => {
//   console.info('Processing page:', request.loadedUrl);


// });