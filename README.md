# VisualVault 📸

> A high-performance, resilient, and resumable crawler & downloader for **[Windows 10 Spotlight Images](https://windows10spotlight.com/)**.

Windows 10 Spotlight features thousands of stunning landscape and portrait wallpapers from all around the world. **VisualVault** crawls all **1,330+ pages** (over **6,600+ wallpaper posts** and **13,000+ full-resolution image files**) and saves them locally, properly categorized and titled.

---

## ✨ Highlights

- **Full-Resolution Originals**: Downloads true 1920×1080 (desktop landscape) and 1080×1920 (mobile portrait) original images.
- **Auto-Detection of Total Pages**: Queries the website on startup to automatically discover the latest total page count (currently 1,330+ pages and growing).
- **Two Crawler Modes**:
  - `deep` *(default)*: Visits each individual wallpaper page to download both landscape and portrait orientations, plus rich tags and metadata.
  - `fast`: Grabs 1920×1080 landscape wallpapers directly from listing pages with minimal requests.
- **Smart Folder Organization**:
  - Automatically splits wallpapers into `landscape/` and `portrait/` folders (or by `year`, or `flat`).
- **Clean, Descriptive File Naming**:
  - Names files with actual location titles (e.g., `Milky way and Aurora Borealis Banff - 3daed88_landscape.jpg`), sanitized for Windows/macOS/Linux.
- **Resumable & Crash-Safe**:
  - Tracks state in `vault_state.json`. You can stop with `Ctrl+C` at any time and resume later without re-downloading previously saved files.
- **Atomic Downloads**:
  - Files stream into `.part` temporary files and atomically rename upon completion, ensuring no partial or corrupted image files.
- **Metadata Export**:
  - Generates `metadata.json` containing titles, dates, tags, dimensions, and URLs.
- **Zero External Dependencies**:
  - Works directly using modern Node.js (`node visualvault.js`) or Python (`python visualvault.py`) standard library—no `npm install` or `pip install` required!

---

## 🚀 Quick Start

### 1. Download Latest Pages (Recommended First Run)
```bash
# Downloads pages 1 to 5 (around 50 full-res wallpapers)
node visualvault.js -p 1-5
```

### 2. Fast Download of Landscape Desktop Wallpapers
```bash
# Fast-crawls pages 1 to 20 for landscape wallpapers with 8 concurrent workers
node visualvault.js -p 1-20 --mode fast -c 8
```

### 3. Download All Wallpapers (Entire Archive: 1,330+ Pages)
```bash
# Crawls the entire site and saves all wallpapers to ./spotlight_images
node visualvault.js
```

*(You can also use Python if preferred: `python visualvault.py -p 1-5`)*

---

## 🛠️ CLI Options

| Flag | Long Option | Default | Description |
|---|---|---|---|
| `-p` | `--pages` | - | Page range to crawl (e.g., `1-10`, `1-50`, or `5` for first 5) |
| `-s` | `--start-page` | `1` | Starting page number |
| `-e` | `--end-page` | *Auto* | Ending page number (auto-detected, currently ~`1330`) |
| `-c` | `--concurrency` | `5` | Concurrent downloads / workers (1 to 20) |
| `-o` | `--output` | `./spotlight_images` | Destination folder for images |
| `-m` | `--mode` | `deep` | `deep` (all orientations & metadata) or `fast` (landscape only) |
| | `--orientation` | `all` | Filter orientations: `all`, `landscape`, or `portrait` |
| | `--organize` | `orientation` | Folder scheme: `orientation`, `year`, or `flat` |
| | `--naming` | `title` | Naming style: `title`, `hash`, or `id` |
| | `--delay` | `150` | Polite delay between requests in milliseconds |
| | `--no-metadata` | `false` | Disable generating `metadata.json` |
| | `--dry-run` | `false` | Simulate the crawl without downloading any files |
| `-h` | `--help` | - | Display help screen |

---

## 💡 Practical Recipes

### Only Desktop (Landscape) Wallpapers
```bash
node visualvault.js --orientation landscape -o ./desktop_wallpapers
```

### Only Mobile (Portrait) Wallpapers
```bash
node visualvault.js --orientation portrait -o ./phone_wallpapers
```

### Organize by Year
```bash
node visualvault.js -p 1-20 --organize year
```

### Dry Run (Preview URLs and Titles Without Saving)
```bash
node visualvault.js -p 1 --dry-run
```

---

## 📂 Output Folder Structure

When running with default settings (`--organize orientation`), your files will be arranged like this:

```
spotlight_images/
├── landscape/
│   ├── Milky way and Aurora Borealis taken at Two Jack Lake, Banff - 3daed88345_landscape.jpg
│   ├── A view of Cala Goloritze cove beach in Baunei - eae935ca42_landscape.jpg
│   └── ...
├── portrait/
│   ├── Milky way and Aurora Borealis taken at Two Jack Lake, Banff - feb95c06e7_portrait.jpg
│   ├── A view of Cala Goloritze cove beach in Baunei - 5067c3eb7b_portrait.jpg
│   └── ...
├── metadata.json       # Searchable catalog with titles, tags, resolutions, and links
└── vault_state.json    # Resumable progress tracking state
```

---

## 📜 Metadata JSON Structure

The generated `metadata.json` makes it easy to search, sort, or build your own custom wallpaper rotation script:

```json
[
  {
    "title": "Milky way and Aurora Borealis taken at Two Jack Lake, Banff National Park, Alberta, Canada",
    "postId": "42389",
    "postUrl": "https://windows10spotlight.com/images/42389",
    "date": "2026-11-24",
    "tags": ["Alberta", "aurora borealis", "Canada", "forest", "Milky Way", "lake", "night"],
    "orientation": "landscape",
    "width": 1920,
    "height": 1080,
    "sourceUrl": "https://windows10spotlight.com/wp-content/uploads/2026/11/3daed88345fd32f1829bd133a8d0ae5d.jpg",
    "localFile": "landscape\\Milky way and Aurora Borealis... - 3daed88345_landscape.jpg",
    "sizeBytes": 403503,
    "downloadedAt": "2026-11-24T13:09:47.382Z"
  }
]
```

---

## 🛡️ License

MIT License. Images downloaded remain copyright of their respective photographers / Microsoft Windows Spotlight.
