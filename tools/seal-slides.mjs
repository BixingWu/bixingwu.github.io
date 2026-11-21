import { createCipheriv, pbkdf2Sync, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, mkdtemp, open, realpath, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = await realpath(fileURLToPath(new URL('../', import.meta.url)));
const frontMatter = `---
title: Shared slides
build:
  list: never
sitemap:
  disable: true
---
`;

function insideRepository(filename) {
  const relative = path.relative(repository, filename);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

async function readDeck(filename) {
  const supplied = path.resolve(filename);
  const resolved = await realpath(supplied);
  if (insideRepository(supplied) || insideRepository(resolved)) {
    throw new Error('Keep the unencrypted HTML outside the website repository.');
  }
  if (!/\.html?$/i.test(supplied)) throw new Error('Choose a standalone .html or .htm file.');
  const input = await open(resolved, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await input.stat();
    if (!info.isFile() || info.nlink !== 1) throw new Error('Choose a regular HTML file with a single filesystem link.');
    const bytes = await input.readFile();
    const html = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (!html.trim() || !/<(?:!doctype\s+html\b|[a-z][\w:-]*(?:\s|\/?>))/i.test(html)) {
      throw new Error('The input must contain a nonempty UTF-8 HTML document.');
    }
    checkStaticResources(html);
    return bytes;
  } finally {
    await input.close();
  }
}

// Catch common export mistakes. Runtime scripts require the viewer's separate sandbox and CSP.
function checkStaticResources(html) {
  function embedded(value, location) {
    if (value.trim() && !/^(?:data:|#)/i.test(value.trim())) {
      throw new Error(`The exported HTML has a separate resource in ${location}. Embed it in the HTML first.`);
    }
  }

  function checkCSS(css) {
    const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const match of text.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"\s]+))\s*\)/gi)) {
      embedded(match[1] ?? match[2] ?? match[3], 'CSS url()');
    }
    for (const match of text.matchAll(/@import\s*(['"])(.*?)\1/gi)) embedded(match[2], 'CSS @import');
  }

  function checkSourceSet(value, location) {
    // A data URL can contain internal commas. Whitespace ends the URL, and a trailing comma ends the candidate.
    let offset = 0;
    while (offset < value.length) {
      while (offset < value.length && /[\s,]/.test(value[offset])) offset++;
      const start = offset;
      while (offset < value.length && !/\s/.test(value[offset])) offset++;
      const candidate = value.slice(start, offset);
      if (!candidate) break;
      embedded(candidate.replace(/,+$/, ''), location);
      if (!candidate.endsWith(',')) {
        const next = value.indexOf(',', offset);
        offset = next === -1 ? value.length : next + 1;
      }
    }
  }

  // Ignore examples inside comments and script strings. Preserve the opening tags for src checks.
  const markup = html.replace(/<!--[\s\S]*?-->/g, '').replace(
    /(<(script|style)\b(?:"[^"]*"|'[^']*'|[^'"<>])*>)([\s\S]*?)<\/\2\s*>/gi,
    (_, opening, tag, body) => {
      if (tag.toLowerCase() === 'style') checkCSS(body);
      return opening;
    },
  );
  for (const tag of markup.matchAll(/<([a-z][\w:-]*)\b((?:"[^"]*"|'[^']*'|[^'"<>])*)>/gi)) {
    const name = tag[1].toLowerCase();
    const attributes = new Map();
    for (const attr of tag[2].matchAll(/([^\s"'=<>`/]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>`]+))/g)) {
      attributes.set(attr[1].toLowerCase(), attr[2] ?? attr[3] ?? attr[4]);
    }
    if ((name === 'base' && attributes.has('href')) || (name === 'meta' && attributes.get('http-equiv')?.toLowerCase() === 'refresh')) {
      throw new Error('Remove base URLs and automatic redirects from the standalone HTML.');
    }
    if (['iframe', 'object', 'embed'].includes(name)) throw new Error('The viewer does not load nested documents. Embed figures directly in the report.');
    if ((name === 'script' && attributes.has('src')) || (name === 'link' && /\bstylesheet\b/i.test(attributes.get('rel') ?? ''))) {
      throw new Error('Put scripts in inline <script> elements and styles in inline <style> elements.');
    }
    for (const key of ['src', 'poster', 'background']) if (attributes.has(key)) embedded(attributes.get(key), `${name}[${key}]`);
    const loadsLinkedResource = name === 'link' && /\b(?:stylesheet|icon|preload|prefetch|preconnect|manifest|modulepreload|prerender)\b/i.test(attributes.get('rel') ?? '');
    if (loadsLinkedResource || name === 'use' || name === 'image') {
      for (const key of ['href', 'xlink:href']) if (attributes.has(key)) embedded(attributes.get(key), `${name}[${key}]`);
    }
    if (attributes.has('style')) checkCSS(attributes.get('style'));
    const candidates = attributes.get('srcset') ?? attributes.get('imagesrcset');
    if (candidates) checkSourceSet(candidates, `${name}[srcset]`);
  }
}

async function outputDirectory() {
  const content = path.join(repository, 'content');
  if (!(await lstat(content)).isDirectory()) throw new Error('The site content directory must be a regular directory.');
  const slides = path.join(content, 'slides');
  await mkdir(slides, { recursive: true });
  if (!(await lstat(slides)).isDirectory() || await realpath(slides) !== slides) {
    throw new Error('The slide output directory must be inside the site and cannot be a symbolic link.');
  }
  return slides;
}

async function seal(filename) {
  const html = await readDeck(filename);
  const directory = await outputDirectory();
  const id = randomBytes(16).toString('hex');
  const alphabet = '0123456789abcdefghjkmnpqrstvwxyz';
  const passcode = Array.from(randomBytes(12), byte => alphabet[byte & 31]).join('');
  const context = Buffer.from(`bixingwu.com/slides/v1/${id}`, 'utf8');
  const key = pbkdf2Sync(passcode, context, 600_000, 32, 'sha256');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  cipher.setAAD(context);
  const payload = Buffer.concat([Buffer.from('BWS1', 'ascii'), iv, cipher.update(html), cipher.final(), cipher.getAuthTag()]);
  const staging = await mkdtemp(path.join(directory, '.seal-'));
  let published = false;
  try {
    await writeFile(path.join(staging, 'deck.bin'), payload, { flag: 'wx' });
    await writeFile(path.join(staging, 'index.md'), frontMatter, { flag: 'wx' });
    const destination = path.join(directory, id);
    try {
      await lstat(destination);
      throw new Error('The generated slide address already exists. Run the command again.');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    await rename(staging, destination);
    published = true;
  } finally {
    if (!published) await rm(staging, { recursive: true, force: true });
  }
  return `https://bixingwu.com/slides/${id}/#p=${passcode.match(/.{4}/g).join('-')}`;
}

try {
  const args = process.argv.slice(2);
  if (args.length !== 1) throw new Error('Usage: node tools/seal-slides.mjs /path/outside/the/site/deck.html');
  console.log(await seal(args[0]));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
