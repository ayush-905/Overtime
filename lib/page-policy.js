// @ts-check
// What a page from Overtime may load and run: only its own scripts, styles,
// images and fonts, and only talk to its own server. Inline scripts (the theme
// set before the page draws, and your saved settings) run only with this
// response's nonce, so markup that slipped into a page some other way can't run,
// and so can't use the page's right to take actions like making a command.
// Styles may be inline, since the pixel office sets colours on its markup.

import { randomBytes } from 'node:crypto';

/** A new nonce for one page. */
export const newNonce = () => randomBytes(16).toString('base64');

/** The Content-Security-Policy for a page served with `nonce`. */
export function pagePolicy(nonce) {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/** The page's HTML with `nonce` on each of its scripts. */
export const withNonce = (html, nonce) =>
  String(html).replace(/<script\b(?![^>]*\bnonce=)/g, `<script nonce="${nonce}"`);
