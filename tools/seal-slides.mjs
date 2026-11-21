import { createCipheriv, pbkdf2Sync, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rename, rm, rmdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = await realpath(fileURLToPath(new URL('../', import.meta.url)));
function manifest(project, id, listed = Boolean(project)) {
  const routing = project ? `type: slides
url: /GroupMeeting/${project}/
report_id: "${id}"
` : '';
  return `---
title: Shared slides
${routing}${listed ? `project: "${project}"\n` : ''}build:
  list: ${listed ? 'local' : 'never'}
${project ? '  publishResources: false\n' : ''}sitemap:
  disable: true
---
`;
}

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

async function outputDirectory(section) {
  const content = path.join(repository, 'content');
  if (!(await lstat(content)).isDirectory()) throw new Error('The site content directory must be a regular directory.');
  const slides = path.join(content, section);
  await mkdir(slides, { recursive: true });
  if (!(await lstat(slides)).isDirectory() || await realpath(slides) !== slides) {
    throw new Error('The slide output directory must be inside the site and cannot be a symbolic link.');
  }
  return slides;
}

function encrypt(html, id) {
  const alphabet = '0123456789abcdefghjkmnpqrstvwxyz';
  const passcode = Array.from(randomBytes(12), byte => alphabet[byte & 31]).join('');
  const context = Buffer.from(`bixingwu.com/slides/v1/${id}`, 'utf8');
  const key = pbkdf2Sync(passcode, context, 600_000, 32, 'sha256');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  cipher.setAAD(context);
  const payload = Buffer.concat([Buffer.from('BWS1', 'ascii'), iv, cipher.update(html), cipher.final(), cipher.getAuthTag()]);
  return { passcode, payload };
}

async function replaceProject(staging, destination, project, filename) {
  if (!(await lstat(destination)).isDirectory() || await realpath(destination) !== destination) {
    throw new Error('The project bundle must be a regular site directory.');
  }
  const index = path.join(destination, 'index.md');
  if (!(await lstat(index)).isFile()) throw new Error('This project has no regular slide manifest.');
  const current = await readFile(index, 'utf8');
  const oldId = /^report_id: "([0-9a-f]{32})"$/m.exec(current)?.[1];
  // Accept existing bundles created before the project directory was introduced.
  if (!oldId || (current !== manifest(project, oldId) && current !== manifest(project, oldId, false))) {
    throw new Error('This directory is not a project managed by the slide packager.');
  }

  // Install the new ciphertext exclusively before atomically changing the reader's manifest.
  const newPayload = path.join(destination, filename);
  await link(path.join(staging, filename), newPayload);
  try {
    await rename(path.join(staging, 'index.md'), index);
  } catch (error) {
    await unlink(newPayload);
    throw error;
  }
}

async function publish(staging, directory, project, id, replace, filename) {
  const name = project || id;
  const destination = path.join(directory, name);
  const names = await readdir(directory);
  const existing = names.find(entry => entry.toLowerCase() === name.toLowerCase());
  if (existing && existing !== name) throw new Error('An existing project uses different capitalization. Use its exact name.');
  if (replace) {
    if (!existing) throw new Error('This project does not exist yet. Omit --replace to create it.');
    await replaceProject(staging, destination, project, filename);
  } else {
    if (existing) throw new Error(project ? 'This project already exists. Use --replace to publish a new report at its address.' : 'The generated address already exists. Run the command again.');
    await rename(staging, destination);
  }
}

async function seal({ filename, project, replace }) {
  const html = await readDeck(filename);
  const directory = await outputDirectory(project ? 'GroupMeeting' : 'slides');
  const id = randomBytes(16).toString('hex');
  const { passcode, payload } = encrypt(html, id);
  const payloadName = project ? `deck-${id}.bin` : 'deck.bin';
  const lock = project && path.join(repository, `.seal-lock-${project.toLowerCase()}`);
  if (lock) {
    try {
      await mkdir(lock);
    } catch (error) {
      if (error.code === 'EEXIST') throw new Error('Another packager holds this project lock: ' + lock);
      throw error;
    }
  }
  const url = project ? `/GroupMeeting/${project}/` : `/slides/${id}/`;
  let staging;
  try {
    staging = await mkdtemp(path.join(repository, '.seal-'));
    await writeFile(path.join(staging, payloadName), payload, { flag: 'wx' });
    await writeFile(path.join(staging, 'index.md'), manifest(project, id), { flag: 'wx' });
    await publish(staging, directory, project, id, replace, payloadName);
    // Once the new manifest is live, output its code even if housekeeping later fails.
    console.log(`https://bixingwu.com${url}#p=${passcode.match(/.{4}/g).join('-')}`);
    if (replace) {
      const bundle = path.join(directory, project);
      for (const entry of await readdir(bundle, { withFileTypes: true })) {
        if (entry.isFile() && entry.name !== payloadName && /^deck-[0-9a-f]{32}\.bin$/.test(entry.name)) {
          await unlink(path.join(bundle, entry.name));
        }
      }
    }
  } finally {
    try {
      if (staging) await rm(staging, { recursive: true, force: true });
    } finally {
      if (lock) await rmdir(lock);
    }
  }
}

function options(args) {
  const usage = 'Usage: node tools/seal-slides.mjs [--project Ocula [--replace]] /path/outside/the/site/deck.html';
  let filename, project, replace = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--project' && project === undefined) {
      project = args[++i] || '';
      if (project.length > 64 || !/^[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*$/.test(project) ||
          /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(project)) {
        throw new Error('Choose a project name of 1–64 ASCII letters, digits, or internal hyphens, starting with a letter.');
      }
    } else if (arg === '--replace' && !replace) replace = true;
    else if (arg.startsWith('-') || filename) throw new Error(usage);
    else filename = arg;
  }
  if (!filename || (replace && !project)) throw new Error(usage);
  return { filename, project, replace };
}

try {
  await seal(options(process.argv.slice(2)));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
