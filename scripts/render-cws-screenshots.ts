import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import {
  createReadStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  statSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

type ComparisonPair = {
  id: string;
  title: string;
  before: string;
  after: string;
};

type PairsFile = {
  pairs: ComparisonPair[];
};

type SingleShot = {
  id: string;
  labelKey: string;
  sourceForLocale: (locale: LocalePack) => string;
};

type ChromeMessages = Record<string, { message?: string }>;

type RenderOptions = {
  localeCode?: string;
};

/** Resolved language-pack data and font choice for one locale. */
type LocalePack = {
  code: string;
  chromeLang: string;
  messages: ChromeMessages;
  fontFamily: 'Montserrat' | 'Noto Sans SC' | 'Noto Sans JP' | 'Noto Sans Arabic' | 'Noto Sans KR';
};

type ElementMatch = {
  start: number;
  end: number;
  source: string;
};

type LabelBox = {
  centerX: number;
  centerY: number;
  fitWidth: number;
  fitHeight: number;
};

type CdpSuccess<T> = {
  id: number;
  result: T;
};

type CdpFailure = {
  id: number;
  error: {
    message: string;
    data?: string;
  };
};

const chromeProcessOutput = new WeakMap<ChildProcessWithoutNullStreams, string>();

const repoRoot = resolve(__dirname, '..');
const localesRoot = join(repoRoot, '_locales');
const assetRoot = join(repoRoot, 'store-listings/assets/cws-promo');
const templatePath = join(assetRoot, 'template.svg');
const templateFullPath = join(assetRoot, 'template-full.svg');
const pairsPath = join(assetRoot, 'pairs.json');
const sourceRoot = join(assetRoot, 'source');
const keyboardSourceRoot = join(sourceRoot, 'keyboard-shortcuts');
const pngOutputRoot = join(assetRoot, 'screenshots-1280x800');
const outputSize = { width: 1280, height: 800 };
const defaultFontSizePt = 36;
const defaultFontSizePx = 48;
const videoUrl = 'https://video.blender.org/object-storage/web_videos/6402b77c-b61f-4a06-96ca-c8420a2becf4-480.mp4';
const cachedVideoPath = join(tmpdir(), 'theater-everywhere-cws-keyboard-capture.mp4');
const minimumCachedVideoBytes = 10 * 1024 * 1024;
const chromePath =
  process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const options = parseRenderOptions(process.argv.slice(2));

  assertExists(localesRoot);
  assertExists(templatePath);
  assertExists(templateFullPath);
  assertExists(pairsPath);
  assertExists(join(sourceRoot, 'full_ui.png'));
  assertExists(join(assetRoot, 'fonts/Montserrat[wght].ttf'));
  assertExists(join(assetRoot, 'fonts/NotoSansSC[wght].ttf'));
  assertExists(join(assetRoot, 'fonts/NotoSansJP[wght].ttf'));
  assertExists(join(assetRoot, 'fonts/NotoSansArabic[wght].ttf'));
  assertExists(join(assetRoot, 'fonts/NotoSansKR[wght].ttf'));
  assertExists(join(assetRoot, 'fonts/OFL-Montserrat.txt'));
  assertExists(join(assetRoot, 'fonts/OFL-NotoSansSC.txt'));
  assertExists(chromePath);

  const pairs = readPairs();
  const locales = selectLocales(readLocales(), options);
  const comparisonTemplate = readFileSync(templatePath, 'utf8');
  const fullTemplate = readFileSync(templateFullPath, 'utf8');
  validateComparisonTemplate(comparisonTemplate);
  validateSingleTemplate(fullTemplate);

  cleanPngOutputs(locales, options);
  rmSync(join(assetRoot, 'generated-svg'), { recursive: true, force: true });
  rmSync(join(assetRoot, 'review'), { recursive: true, force: true });
  rmSync(join(assetRoot, 'manifest.json'), { force: true });

  const extensionPath = buildChromeExtension();
  const captureVideoPath = await ensureCaptureVideoFile();
  const captureServer = await startVideoCaptureServer(captureVideoPath);
  try {
    await captureKeyboardShortcutSources(locales, extensionPath, captureServer.url);
  } finally {
    await closeServer(captureServer.server);
  }

  const singleShots = createSingleShots();
  const generatedPngs: string[] = [];
  const tempSvgRoot = mkdtempSync(join(tmpdir(), 'tme-cws-promo-'));

  try {
    for (const locale of locales) {
      for (const pair of pairs) {
        const transientSvgPath = join(tempSvgRoot, `${locale.code}-${pair.id}.svg`);
        const pngPath = join(pngOutputRoot, locale.code, `${pair.id}.png`);
        const svg = buildComparisonSvg(comparisonTemplate, pair, locale);

        validateGeneratedSvg(svg, locale, ['before_label', 'after_label']);
        mkdirSync(dirname(pngPath), { recursive: true });
        writeFileSync(transientSvgPath, svg);
        renderSvg(transientSvgPath, pngPath);
        assertPngSize(pngPath, outputSize.width, outputSize.height);
        generatedPngs.push(pngPath);
      }

      for (const shot of singleShots) {
        const sourcePath = join(assetRoot, shot.sourceForLocale(locale));
        const transientSvgPath = join(tempSvgRoot, `${locale.code}-${shot.id}.svg`);
        const pngPath = join(pngOutputRoot, locale.code, `${shot.id}.png`);
        const svg = buildSingleSvg(fullTemplate, shot, sourcePath, locale);

        validateGeneratedSvg(svg, locale, ['single_label']);
        mkdirSync(dirname(pngPath), { recursive: true });
        writeFileSync(transientSvgPath, svg);
        renderSvg(transientSvgPath, pngPath);
        assertPngSize(pngPath, outputSize.width, outputSize.height);
        generatedPngs.push(pngPath);
      }
    }
  } finally {
    rmSync(tempSvgRoot, { recursive: true, force: true });
  }

  const outputLabel = options.localeCode
    ? relative(repoRoot, join(pngOutputRoot, options.localeCode))
    : relative(repoRoot, pngOutputRoot);
  console.log(`Generated ${generatedPngs.length} PNG files at ${outputLabel}`);
}

