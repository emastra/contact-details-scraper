import { CheerioAPI } from 'cheerio';
import { log } from 'crawlee';

export function getDomain(url: string): string | null {
    try {
        return new URL(url).hostname;
    } catch (error) {
        return null;
    }
}

export function extractWhatsAppNumbersFromCheerio($: CheerioAPI): { whatsapps: string[] } {
    const whatsapps = new Set<string>();
    const regex = /https?:\/\/(?:wa\.me|api\.whatsapp\.com\/send\?phone=)(\d{6,15})/gi;

    const html: string = $.html();
    let match: RegExpExecArray | null;
    while ((match = regex.exec(html)) !== null) {
        whatsapps.add(match[1]);
    }

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
            entry.url = entry.url.trim();
            return true;
        } else {
            console.warn(`Invalid URL skipped at index ${index}:`, entry?.url);
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
