#!/usr/bin/env node

/**
 * VisualVault - Windows 10 Spotlight Wallpaper Crawler & Downloader
 * 
 * High-performance, resumable crawler that downloads full-resolution
 * landscape & portrait wallpapers from https://windows10spotlight.com/
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE_URL = 'https://windows10spotlight.com';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    startPage: 1,
    endPage: null, // auto-detect if null
    concurrency: 5,
    outputDir: './spotlight_images',
    mode: 'deep', // 'deep' (crawls post pages for all orientations) or 'fast' (landscape from listing)
    orientation: 'all', // 'all', 'landscape', 'portrait'
    organize: 'orientation', // 'orientation', 'year', 'flat'
    naming: 'title', // 'title', 'hash', 'id'
    delay: 150, // ms polite delay
    saveMetadata: true,
    dryRun: false,
    help: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    switch (arg) {
      case '-h':
      case '--help':
        options.help = true;
        break;
      case '-s':
      case '--start-page':
        options.startPage = Math.max(1, parseInt(next, 10) || 1);
        i++;
        break;
      case '-e':
      case '--end-page':
        options.endPage = Math.max(1, parseInt(next, 10) || 1);
        i++;
        break;
      case '-p':
      case '--pages': {
        // supports "1-10" or "5"
        if (next && next.includes('-')) {
          const [start, end] = next.split('-').map(Number);
          if (!isNaN(start)) options.startPage = Math.max(1, start);
          if (!isNaN(end)) options.endPage = Math.max(1, end);
        } else if (next) {
          const num = parseInt(next, 10);
          if (!isNaN(num)) {
            options.startPage = 1;
            options.endPage = num;
          }
        }
        i++;
        break;
      }
      case '-c':
      case '--concurrency':
        options.concurrency = Math.max(1, Math.min(20, parseInt(next, 10) || 5));
        i++;
        break;
      case '-o':
      case '--output':
        if (next) options.outputDir = next;
        i++;
        break;
      case '-m':
      case '--mode':
        if (next && ['deep', 'fast'].includes(next.toLowerCase())) {
          options.mode = next.toLowerCase();
        }
        i++;
        break;
      case '--orientation':
        if (next && ['all', 'landscape', 'portrait'].includes(next.toLowerCase())) {
          options.orientation = next.toLowerCase();
        }
        i++;
        break;
      case '--organize':
        if (next && ['orientation', 'year', 'flat'].includes(next.toLowerCase())) {
          options.organize = next.toLowerCase();
        }
        i++;
        break;
      case '--naming':
        if (next && ['title', 'hash', 'id'].includes(next.toLowerCase())) {
          options.naming = next.toLowerCase();
        }
        i++;
        break;
      case '--delay':
        options.delay = Math.max(0, parseInt(next, 10) || 0);
        i++;
        break;
      case '--no-metadata':
        options.saveMetadata = false;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
    }
  }

  return options;
}

function showHelp() {
  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║        VisualVault - Windows Spotlight Wallpaper Downloader      ║
╚══════════════════════════════════════════════════════════════════╝

Downloads stunning high-resolution Windows Spotlight images from:
https://windows10spotlight.com/

USAGE:
  node visualvault.js [options]

OPTIONS:
  -p, --pages <range>          Page range to crawl (e.g. 1-10, 1-50, or 5 for first 5)
  -s, --start-page <number>    Start page number (default: 1)
  -e, --end-page <number>      End page number (default: auto-detected, ~1330)
  -c, --concurrency <number>   Number of concurrent downloads (1-20, default: 5)
  -o, --output <directory>     Target directory to save wallpapers (default: ./spotlight_images)
  -m, --mode <deep|fast>       Download mode:
                                'deep': crawls post pages to get BOTH landscape & portrait (default)
                                'fast': crawls only listing pages to quickly grab landscape wallpapers
  --orientation <type>         Filter orientation: 'all' (default), 'landscape', 'portrait'
  --organize <scheme>          Folder structure:
                                'orientation': subfolders for landscape & portrait (default)
                                'year': subfolders by year (e.g. 2026, 2025...)
                                'flat': all files in one folder
  --naming <style>             File naming format:
                                'title': "Milky Way Banff - 3daed88.jpg" (default)
                                'hash':  "3daed88345fd32f1829bd133a8d0ae5d.jpg"
                                'id':    "42389_landscape.jpg"
  --delay <milliseconds>       Delay between requests to be polite (default: 150ms)
  --no-metadata                Do not save metadata.json
  --dry-run                    Simulate crawling and show what would be downloaded
  -h, --help                   Display this help message

EXAMPLES:
  # Download the latest 5 pages with default settings (landscape & portrait organized)
  node visualvault.js -p 1-5

  # Fast download of 1920x1080 landscape wallpapers for pages 1 to 20
  node visualvault.js -p 1-20 --mode fast -c 8

  # Download only portrait wallpapers (great for phone screens)
  node visualvault.js -p 1-10 --orientation portrait

  # Download ALL images across all 1330+ pages
  node visualvault.js
`);
}

// Utility: Sleep
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Safe fetch with retries and exponential backoff
async function fetchWithRetry(url, maxRetries = 3, delayMs = 1000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9'
        }
      });

      if (response.status === 429 || response.status === 503) {
        const wait = delayMs * Math.pow(2, attempt - 1);
        console.warn(`[HTTP ${response.status}] Rate limited or server busy. Retrying in ${wait}ms... (${url})`);
        await sleep(wait);
        continue;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      return response;
    } catch (err) {
      if (attempt === maxRetries) throw err;
      const wait = delayMs * Math.pow(2, attempt - 1);
      await sleep(wait);
    }
  }
}

// Sanitize filename for Windows/macOS/Linux
function sanitizeFilename(name) {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '') // remove illegal chars
    .replace(/\s+/g, ' ')                  // normalize whitespace
    .trim()
    .slice(0, 100);                        // safe length limit
}

// State management for resumability
class VaultState {
  constructor(stateFilePath) {
    this.path = stateFilePath;
    this.data = {
      completedPages: [],
      downloadedUrls: {},
      totalDownloadedBytes: 0,
      metadata: []
    };
    this.load();
  }

  load() {
    if (fs.existsSync(this.path)) {
      try {
        const raw = fs.readFileSync(this.path, 'utf8');
        this.data = Object.assign(this.data, JSON.parse(raw));
      } catch (e) {
        console.warn(`Could not read state file ${this.path}, starting fresh.`);
      }
    }
  }

  save() {
    try {
      fs.writeFileSync(this.path, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (e) {
      // ignore state write errors
    }
  }

  isPageCompleted(page) {
    return this.data.completedPages.includes(page);
  }

  markPageCompleted(page) {
    if (!this.data.completedPages.includes(page)) {
      this.data.completedPages.push(page);
    }
  }

  isImageDownloaded(url) {
    return !!this.data.downloadedUrls[url];
  }

  recordDownloadedImage(url, info) {
    this.data.downloadedUrls[url] = info;
    if (info.size) this.data.totalDownloadedBytes += info.size;
    if (info.metadata) this.data.metadata.push(info.metadata);
  }
}

// Detect the total number of pages on the website
async function detectTotalPages() {
  try {
    const res = await fetchWithRetry(BASE_URL);
    const html = await res.text();
    const pageMatches = [...html.matchAll(/\/page\/(\d+)/g)].map(m => parseInt(m[1], 10));
    if (pageMatches.length > 0) {
      return Math.max(...pageMatches);
    }
  } catch (err) {
    console.warn('Could not auto-detect total pages from homepage, falling back to 1330.');
  }
  return 1330;
}

// Parse posts from a listing page
function parseListingPage(html) {
  const articles = [...html.matchAll(/<article[\s\S]*?<\/article>/gi)];
  const posts = [];

  for (const match of articles) {
    const articleHtml = match[0];
    
    // Post ID
    const idMatch = articleHtml.match(/post-(\d+)/i);
    const postId = idMatch ? idMatch[1] : null;

    // Post URL
    const urlMatch = articleHtml.match(/<a\s+[^>]*href=["'](https:\/\/windows10spotlight\.com\/images\/\d+)["']/i);
    const postUrl = urlMatch ? urlMatch[1] : (postId ? `${BASE_URL}/images/${postId}` : null);

    // Title
    const titleMatch = articleHtml.match(/<span class="entry-title hidden">([\s\S]*?)<\/span>/i) ||
                       articleHtml.match(/title=["']([\s\S]*?)["']/i);
    const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : `Spotlight Image ${postId || ''}`;

    // Date
    const dateMatch = articleHtml.match(/<span class="date">([\s\S]*?)<\/span>/i);
    const date = dateMatch ? dateMatch[1].trim() : '';

    // Fast mode: landscape image directly from listing srcset
    let landscapeUrl = null;
    const srcsetMatch = articleHtml.match(/srcset=["']([^"']+)["']/i);
    if (srcsetMatch) {
      const parts = srcsetMatch[1].split(',').map(s => s.trim().split(/\s+/));
      const fullRes = parts.find(p => p[1] === '1920w') || parts[parts.length - 1];
      if (fullRes && fullRes[0]) {
        landscapeUrl = fullRes[0];
      }
    }

    if (postUrl) {
      posts.push({
        postId,
        postUrl,
        title,
        date,
        fastLandscapeUrl: landscapeUrl
      });
    }
  }

  return posts;
}

// Parse full post page for all images and resolutions
async function parsePostPage(postUrl) {
  const res = await fetchWithRetry(postUrl);
  const html = await res.text();

  // Title
  const titleMatch = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : '';

  // Date
  const dateMatch = html.match(/<span class="date">([\s\S]*?)<\/span>/i);
  const date = dateMatch ? dateMatch[1].trim() : '';

  // Tags
  const tagsMatch = html.match(/<aside class="meta">Tags:([\s\S]*?)<\/aside>/i);
  const tags = tagsMatch
    ? [...tagsMatch[1].matchAll(/<a[^>]+>([\s\S]*?)<\/a>/gi)].map(m => m[1].trim())
    : [];

  // Extract all high-res upload hrefs
  const hrefMatches = [...html.matchAll(/href=["'](https:\/\/windows10spotlight\.com\/wp-content\/uploads\/[^"']+\.(?:jpe?g|png|webp))["']/gi)].map(m => m[1]);
  const uniqueHrefs = [...new Set(hrefMatches)];

  // Match resolutions from <pre> tags (e.g., 1920*1080 or 1080*1920)
  const preResolutions = [...html.matchAll(/<pre>(\d+)\*(\d+)/gi)].map(m => ({
    width: parseInt(m[1], 10),
    height: parseInt(m[2], 10)
  }));

  const images = [];
  uniqueHrefs.forEach((url, idx) => {
    let width = null;
    let height = null;
    let orientation = 'unknown';

    if (preResolutions[idx]) {
      width = preResolutions[idx].width;
      height = preResolutions[idx].height;
      orientation = width >= height ? 'landscape' : 'portrait';
    } else {
      // Fallback heuristics based on common portrait dimensions in filename or URL
      if (url.includes('576x1024') || url.includes('1080x1920') || idx === 1) {
        orientation = 'portrait';
        width = 1080;
        height = 1920;
      } else {
        orientation = 'landscape';
        width = 1920;
        height = 1080;
      }
    }

    images.push({
      url,
      width,
      height,
      orientation
    });
  });

  return {
    postUrl,
    title,
    date,
    tags,
    images
  };
}

// Build target save filepath based on options
function buildSavePath(options, post, image) {
  const urlParts = image.url.split('/');
  const rawFilename = urlParts[urlParts.length - 1]; // e.g. 3daed88345fd32f1829bd133a8d0ae5d.jpg
  const ext = path.extname(rawFilename) || '.jpg';
  const hash = path.basename(rawFilename, ext);
  const shortHash = hash.slice(0, 10);

  // Subfolder based on --organize
  let subDir = '';
  if (options.organize === 'orientation') {
    subDir = image.orientation === 'portrait' ? 'portrait' : 'landscape';
  } else if (options.organize === 'year') {
    const yearMatch = (post.date || '').match(/^(\d{4})/);
    subDir = yearMatch ? yearMatch[1] : 'unknown_year';
  }

  // Filename based on --naming
  let filename = '';
  if (options.naming === 'title') {
    const cleanTitle = sanitizeFilename(post.title || `spotlight_${post.postId || 'image'}`);
    const orientTag = image.orientation ? `_${image.orientation}` : '';
    filename = `${cleanTitle} - ${shortHash}${orientTag}${ext}`;
  } else if (options.naming === 'id') {
    const pId = post.postId || 'img';
    const orient = image.orientation || 'img';
    filename = `spotlight_${pId}_${orient}_${shortHash}${ext}`;
  } else {
    // 'hash'
    filename = rawFilename;
  }

  const targetDir = path.resolve(options.outputDir, subDir);
  return {
    dir: targetDir,
    filename,
    fullPath: path.join(targetDir, filename)
  };
}

// Download a single file atomically
async function downloadFile(url, targetPath) {
  const tempPath = `${targetPath}.part`;
  const res = await fetchWithRetry(url);

  if (!res.body) {
    throw new Error('Response body is null');
  }

  const fileStream = fs.createWriteStream(tempPath);
  let downloadedBytes = 0;

  // Stream readable web body to file stream
  const reader = res.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    fileStream.write(value);
    downloadedBytes += value.length;
  }

  await new Promise((resolve, reject) => {
    fileStream.end((err) => {
      if (err) reject(err);
      else resolve();
    });
  });

  // Atomic rename to final path
  fs.renameSync(tempPath, targetPath);
  return downloadedBytes;
}

// Simple asynchronous queue pool
async function asyncPool(limit, items, iteratorFn) {
  const executing = new Set();
  const results = [];

  for (const item of items) {
    const p = Promise.resolve().then(() => iteratorFn(item));
    results.push(p);
    executing.add(p);

    const clean = () => executing.delete(p);
    p.then(clean, clean);

    if (executing.size >= limit) {
      await Promise.race(executing);
    }
  }

  return Promise.all(results);
}

// Format byte sizes for human display
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

// Main execution
async function main() {
  const options = parseArgs();

  if (options.help) {
    showHelp();
    process.exit(0);
  }

  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║               VisualVault - Spotlight Wallpaper Tool             ║
╚══════════════════════════════════════════════════════════════════╝`);

  // Detect total pages if not specified
  if (!options.endPage) {
    process.stdout.write('🔍 Checking total available pages on windows10spotlight.com... ');
    options.endPage = await detectTotalPages();
    console.log(`Found ${options.endPage} pages.`);
  }

  // Ensure endPage >= startPage
  if (options.endPage < options.startPage) {
    options.endPage = options.startPage;
  }

  // Ensure output directory exists
  if (!options.dryRun) {
    fs.mkdirSync(options.outputDir, { recursive: true });
    if (options.organize === 'orientation') {
      fs.mkdirSync(path.join(options.outputDir, 'landscape'), { recursive: true });
      fs.mkdirSync(path.join(options.outputDir, 'portrait'), { recursive: true });
    }
  }

  const statePath = path.join(options.outputDir, 'vault_state.json');
  const state = new VaultState(statePath);

  console.log(`\n⚙️  Configuration:`);
  console.log(`   • Page Range:     Page ${options.startPage} → ${options.endPage} (${options.endPage - options.startPage + 1} pages)`);
  console.log(`   • Mode:           ${options.mode.toUpperCase()} (${options.mode === 'fast' ? 'Landscape-only from listing' : 'All full-res images from post pages'})`);
  console.log(`   • Orientation:    ${options.orientation}`);
  console.log(`   • Concurrency:    ${options.concurrency} worker(s)`);
  console.log(`   • Organize:       ${options.organize}`);
  console.log(`   • Naming:         ${options.naming}`);
  console.log(`   • Output Dir:     ${path.resolve(options.outputDir)}`);
  if (options.dryRun) console.log(`   • Mode:           DRY RUN (no files will be written)`);

  const startTime = Date.now();
  let stats = {
    pagesCrawled: 0,
    postsFound: 0,
    imagesFound: 0,
    imagesDownloaded: 0,
    imagesSkipped: 0,
    bytesDownloaded: 0,
    errors: 0
  };

  const pagesToCrawl = [];
  for (let p = options.startPage; p <= options.endPage; p++) {
    pagesToCrawl.push(p);
  }

  console.log(`\n🚀 Starting crawler...\n`);

  for (const pageNum of pagesToCrawl) {
    const pageUrl = pageNum === 1 ? `${BASE_URL}/` : `${BASE_URL}/page/${pageNum}`;
    process.stdout.write(`\n📄 [Page ${pageNum}/${options.endPage}] Crawling ${pageUrl}... `);

    let listingHtml = '';
    try {
      const res = await fetchWithRetry(pageUrl);
      listingHtml = await res.text();
    } catch (err) {
      console.log(`❌ Failed to fetch page ${pageNum}: ${err.message}`);
      stats.errors++;
      continue;
    }

    const posts = parseListingPage(listingHtml);
    stats.pagesCrawled++;
    stats.postsFound += posts.length;
    console.log(`Found ${posts.length} wallpaper posts.`);

    if (posts.length === 0) continue;

    // Process posts on this page
    if (options.mode === 'fast') {
      // Fast mode: download directly from listing srcset
      const downloadTasks = [];
      for (const post of posts) {
        if (!post.fastLandscapeUrl) continue;
        if (options.orientation === 'portrait') continue; // fast mode only has landscape

        const imageObj = {
          url: post.fastLandscapeUrl,
          orientation: 'landscape',
          width: 1920,
          height: 1080
        };

        downloadTasks.push({ post, image: imageObj });
      }

      stats.imagesFound += downloadTasks.length;

      await asyncPool(options.concurrency, downloadTasks, async ({ post, image }) => {
        await handleImageDownload(options, state, post, image, stats);
      });

    } else {
      // Deep mode: fetch each post page to discover all orientations and resolutions
      for (const post of posts) {
        let postData;
        try {
          if (options.delay > 0) await sleep(options.delay);
          postData = await parsePostPage(post.postUrl);
        } catch (err) {
          console.warn(`   ⚠️  Could not read post ${post.postUrl}: ${err.message}`);
          stats.errors++;
          continue;
        }

        let images = postData.images || [];

        // Filter by orientation
        if (options.orientation !== 'all') {
          images = images.filter(img => img.orientation === options.orientation);
        }

        stats.imagesFound += images.length;

        // Download discovered images
        for (const image of images) {
          await handleImageDownload(options, state, postData, image, stats);
        }
      }
    }

    state.markPageCompleted(pageNum);
    if (!options.dryRun) {
      state.save();
    }
  }

  // Final Summary
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n` + '═'.repeat(66));
  console.log(`🎉 Crawl Completed in ${elapsed}s!`);
  console.log(`   • Pages Processed:     ${stats.pagesCrawled}`);
  console.log(`   • Posts Discovered:    ${stats.postsFound}`);
  console.log(`   • Total Images Found:  ${stats.imagesFound}`);
  console.log(`   • Downloaded:          ${stats.imagesDownloaded} (${formatBytes(stats.bytesDownloaded)})`);
  console.log(`   • Skipped (Existed):   ${stats.imagesSkipped}`);
  console.log(`   • Errors:              ${stats.errors}`);
  console.log(`   • Wallpapers saved to: ${path.resolve(options.outputDir)}`);
  if (options.saveMetadata && !options.dryRun) {
    const metaPath = path.join(options.outputDir, 'metadata.json');
    fs.writeFileSync(metaPath, JSON.stringify(state.data.metadata, null, 2), 'utf8');
    console.log(`   • Metadata saved to:   ${metaPath}`);
  }
  console.log('═'.repeat(66) + `\n`);
}

// Handle single image check & download
async function handleImageDownload(options, state, post, image, stats) {
  const { dir, filename, fullPath } = buildSavePath(options, post, image);

  // Check if already recorded in state or exists on disk
  if (state.isImageDownloaded(image.url) && fs.existsSync(fullPath)) {
    stats.imagesSkipped++;
    return;
  }

  if (fs.existsSync(fullPath)) {
    const existingStat = fs.statSync(fullPath);
    if (existingStat.size > 0) {
      stats.imagesSkipped++;
      state.recordDownloadedImage(image.url, {
        path: fullPath,
        size: existingStat.size,
        date: new Date().toISOString()
      });
      return;
    }
  }

  if (options.dryRun) {
    console.log(`   [DRY RUN] Would download: ${filename} (${image.orientation})`);
    stats.imagesDownloaded++;
    return;
  }

  fs.mkdirSync(dir, { recursive: true });

  try {
    process.stdout.write(`   ⬇️  Downloading: ${filename.slice(0, 45).padEnd(45)} [${image.orientation}]... `);
    const bytes = await downloadFile(image.url, fullPath);
    stats.imagesDownloaded++;
    stats.bytesDownloaded += bytes;
    console.log(`✓ (${formatBytes(bytes)})`);

    const meta = {
      title: post.title,
      postId: post.postId,
      postUrl: post.postUrl,
      date: post.date,
      tags: post.tags || [],
      orientation: image.orientation,
      width: image.width,
      height: image.height,
      sourceUrl: image.url,
      localFile: path.relative(options.outputDir, fullPath),
      sizeBytes: bytes,
      downloadedAt: new Date().toISOString()
    };

    state.recordDownloadedImage(image.url, {
      path: fullPath,
      size: bytes,
      date: meta.downloadedAt,
      metadata: meta
    });

  } catch (err) {
    console.log(`❌ Failed: ${err.message}`);
    stats.errors++;
  }
}

main().catch(err => {
  console.error('\nFatal Error:', err);
  process.exit(1);
});