function parseRenderOptions(args: string[]): RenderOptions {
  const options: RenderOptions = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--') {
      continue;
    }

    if (arg === '--locale') {
      const value = args[index + 1];
      if (!value || value.startsWith('-')) {
        throw new Error('Expected a locale code after --locale, for example: --locale ko');
      }
      options.localeCode = normalizeLocaleCode(value);
      index += 1;
      continue;
    }

    if (arg.startsWith('--locale=')) {
      options.localeCode = normalizeLocaleCode(arg.slice('--locale='.length));
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      console.log([
        'Usage: pnpm store:cws:screenshots [-- --locale <code>]',
        '',
        'Examples:',
        '  pnpm store:cws:screenshots',
        '  pnpm store:cws:screenshots -- --locale ko',
        '  pnpm store:cws:screenshots -- --locale=pt_BR',
      ].join('\n'));
      process.exit(0);
    }

    if (!arg.startsWith('-') && !options.localeCode) {
      options.localeCode = normalizeLocaleCode(arg);
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function normalizeLocaleCode(localeCode: string): string {
  const raw = localeCode.trim().replace('-', '_');
  if (!/^[A-Za-z]{2,3}(?:_[A-Za-z]{2})?$/.test(raw)) {
    throw new Error(`Invalid locale code: ${localeCode}`);
  }

  const [language, region] = raw.split('_');
  return region ? `${language.toLowerCase()}_${region.toUpperCase()}` : language.toLowerCase();
}

function selectLocales(locales: LocalePack[], options: RenderOptions): LocalePack[] {
  if (!options.localeCode) {
    return locales;
  }

  const locale = locales.find((candidate) => candidate.code === options.localeCode);
  if (!locale) {
    const supportedCodes = locales.map((candidate) => candidate.code).join(', ');
    throw new Error(`Unsupported locale "${options.localeCode}". Supported locales: ${supportedCodes}`);
  }

  console.log(`Generating CWS screenshots for locale: ${locale.code}`);
  return [locale];
}

function cleanPngOutputs(locales: LocalePack[], options: RenderOptions): void {
  if (!options.localeCode) {
    rmSync(pngOutputRoot, { recursive: true, force: true });
    return;
  }

  for (const locale of locales) {
    rmSync(join(pngOutputRoot, locale.code), { recursive: true, force: true });
  }
}

function createSingleShots(): SingleShot[] {
  return [
    {
      id: 'full_ui',
      labelKey: 'cwsPromoPlayerUiLabel',
      sourceForLocale: () => 'source/full_ui.png',
    },
    {
      id: 'keyboard_shortcuts',
      labelKey: 'cwsPromoShortcutsLabel',
      sourceForLocale: (locale) => `source/keyboard-shortcuts/${locale.code}.png`,
    },
  ];
}

/** Downloads the capture video outside the repo so local rendering is stable and screenshots stay deterministic. */
async function ensureCaptureVideoFile(): Promise<string> {
  if (existsSync(cachedVideoPath) && statSync(cachedVideoPath).size > minimumCachedVideoBytes) {
    return cachedVideoPath;
  }

  const response = await fetch(videoUrl);
  if (!response.ok) {
    throw new Error(`Could not download keyboard capture video: ${response.status} ${response.statusText}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength <= minimumCachedVideoBytes) {
    throw new Error(`Downloaded keyboard capture video is unexpectedly small: ${buffer.byteLength} bytes.`);
  }

  writeFileSync(cachedVideoPath, buffer);
  return cachedVideoPath;
}

/** Builds the unpacked Chrome extension that is loaded for keyboard-shortcuts screenshots. */
function buildChromeExtension(): string {
  execFileSync('pnpm', ['build'], { cwd: repoRoot, stdio: 'inherit' });

  const extensionPath = join(repoRoot, 'dist/chrome-unpacked');
  assertExists(join(extensionPath, 'manifest.json'));
  return extensionPath;
}

/** Reads Chrome extension locale folders and resolves promo labels from each language pack. */
function readLocales(): LocalePack[] {
  return readdirSync(localesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const code = entry.name;
      const messages = readMessages(code);
      let fontFamily: LocalePack['fontFamily'] = 'Montserrat';
      if (code === 'zh_CN') {
        fontFamily = 'Noto Sans SC';
      } else if (code === 'ja') {
        fontFamily = 'Noto Sans JP';
      } else if (code === 'ar') {
        fontFamily = 'Noto Sans Arabic';
      } else if (code === 'ko') {
        fontFamily = 'Noto Sans KR';
      }

      return {
        code,
        chromeLang: toChromeLanguage(code),
        messages,
        fontFamily,
      };
    })
    .sort((a, b) => a.code.localeCompare(b.code));
}

function toChromeLanguage(localeCode: string): string {
  return localeCode.replace('_', '-');
}

function getLocaleBidiDir(localeCode: string): 'ltr' | 'rtl' {
  return localeCode === 'ar' ? 'rtl' : 'ltr';
}

function readMessages(localeCode: string): ChromeMessages {
  return JSON.parse(readFileSync(join(localesRoot, localeCode, 'messages.json'), 'utf8')) as ChromeMessages;
}

function readMessage(locale: LocalePack, key: string): string {
  const message = locale.messages[key]?.message;

  if (!message) {
    throw new Error(`Missing _locales/${locale.code}/messages.json message: ${key}`);
  }

  return message;
}

/** Reads and validates the raster pairs manifest before any rendering starts. */
function readPairs(): ComparisonPair[] {
  const parsed = JSON.parse(readFileSync(pairsPath, 'utf8')) as PairsFile;

  if (!Array.isArray(parsed.pairs) || parsed.pairs.length === 0) {
    throw new Error(`${pairsPath} must contain a non-empty "pairs" array.`);
  }

  for (const pair of parsed.pairs) {
    if (!pair.id || !pair.title || !pair.before || !pair.after) {
      throw new Error(`Invalid screenshot pair entry: ${JSON.stringify(pair)}`);
    }

    assertExists(join(assetRoot, pair.before));
    assertExists(join(assetRoot, pair.after));
  }

  return parsed.pairs;
}

/** Checks that the comparison Affinity template still exposes all ids the pipeline replaces or measures. */
function validateComparisonTemplate(template: string): void {
  for (const id of [
    'after_mask',
    'before_mask',
    'before_label_box',
    'after_label_box',
    'before_label',
    'after_label',
  ]) {
    findElementById(template, id);
  }
}

/** Checks that the single-image template is normalized and free of Affinity's embedded raster/text outlines. */
function validateSingleTemplate(template: string): void {
  for (const id of ['mask', 'label_box']) {
    findElementById(template, id);
  }

  if (template.includes('before_label') || template.includes('_Image') || template.includes('base64,')) {
    throw new Error(`${relative(repoRoot, templateFullPath)} must not contain outlined labels or embedded rasters.`);
  }
}

function buildComparisonSvg(template: string, pair: ComparisonPair, locale: LocalePack): string {
  const beforeMask = findElementById(template, 'before_mask').source;
  const afterMask = findElementById(template, 'after_mask').source;
  const beforeBox = parseLabelBox(template, 'before_label_box');
  const afterBox = parseLabelBox(template, 'after_label_box');

  let svg = template;
  svg = removeElementById(svg, 'before_label');
  svg = removeElementById(svg, 'after_label');
  svg = removeElementById(svg, 'before_mask');
  svg = removeElementById(svg, 'after_mask');

  const defs = [
    '<defs>',
    buildStyleBlock(),
    `<clipPath id="before_clip" clipPathUnits="userSpaceOnUse">${buildClipPathContent(beforeMask)}</clipPath>`,
    `<clipPath id="after_clip" clipPathUnits="userSpaceOnUse">${buildClipPathContent(afterMask)}</clipPath>`,
    '</defs>',
  ].join('\n');
  const beforeHref = fileUrlHref(join(assetRoot, pair.before));
  const afterHref = fileUrlHref(join(assetRoot, pair.after));
  const images = [
    `<image id="after_raster" href="${afterHref}" x="0" y="0" width="${outputSize.width}" height="${outputSize.height}" preserveAspectRatio="xMidYMid slice" clip-path="url(#after_clip)"/>`,
    `<image id="before_raster" href="${beforeHref}" x="0" y="0" width="${outputSize.width}" height="${outputSize.height}" preserveAspectRatio="xMidYMid slice" clip-path="url(#before_clip)"/>`,
  ].join('\n');
  const labels = [
    buildText('before_label', readMessage(locale, 'cwsPromoBeforeLabel'), locale.fontFamily, beforeBox),
    buildText('after_label', readMessage(locale, 'cwsPromoAfterLabel'), locale.fontFamily, afterBox),
  ].join('\n');

  return injectSvgContent(svg, defs, images, labels);
}

function buildSingleSvg(template: string, shot: SingleShot, sourcePath: string, locale: LocalePack): string {
  assertExists(sourcePath);

  const mask = findElementById(template, 'mask').source;
  const labelBox = parseLabelBox(template, 'label_box');
  let svg = removeElementById(template, 'mask');

  const defs = [
    '<defs>',
    buildStyleBlock(),
    `<clipPath id="single_clip" clipPathUnits="userSpaceOnUse">${buildClipPathContent(mask)}</clipPath>`,
    '</defs>',
  ].join('\n');
  const sourceHref = fileUrlHref(sourcePath);
  const images = `<image id="single_raster" href="${sourceHref}" x="0" y="0" width="${outputSize.width}" height="${outputSize.height}" preserveAspectRatio="xMidYMid slice" clip-path="url(#single_clip)"/>`;
  const label = buildText('single_label', readMessage(locale, shot.labelKey), locale.fontFamily, labelBox);

  return injectSvgContent(svg, defs, images, label);
}

function injectSvgContent(svg: string, defs: string, images: string, labels: string): string {
  const openingSvgEnd = svg.indexOf('>', svg.indexOf('<svg'));

  if (openingSvgEnd === -1) {
    throw new Error('Template does not contain an opening <svg> tag.');
  }

  const withInjectedRasters = `${svg.slice(0, openingSvgEnd + 1)}\n${defs}\n${images}\n${svg.slice(openingSvgEnd + 1)}`;
  return withInjectedRasters.replace('</svg>', `${labels}\n${buildFitScript()}\n</svg>`);
}

function buildStyleBlock(): string {
  return [
    '<style type="text/css">',
    '<![CDATA[',
    buildFontCss(),
    `.cws-label{font-weight:700;font-size:${defaultFontSizePt}pt;fill:#fff;text-anchor:middle;dominant-baseline:middle;}`,
    ']]>',
    '</style>',
  ].join('\n');
}

function buildFontCss(): string {
  const montserratHref = fileUrlHref(join(assetRoot, 'fonts/Montserrat[wght].ttf'));
  const notoHref = fileUrlHref(join(assetRoot, 'fonts/NotoSansSC[wght].ttf'));
  const jpHref = fileUrlHref(join(assetRoot, 'fonts/NotoSansJP[wght].ttf'));
  const arHref = fileUrlHref(join(assetRoot, 'fonts/NotoSansArabic[wght].ttf'));
  const krHref = fileUrlHref(join(assetRoot, 'fonts/NotoSansKR[wght].ttf'));

  return [
    '@font-face{font-family:"Montserrat";font-style:normal;font-weight:100 900;font-display:block;src:url("' +
      montserratHref +
      '") format("truetype");}',
    '@font-face{font-family:"Noto Sans SC";font-style:normal;font-weight:100 900;font-display:block;src:url("' +
      notoHref +
      '") format("truetype");}',
    '@font-face{font-family:"Noto Sans JP";font-style:normal;font-weight:100 900;font-display:block;src:url("' +
      jpHref +
      '") format("truetype");}',
    '@font-face{font-family:"Noto Sans Arabic";font-style:normal;font-weight:100 900;font-display:block;src:url("' +
      arHref +
      '") format("truetype");}',
    '@font-face{font-family:"Noto Sans KR";font-style:normal;font-weight:100 900;font-display:block;src:url("' +
      krHref +
      '") format("truetype");}',
  ].join('\n');
}

function buildText(id: string, value: string, fontFamily: LocalePack['fontFamily'], box: LabelBox): string {
  return `<text id="${id}" class="cws-label" x="${round(box.centerX)}" y="${round(
    box.centerY,
  )}" font-family="${escapeAttribute(fontFamily)}" data-default-font-size-px="${defaultFontSizePx}" data-fit-width="${round(
    box.fitWidth,
  )}" data-fit-height="${round(box.fitHeight)}">${escapeText(value)}</text>`;
}

/** Shrinks labels inside Chrome only when a translated string overflows the fixed label box. */
function buildFitScript(): string {
  return [
    '<script type="text/ecmascript">',
    '<![CDATA[',
    '(function(){',
    'function fitLabels(){',
    'var labels=document.querySelectorAll(".cws-label");',
    'for(var i=0;i<labels.length;i++){',
    'var label=labels[i];',
    'var size=parseFloat(label.getAttribute("data-default-font-size-px")||"48");',
    'var maxWidth=parseFloat(label.getAttribute("data-fit-width")||"300");',
    'var maxHeight=parseFloat(label.getAttribute("data-fit-height")||"70");',
    'label.style.fontSize=size+"px";',
    'while(size>18){',
    'var box=label.getBBox();',
    'if(box.width<=maxWidth&&box.height<=maxHeight){break;}',
    'size-=1;',
    'label.style.fontSize=size+"px";',
    '}',
    '}',
    '}',
    'if(document.fonts&&document.fonts.ready){document.fonts.ready.then(fitLabels);}else{fitLabels();}',
    '})();',
    ']]>',
    '</script>',
  ].join('\n');
}

/** Calculates the visual center and usable label bounds from Affinity's transformed box. */
function parseLabelBox(svg: string, id: string): LabelBox {
  const element = findElementById(svg, id).source;
  const openingTagEnd = element.indexOf('>');
  const openingTag = element.slice(0, openingTagEnd + 1);
  const matrix = parseMatrix(readRequiredAttribute(openingTag, 'transform'));
  const rectTagMatch = element.match(/<rect\b[^>]*>/);

  if (!rectTagMatch) {
    throw new Error(`Could not find <rect> inside #${id}.`);
  }

  const rectTag = rectTagMatch[0];
  const x = parseNumericAttribute(rectTag, 'x');
  const y = parseNumericAttribute(rectTag, 'y');
  const width = parseNumericAttribute(rectTag, 'width');
  const height = parseNumericAttribute(rectTag, 'height');
  const localCenterX = x + width / 2;
  const localCenterY = y + height / 2;

  return {
    centerX: matrix.a * localCenterX + matrix.c * localCenterY + matrix.e,
    centerY: matrix.b * localCenterX + matrix.d * localCenterY + matrix.f,
    fitWidth: Math.abs(matrix.a) * width - 28,
    fitHeight: Math.abs(matrix.d) * height - 10,
  };
}

function parseMatrix(value: string): { a: number; b: number; c: number; d: number; e: number; f: number } {
  const match = value.match(/^matrix\(([^)]+)\)$/);
  if (!match) {
    throw new Error(`Expected matrix(...) transform, got: ${value}`);
  }

  const numbers = match[1].split(',').map((part) => Number.parseFloat(part.trim()));
  if (numbers.length !== 6 || numbers.some((number) => Number.isNaN(number))) {
    throw new Error(`Invalid SVG transform matrix: ${value}`);
  }

  const [a, b, c, d, e, f] = numbers;
  return { a, b, c, d, e, f };
}

function readRequiredAttribute(tag: string, attribute: string): string {
  const match = tag.match(new RegExp(`\\s${escapeRegExp(attribute)}="([^"]+)"`));
  if (!match) {
    throw new Error(`Missing ${attribute} attribute in ${tag}`);
  }

  return match[1];
}

function parseNumericAttribute(tag: string, attribute: string): number {
  const value = Number.parseFloat(readRequiredAttribute(tag, attribute));
  if (Number.isNaN(value)) {
    throw new Error(`Invalid numeric ${attribute} attribute in ${tag}`);
  }

  return value;
}

/** Captures raw shortcut overlay screenshots by driving Chrome with the unpacked extension. */
async function captureKeyboardShortcutSources(
  locales: LocalePack[],
  extensionPath: string,
  capturePageUrl: string,
): Promise<void> {
  mkdirSync(keyboardSourceRoot, { recursive: true });

  for (const locale of locales) {
    const outputPath = join(keyboardSourceRoot, `${locale.code}.png`);
    await captureKeyboardShortcutSource(locale, extensionPath, capturePageUrl, outputPath);
    assertPngSize(outputPath, outputSize.width, outputSize.height);
  }
}

async function captureKeyboardShortcutSource(
  locale: LocalePack,
  extensionPath: string,
  capturePageUrl: string,
  outputPath: string,
): Promise<void> {
  const profileDir = mkdtempSync(join(tmpdir(), `tme-cws-chrome-${locale.code}-`));
  const chrome = launchChrome(profileDir, extensionPath, locale.chromeLang);

  try {
    const browserWsUrl = await waitForBrowserWebSocketUrl(profileDir, chrome);
    const cdp = await CdpClient.connect(browserWsUrl);

    try {
      const { targetId } = await cdp.call<{ targetId: string }>('Target.createTarget', {
        url: 'about:blank',
      });
      const { sessionId } = await cdp.call<{ sessionId: string }>('Target.attachToTarget', {
        targetId,
        flatten: true,
      });

      await cdp.call('Page.enable', {}, sessionId);
      await cdp.call('Runtime.enable', {}, sessionId);
      await cdp.call('Emulation.setDeviceMetricsOverride', {
        width: outputSize.width,
        height: outputSize.height,
        deviceScaleFactor: 1,
        mobile: false,
      }, sessionId);
      await cdp.call('Page.bringToFront', {}, sessionId);
      await delay(1_000);
      await cdp.call('Page.navigate', { url: capturePageUrl }, sessionId);

      await waitForExpression(cdp, sessionId, 'document.readyState !== "loading" && !!document.querySelector("video")', 20_000);
      await evaluate(cdp, sessionId, [
        '(() => {',
        'const video = document.querySelector("video");',
        'if (!video) return false;',
        'video.muted = true;',
        'video.controls = true;',
        'const seek = () => { if (Number.isFinite(video.duration) && video.duration > 9) video.currentTime = 8; };',
        'if (video.readyState >= 1) seek(); else video.addEventListener("loadedmetadata", seek, { once: true });',
        'video.play().catch(() => {});',
        'return true;',
        '})()',
      ].join(''));
      await waitForExpression(cdp, sessionId, [
        '(() => {',
        'const video = document.querySelector("video");',
        'if (!video || video.readyState < 2 || video.videoWidth <= 0 || video.videoHeight <= 0 || video.currentTime < 7.5) return false;',
        'const canvas = document.createElement("canvas");',
        'canvas.width = 8;',
        'canvas.height = 8;',
        'const context = canvas.getContext("2d", { willReadFrequently: true });',
        'if (!context) return false;',
        'context.drawImage(video, 0, 0, 8, 8);',
        'const pixels = context.getImageData(0, 0, 8, 8).data;',
        'for (let i = 0; i < pixels.length; i += 4) {',
        'if (pixels[i] + pixels[i + 1] + pixels[i + 2] > 45) return true;',
        '}',
        'return false;',
        '})()',
      ].join(''), 30_000);

      await assertLegacyCaptureEventIsIgnored(cdp, sessionId);
      await cdp.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 640, y: 400 }, sessionId);
      await dispatchCaptureShortcut(cdp, sessionId, 'T');
      if (!(await waitForExpressionResult(cdp, sessionId, '!!document.querySelector(".theater-everywhere-video-active")', 2_000))) {
        await injectContentScriptFallback(cdp, sessionId, locale, extensionPath);
        await dispatchCaptureShortcut(cdp, sessionId, 'T');
      }
      await waitForExpression(cdp, sessionId, '!!document.querySelector(".theater-everywhere-video-active")', 20_000);
      await delay(350);
      await dispatchCaptureShortcut(cdp, sessionId, 'H');
      await waitForExpression(cdp, sessionId, '!!document.querySelector(".theater-help-overlay")', 10_000);
      await waitForExpression(
        cdp,
        sessionId,
        `document.querySelector(".theater-help-overlay")?.dir === ${JSON.stringify(getLocaleBidiDir(locale.code))}`,
        5_000,
      );
      await delay(1_000);

      const { data } = await cdp.call<{ data: string }>('Page.captureScreenshot', {
        format: 'png',
        fromSurface: true,
        captureBeyondViewport: false,
      }, sessionId);
      writeFileSync(outputPath, Buffer.from(data, 'base64'));
    } finally {
      cdp.close();
    }
  } finally {
    await stopChrome(chrome);
    await removeTempDir(profileDir);
  }
}

