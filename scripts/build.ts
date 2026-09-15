import { build } from 'vite';
import * as fs from 'fs';
import * as path from 'path';
import archiver from 'archiver';
import { assertSelfContainedBundles } from './bundle-integrity';

function copyFolderRecursiveSync(source: string, target: string) {
  let files: string[] = [];

  // Check if folder needs to be created
  const targetFolder = path.join(target, path.basename(source));
  if (!fs.existsSync(targetFolder)) {
    fs.mkdirSync(targetFolder, { recursive: true });
  }

  // Copy
  if (fs.lstatSync(source).isDirectory()) {
    files = fs.readdirSync(source);
    files.forEach((file) => {
      const curSource = path.join(source, file);
      if (fs.lstatSync(curSource).isDirectory()) {
        copyFolderRecursiveSync(curSource, targetFolder);
      } else {
        fs.copyFileSync(curSource, path.join(targetFolder, file));
      }
    });
  }
}

function copyDirContentSync(srcDir: string, destDir: string) {
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }
  const items = fs.readdirSync(srcDir);
  for (const item of items) {
    const srcPath = path.join(srcDir, item);
    const destPath = path.join(destDir, item);
    if (fs.lstatSync(srcPath).isDirectory()) {
      copyFolderRecursiveSync(srcPath, destDir);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function copyIfExistsSync(srcDir: string, destDir: string) {
  if (fs.existsSync(srcDir)) {
    copyFolderRecursiveSync(srcDir, destDir);
  }
}

function zipDirectory(sourceDir: string, outPath: string): Promise<void> {
  const archive = archiver('zip', { zlib: { level: 9 } });
  const stream = fs.createWriteStream(outPath);

  return new Promise((resolve, reject) => {
    archive
      .directory(sourceDir, false)
      .on('error', (err) => reject(err))
      .pipe(stream);

    stream.on('close', () => resolve());
    archive.finalize();
  });
}

async function buildClassicScript(entryName: 'content' | 'mainWorld', entryFile: string): Promise<void> {
  const root = path.resolve(__dirname, '..');
  await build({
    configFile: false,
    root,
    publicDir: false,
    build: {
      emptyOutDir: false,
      outDir: path.join(root, 'dist'),
      minify: false,
      cssCodeSplit: false,
      rollupOptions: {
        input: path.join(root, entryFile),
        output: {
          format: 'es',
          inlineDynamicImports: true,
          entryFileNames: `${entryName}.js`,
          assetFileNames: (assetInfo) => {
            if (entryName === 'content' && assetInfo.name && assetInfo.name.endsWith('.css')) {
              return 'content.css';
            }
            return 'assets/[name]-[hash][extname]';
          }
        }
      }
    }
  });
}

async function run() {
  try {
    console.log('=== Starting TypeScript + Vite Bundle & Build ===');
    
    // 1. Run Vite build
    console.log('Compiling TypeScript and HTML via Vite...');
    await build();
    console.log('Bundling isolated MV3 classic scripts...');
    await buildClassicScript('content', 'src/entries/content.ts');
    await buildClassicScript('mainWorld', 'src/entries/main-world.ts');

    const distDir = path.resolve(__dirname, '../dist');
    assertSelfContainedBundles(distDir);
    const chromeStagingDir = path.resolve(__dirname, '../chrome-unpacked');
    const firefoxStagingDir = path.resolve(__dirname, '../firefox-unpacked');

    // Clean any prior temp directories
    fs.rmSync(chromeStagingDir, { recursive: true, force: true });
    fs.rmSync(firefoxStagingDir, { recursive: true, force: true });

    // 2. Copy Vite dist output to target packages
    console.log('Copying build assets to staging folders...');
    copyDirContentSync(distDir, chromeStagingDir);
    copyDirContentSync(distDir, firefoxStagingDir);

    // Clean dist folder itself temporarily so it only houses the final zip outputs and unpacked extensions
    fs.rmSync(distDir, { recursive: true, force: true });
    fs.mkdirSync(distDir, { recursive: true });

    // 3. Sync version from package.json to manifest.json and copy manifests
    console.log('Syncing version from package.json to manifest.json...');
    const pkgPath = path.resolve(__dirname, '../package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    
    let version = pkg.version;
    const isCI = process.env.CI === 'true';

    if (!isCI) {
      const now = new Date();
      const yy = String(now.getFullYear()).slice(-2);
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const dd = String(now.getDate()).padStart(2, '0');
      const hh = String(now.getHours()).padStart(2, '0');
      const min = String(now.getMinutes()).padStart(2, '0');
      version = `0.${yy}.${mm}${dd}.${hh}${min}`;
      console.log(`Local build detected. Generating date-based version: ${version}`);
    } else {
      const envTag = process.env.RELEASE_TAG || process.env.GITHUB_REF_NAME || '';
      const tagVersion = envTag.replace(/^v/, '');
      if (/^\d+\.\d+\.\d+/.test(tagVersion)) {
        version = tagVersion;
        console.log(`CI build detected. Overriding version with tag-derived version: ${version}`);
      } else {
        console.log(`CI build detected. Using version from package.json: ${version}`);
      }
    }

    const manifestPath = path.resolve(__dirname, '../manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    
    if (isCI) {
      // Sync back to root manifest.json only in CI to keep local git status clean
      manifest.version = version;
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
    } else {
      // Just modify the manifest object in memory for local packaging
      manifest.version = version;
    }

    // Write to staging dirs
    fs.writeFileSync(
      path.resolve(chromeStagingDir, 'manifest.json'),
      JSON.stringify(manifest, null, 2),
      'utf8'
    );
    fs.writeFileSync(
      path.resolve(firefoxStagingDir, 'manifest.json'),
      JSON.stringify(manifest, null, 2),
      'utf8'
    );

    copyFolderRecursiveSync(
      path.resolve(__dirname, '../icons'),
      chromeStagingDir
    );
    copyFolderRecursiveSync(
      path.resolve(__dirname, '../icons'),
      firefoxStagingDir
    );

    copyIfExistsSync(
      path.resolve(__dirname, '../_locales'),
      chromeStagingDir
    );
    copyIfExistsSync(
      path.resolve(__dirname, '../_locales'),
      firefoxStagingDir
    );

    // 4. Inject Gecko settings for Firefox manifest.json
    console.log('Injecting Firefox-specific manifest settings...');
    const firefoxManifestPath = path.resolve(firefoxStagingDir, 'manifest.json');
    const firefoxManifest = JSON.parse(fs.readFileSync(firefoxManifestPath, 'utf8'));
    firefoxManifest.browser_specific_settings = {
      gecko: {
        id: 'theater-everywhere@tomaszjanusz.dev',
        strict_min_version: '140.0',
        data_collection_permissions: {
          required: ['none'],
          optional: []
        }
      }
    };
    // Replace service_worker with scripts[] for Firefox (service_worker is unsupported)
    if (firefoxManifest.background) {
      const sw = firefoxManifest.background.service_worker;
      firefoxManifest.background = { scripts: [sw] };
    }
    if (!firefoxManifest.permissions) {
      firefoxManifest.permissions = [];
    }
    if (!firefoxManifest.permissions.includes('theme')) {
      firefoxManifest.permissions.push('theme');
    }
    fs.writeFileSync(
      firefoxManifestPath,
      JSON.stringify(firefoxManifest, null, 2),
      'utf8'
    );

    // 5. Package into ZIP files
    console.log('Archiving extensions...');
    await zipDirectory(chromeStagingDir, path.resolve(distDir, 'theater-everywhere-chrome.zip'));
    console.log('  - Created dist/theater-everywhere-chrome.zip');

    await zipDirectory(firefoxStagingDir, path.resolve(distDir, 'theater-everywhere-firefox.zip'));
    console.log('  - Created dist/theater-everywhere-firefox.zip');

    // 6. Move staging folders to dist for development/unpacked testing
    console.log('Moving unpacked extensions to dist/ for easy browser loading...');
    fs.renameSync(chromeStagingDir, path.resolve(distDir, 'chrome-unpacked'));
    console.log('  - Created dist/chrome-unpacked/');
    
    fs.renameSync(firefoxStagingDir, path.resolve(distDir, 'firefox-unpacked'));
    console.log('  - Created dist/firefox-unpacked/');

    console.log('=== TypeScript + Vite Extension Build Successful! ===');
  } catch (error) {
    console.error('Build failed with error:', error);
    process.exit(1);
  }
}

run();