async function startVideoCaptureServer(videoFilePath: string): Promise<{ server: Server; url: string }> {
  const server = createServer((request, response) => {
    if (request.url?.startsWith('/video.mp4')) {
      serveVideo(request, response, videoFilePath);
      return;
    }

    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    });
    response.end([
      '<!doctype html>',
      '<html lang="en">',
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      '<title>Theater Everywhere CWS capture</title>',
      '<style>',
      'html,body{margin:0;width:100%;height:100%;background:#050505;overflow:hidden}',
      'video{display:block;width:100vw;height:100vh;object-fit:contain;background:#050505}',
      '</style>',
      '<video src="/video.mp4" controls autoplay muted playsinline></video>',
      '</html>',
    ].join('\n'));
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Could not bind local capture server.');
  }

  return { server, url: `http://127.0.0.1:${address.port}/` };
}

function serveVideo(request: IncomingMessage, response: ServerResponse, videoFilePath: string): void {
  const videoSize = statSync(videoFilePath).size;
  const range = request.headers.range;

  if (!range) {
    response.writeHead(200, {
      'content-type': 'video/mp4',
      'content-length': videoSize,
      'accept-ranges': 'bytes',
      'cache-control': 'no-store',
    });
    createReadStream(videoFilePath).pipe(response);
    return;
  }

  const match = range.match(/^bytes=(\d+)-(\d*)$/);
  if (!match) {
    response.writeHead(416);
    response.end();
    return;
  }

  const start = Number.parseInt(match[1], 10);
  const requestedEnd = match[2] ? Number.parseInt(match[2], 10) : videoSize - 1;
  const end = Math.min(requestedEnd, videoSize - 1);

  if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= videoSize) {
    response.writeHead(416, { 'content-range': `bytes */${videoSize}` });
    response.end();
    return;
  }

  response.writeHead(206, {
    'content-type': 'video/mp4',
    'content-length': end - start + 1,
    'content-range': `bytes ${start}-${end}/${videoSize}`,
    'accept-ranges': 'bytes',
    'cache-control': 'no-store',
  });
  createReadStream(videoFilePath, { start, end }).pipe(response);
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

function launchChrome(profileDir: string, extensionPath: string, chromeLang: string): ChildProcessWithoutNullStreams {
  const args = [
    '--no-first-run',
    '--no-default-browser-check',
    '--autoplay-policy=no-user-gesture-required',
    '--disable-background-networking',
    '--disable-sync',
    '--mute-audio',
    '--hide-scrollbars',
    '--remote-debugging-port=0',
    `--user-data-dir=${profileDir}`,
    `--lang=${chromeLang}`,
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
    `--window-size=${outputSize.width},${outputSize.height}`,
    'about:blank',
  ];

  if (process.env.CWS_CAPTURE_HEADLESS !== '0') {
    args.unshift('--headless=new');
  }

  const chrome = spawn(chromePath, args, { stdio: 'pipe' });
  let output = '';
  const captureOutput = (chunk: Buffer): void => {
    output = `${output}${chunk.toString('utf8')}`.slice(-4_000);
    chromeProcessOutput.set(chrome, output);
  };

  chrome.stdout.on('data', captureOutput);
  chrome.stderr.on('data', captureOutput);
  return chrome;
}

async function stopChrome(chrome: ChildProcessWithoutNullStreams): Promise<void> {
  if (chrome.exitCode !== null || chrome.signalCode !== null) return;

  const exited = new Promise<void>((resolve) => {
    chrome.once('exit', () => resolve());
  });

  chrome.kill('SIGTERM');
  await Promise.race([exited, delay(1_000)]);

  if (chrome.exitCode === null && chrome.signalCode === null) {
    chrome.kill('SIGKILL');
    await Promise.race([exited, delay(1_000)]);
  }
}

async function removeTempDir(dirPath: string): Promise<void> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      rmSync(dirPath, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      await delay(200);
    }
  }

  throw lastError;
}

async function waitForBrowserWebSocketUrl(
  profileDir: string,
  chrome: ChildProcessWithoutNullStreams,
): Promise<string> {
  const portFile = join(profileDir, 'DevToolsActivePort');
  try {
    await waitFor(() => existsSync(portFile), 30_000, 'Chrome DevToolsActivePort file');
  } catch (error) {
    const output = chromeProcessOutput.get(chrome)?.trim();
    if (output) {
      throw new Error(`${String(error)}\nChrome output:\n${output}`);
    }
    throw error;
  }

  const [port] = readFileSync(portFile, 'utf8').trim().split('\n');
  if (!port) {
    throw new Error('Chrome DevToolsActivePort did not contain a port.');
  }

  const version = await fetchJson<{ webSocketDebuggerUrl?: string }>(`http://127.0.0.1:${port}/json/version`);
  if (!version.webSocketDebuggerUrl) {
    chrome.kill('SIGTERM');
    throw new Error('Chrome did not expose a browser websocket debugger URL.');
  }

  return version.webSocketDebuggerUrl;
}

async function dispatchCaptureShortcut(cdp: CdpClient, sessionId: string, key: 'T' | 'H'): Promise<void> {
  const event = {
    key: key.toLowerCase(),
    code: `Key${key}`,
    windowsVirtualKeyCode: key.charCodeAt(0),
    nativeVirtualKeyCode: key.charCodeAt(0),
  };

  await cdp.call('Input.dispatchKeyEvent', { type: 'keyDown', ...event }, sessionId);
  await cdp.call('Input.dispatchKeyEvent', { type: 'keyUp', ...event }, sessionId);
}

async function assertLegacyCaptureEventIsIgnored(cdp: CdpClient, sessionId: string): Promise<void> {
  const enteredTheater = await evaluate(cdp, sessionId, [
    '(() => {',
    'window.dispatchEvent(new CustomEvent("theater-everywhere-cws-capture-command", {',
    'detail: { action: "enter-theater" },',
    'bubbles: true,',
    'cancelable: true',
    '}));',
    'return !!document.querySelector(".theater-everywhere-video-active");',
    '})()',
  ].join(''));

  if (enteredTheater) {
    throw new Error('Legacy page-triggerable CWS capture event unexpectedly entered theater mode.');
  }
}

async function injectContentScriptFallback(
  cdp: CdpClient,
  sessionId: string,
  locale: LocalePack,
  extensionPath: string,
): Promise<void> {
  const css = readFileSync(join(extensionPath, 'content.css'), 'utf8');
  const js = readFileSync(join(extensionPath, 'content.js'), 'utf8');
  const messages = Object.fromEntries(
    Object.entries(locale.messages).map(([key, value]) => [key, value.message ?? '']),
  );
  messages['@@bidi_dir'] = getLocaleBidiDir(locale.code);
  messages['@@ui_locale'] = locale.chromeLang;

  await evaluate(cdp, sessionId, [
    '(() => {',
    'if (window.__theaterEverywhereCwsFallbackInjected) return true;',
    'window.__theaterEverywhereCwsFallbackInjected = true;',
    'window.chrome = window.chrome || {};',
    `window.chrome.__tmeCwsMessages = ${JSON.stringify(messages)};`,
    'window.chrome.i18n = window.chrome.i18n || {};',
    'window.chrome.i18n.getMessage = (key, substitutions) => {',
    'let message = window.chrome.__tmeCwsMessages[key] || "";',
    'const values = Array.isArray(substitutions) ? substitutions : substitutions === undefined ? [] : [substitutions];',
    'values.forEach((value, index) => { message = message.replace(new RegExp("\\\\$" + (index + 1), "g"), String(value)); });',
    'return message;',
    '};',
    'window.chrome.storage = window.chrome.storage || {};',
    'window.chrome.storage.sync = window.chrome.storage.sync || {};',
    'window.chrome.storage.sync.get = async () => ({});',
    'window.chrome.runtime = window.chrome.runtime || {};',
    'window.chrome.runtime.onMessage = window.chrome.runtime.onMessage || { addListener: () => {} };',
    'const style = document.createElement("style");',
    `style.textContent = ${JSON.stringify(css)};`,
    'document.documentElement.appendChild(style);',
    'const script = document.createElement("script");',
    `script.textContent = ${JSON.stringify(js)};`,
    'document.documentElement.appendChild(script);',
    'script.remove();',
    'return true;',
    '})()',
  ].join(''));

  await waitForExpression(cdp, sessionId, '!!window.__theaterEverywhereCwsFallbackInjected', 5_000);
  await delay(250);
}

async function evaluate(cdp: CdpClient, sessionId: string, expression: string): Promise<unknown> {
  const result = await cdp.call<{ result: { value?: unknown }; exceptionDetails?: unknown }>('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  }, sessionId);

  if (result.exceptionDetails) {
    throw new Error(`Runtime.evaluate failed: ${JSON.stringify(result.exceptionDetails)}`);
  }

  return result.result.value;
}

async function waitForExpression(
  cdp: CdpClient,
  sessionId: string,
  expression: string,
  timeoutMs: number,
): Promise<void> {
  await waitFor(async () => Boolean(await evaluate(cdp, sessionId, expression)), timeoutMs, expression);
}

async function waitForExpressionResult(
  cdp: CdpClient,
  sessionId: string,
  expression: string,
  timeoutMs: number,
): Promise<boolean> {
  try {
    await waitForExpression(cdp, sessionId, expression, timeoutMs);
    return true;
  } catch (_) {
    return false;
  }
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs: number,
  label: string,
): Promise<void> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    if (await predicate()) {
      return;
    }
    await delay(100);
  }

  throw new Error(`Timed out waiting for ${label}.`);
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`GET ${url} failed with ${response.status}`);
  }

  return response.json() as Promise<T>;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class CdpClient {
  private nextId = 1;
  private callbacks = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();

  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as Partial<CdpSuccess<unknown> & CdpFailure>;
      if (typeof message.id !== 'number') return;

      const callback = this.callbacks.get(message.id);
      if (!callback) return;

      this.callbacks.delete(message.id);
      if ('error' in message && message.error) {
        callback.reject(new Error(message.error.data || message.error.message));
      } else {
        callback.resolve(message.result);
      }
    });
  }

  static connect(url: string): Promise<CdpClient> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      socket.addEventListener('open', () => resolve(new CdpClient(socket)));
      socket.addEventListener('error', () => reject(new Error(`Could not connect to CDP websocket: ${url}`)));
    });
  }

  call<T = Record<string, never>>(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<T> {
    const id = this.nextId++;
    const payload = sessionId ? { id, method, params, sessionId } : { id, method, params };

    return new Promise((resolve, reject) => {
      this.callbacks.set(id, { resolve: (value) => resolve(value as T), reject });
      this.socket.send(JSON.stringify(payload));
    });
  }

  close(): void {
    this.socket.close();
  }
}

/** Renders one transient SVG file into the committed PNG output tree. */
function renderSvg(svgPath: string, pngPath: string): void {
  execFileSync(
    chromePath,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--allow-file-access-from-files',
      `--screenshot=${pngPath}`,
      `--window-size=${outputSize.width},${outputSize.height}`,
      pathToFileURL(svgPath).href,
    ],
    { stdio: 'pipe' },
  );
}

function validateGeneratedSvg(svg: string, locale: LocalePack, labelIds: string[]): void {
  if (
    !svg.includes('@font-face') ||
    !svg.includes('Montserrat') ||
    !svg.includes('Noto Sans SC') ||
    !svg.includes('Noto Sans JP') ||
    !svg.includes('Noto Sans Arabic') ||
    !svg.includes('Noto Sans KR')
  ) {
    throw new Error(`Generated transient SVG for ${locale.code} is missing embedded @font-face declarations.`);
  }

  for (const labelId of labelIds) {
    if (!svg.includes(`<text id="${labelId}"`)) {
      throw new Error(`Generated transient SVG for ${locale.code} is missing editable #${labelId}.`);
    }
  }

  if (!svg.includes(`font-family="${locale.fontFamily}"`)) {
    throw new Error(`Generated transient SVG for ${locale.code} does not use ${locale.fontFamily}.`);
  }
}

/** Reads the PNG IHDR header so the script can fail fast on wrong CWS dimensions. */
function assertPngSize(filePath: string, width: number, height: number): void {
  const buffer = readFileSync(filePath);
  const pngSignature = '89504e470d0a1a0a';

  if (buffer.subarray(0, 8).toString('hex') !== pngSignature) {
    throw new Error(`${filePath} is not a PNG file.`);
  }

  const actualWidth = buffer.readUInt32BE(16);
  const actualHeight = buffer.readUInt32BE(20);
  if (actualWidth !== width || actualHeight !== height) {
    throw new Error(`${filePath} is ${actualWidth}x${actualHeight}, expected ${width}x${height}.`);
  }
}

function findElementById(source: string, id: string): ElementMatch {
  const idIndex = source.indexOf(`id="${id}"`);
  if (idIndex === -1) {
    throw new Error(`Could not find SVG element with id="${id}".`);
  }

  const start = source.lastIndexOf('<', idIndex);
  const openingEnd = source.indexOf('>', idIndex);
  if (start === -1 || openingEnd === -1) {
    throw new Error(`Could not parse SVG element with id="${id}".`);
  }

  const openingTag = source.slice(start, openingEnd + 1);
  const tagMatch = openingTag.match(/^<([A-Za-z][\w:-]*)\b/);
  if (!tagMatch) {
    throw new Error(`Could not determine tag name for id="${id}".`);
  }

  const tagName = tagMatch[1];
  if (openingTag.trim().endsWith('/>')) {
    return { start, end: openingEnd + 1, source: source.slice(start, openingEnd + 1) };
  }

  const tagPattern = new RegExp(`<(/?)${escapeRegExp(tagName)}\\b[^>]*(/?)>`, 'g');
  tagPattern.lastIndex = openingEnd + 1;

  let depth = 1;
  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(source)) !== null) {
    const isClosing = match[1] === '/';
    const isSelfClosing = match[2] === '/';

    if (isClosing) {
      depth -= 1;
    } else if (!isSelfClosing) {
      depth += 1;
    }

    if (depth === 0) {
      const end = match.index + match[0].length;
      return { start, end, source: source.slice(start, end) };
    }
  }

  throw new Error(`Could not find closing tag for SVG element id="${id}".`);
}

function removeElementById(source: string, id: string): string {
  const element = findElementById(source, id);
  return `${source.slice(0, element.start)}${source.slice(element.end)}`;
}

/** Converts Affinity mask groups into clipPath-safe path content. */
function buildClipPathContent(element: string): string {
  const trimmed = element.trim();

  if (trimmed.startsWith('<path')) {
    return stripId(trimmed);
  }

  const openingTagEnd = trimmed.indexOf('>');
  const openingTag = trimmed.slice(0, openingTagEnd + 1);
  const matrix = parseMatrix(readRequiredAttribute(openingTag, 'transform'));
  const pathMatch = trimmed.match(/<path\b[^>]*>/);
  if (!pathMatch) {
    throw new Error(`Could not build clipPath content from: ${trimmed.slice(0, 120)}`);
  }

  const pathTag = stripId(pathMatch[0]);
  const d = readRequiredAttribute(pathTag, 'd');
  const transformedD = transformSimplePathD(d, matrix);

  return pathTag.replace(`d="${d}"`, `d="${transformedD}"`);
}

function transformSimplePathD(
  d: string,
  matrix: { a: number; b: number; c: number; d: number; e: number; f: number },
): string {
  return d.replace(/([ML])(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g, (_match, command: string, rawX: string, rawY: string) => {
    const x = Number.parseFloat(rawX);
    const y = Number.parseFloat(rawY);
    const transformedX = matrix.a * x + matrix.c * y + matrix.e;
    const transformedY = matrix.b * x + matrix.d * y + matrix.f;

    return `${command}${round(transformedX)},${round(transformedY)}`;
  });
}

function stripId(element: string): string {
  return element.replace(/\s+id="[^"]+"/, '');
}

function fileUrlHref(filePath: string): string {
  return pathToFileURL(filePath).href;
}

function escapeText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function escapeAttribute(value: string): string {
  return escapeText(value).replaceAll('"', '&quot;');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function round(value: number): string {
  return value.toFixed(3).replace(/\.?0+$/, '');
}

function assertExists(filePath: string): void {
  if (!existsSync(filePath)) {
    throw new Error(`Missing required file: ${filePath}`);
  }
}
