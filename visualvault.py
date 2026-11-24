#!/usr/bin/env python3
"""
VisualVault - Windows 10 Spotlight Wallpaper Crawler & Downloader (Python Edition)

High-performance, resumable crawler that downloads full-resolution
landscape & portrait wallpapers from https://windows10spotlight.com/
Requires only standard library (no pip dependencies).
"""

import argparse
import concurrent.futures
import json
import math
import os
import re
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path

BASE_URL = "https://windows10spotlight.com"
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"


def sanitize_filename(name: str) -> str:
    """Sanitize string for Windows/macOS/Linux filesystem."""
    cleaned = re.sub(r'[<>:"/\\|?*\x00-\x1F]', "", name)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned[:100]


def format_bytes(size_bytes: int) -> str:
    """Format bytes to human readable string."""
    if size_bytes == 0:
        return "0 B"
    units = ["B", "KB", "MB", "GB", "TB"]
    i = int(math.floor(math.log(size_bytes, 1024)))
    p = math.pow(1024, i)
    s = round(size_bytes / p, 2)
    return f"{s} {units[i]}"


def fetch_url(url: str, max_retries: int = 3, delay: float = 1.0) -> str:
    """Fetch URL with retries and exponential backoff."""
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/*,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
        },
    )

    for attempt in range(1, max_retries + 1):
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return resp.read().decode("utf-8", errors="replace")
        except urllib.error.HTTPError as e:
            if e.code in (429, 503) and attempt < max_retries:
                wait = delay * (2 ** (attempt - 1))
                time.sleep(wait)
                continue
            raise
        except Exception:
            if attempt < max_retries:
                wait = delay * (2 ** (attempt - 1))
                time.sleep(wait)
                continue
            raise


def download_image_file(url: str, dest_path: str, max_retries: int = 3) -> int:
    """Stream download image to a temporary file then atomically replace target."""
    temp_path = f"{dest_path}.part"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})

    for attempt in range(1, max_retries + 1):
        try:
            downloaded = 0
            with urllib.request.urlopen(req, timeout=30) as resp, open(temp_path, "wb") as f:
                while True:
                    chunk = resp.read(64 * 1024)
                    if not chunk:
                        break
                    f.write(chunk)
                    downloaded += len(chunk)

            # Atomic rename
            if os.path.exists(dest_path):
                os.remove(dest_path)
            os.rename(temp_path, dest_path)
            return downloaded
        except Exception:
            if os.path.exists(temp_path):
                try:
                    os.remove(temp_path)
                except OSError:
                    pass
            if attempt < max_retries:
                time.sleep(1.0 * attempt)
                continue
            raise


def detect_total_pages() -> int:
    """Detect the total number of pages from homepage pagination."""
    try:
        html = fetch_url(BASE_URL)
        matches = [int(m) for m in re.findall(r"/page/(\d+)", html)]
        if matches:
            return max(matches)
    except Exception:
        pass
    return 1330


def parse_listing_page(html: str):
    """Parse article items from listing page."""
    articles = re.findall(r"<article[\s\S]*?</article>", html, re.IGNORECASE)
    posts = []

    for art in articles:
        id_m = re.search(r"post-(\d+)", art, re.IGNORECASE)
        post_id = id_m.group(1) if id_m else None

        url_m = re.search(r'<a\s+[^>]*href=["\'](https://windows10spotlight\.com/images/\d+)["\']', art, re.IGNORECASE)
        post_url = url_m.group(1) if url_m else (f"{BASE_URL}/images/{post_id}" if post_id else None)

        title_m = re.search(r'<span class="entry-title hidden">([\s\S]*?)</span>', art, re.IGNORECASE) or \
                  re.search(r'title=["\']([\s\S]*?)["\']', art, re.IGNORECASE)
        title = re.sub(r"<[^>]+>", "", title_m.group(1)).strip() if title_m else f"Spotlight Image {post_id or ''}"

        date_m = re.search(r'<span class="date">([\s\S]*?)</span>', art, re.IGNORECASE)
        date = date_m.group(1).strip() if date_m else ""

        fast_landscape = None
        srcset_m = re.search(r'srcset=["\']([^"\']+)["\']', art, re.IGNORECASE)
        if srcset_m:
            parts = [s.strip().split() for s in srcset_m.group(1).split(",")]
            for p in parts:
                if len(p) > 1 and p[1] == "1920w":
                    fast_landscape = p[0]
                    break
            if not fast_landscape and parts and parts[-1]:
                fast_landscape = parts[-1][0]

        if post_url:
            posts.append({
                "postId": post_id,
                "postUrl": post_url,
                "title": title,
                "date": date,
                "fastLandscapeUrl": fast_landscape,
            })

    return posts


def parse_post_page(post_url: str):
    """Fetch and parse post page for all image URLs and resolutions."""
    html = fetch_url(post_url)

    title_m = re.search(r"<h1[^>]*>([\s\S]*?)</h1>", html, re.IGNORECASE)
    title = re.sub(r"<[^>]+>", "", title_m.group(1)).strip() if title_m else ""

    date_m = re.search(r'<span class="date">([\s\S]*?)</span>', html, re.IGNORECASE)
    date = date_m.group(1).strip() if date_m else ""

    tags_m = re.search(r"<aside class=\"meta\">Tags:([\s\S]*?)</aside>", html, re.IGNORECASE)
    tags = [m.strip() for m in re.findall(r"<a[^>]+>([\s\S]*?)</a>", tags_m.group(1), re.IGNORECASE)] if tags_m else []

    hrefs = re.findall(r'href=["\'](https://windows10spotlight\.com/wp-content/uploads/[^"\']+\.(?:jpe?g|png|webp))["\']', html, re.IGNORECASE)
    unique_hrefs = list(dict.fromkeys(hrefs))

    resolutions = [
        {"width": int(w), "height": int(h)}
        for w, h in re.findall(r"<pre>(\d+)\*(\d+)", html, re.IGNORECASE)
    ]

    images = []
    for idx, u in enumerate(unique_hrefs):
        width = None
        height = None
        orientation = "unknown"

        if idx < len(resolutions):
            width = resolutions[idx]["width"]
            height = resolutions[idx]["height"]
            orientation = "landscape" if width >= height else "portrait"
        else:
            if "576x1024" in u or "1080x1920" in u or idx == 1:
                orientation = "portrait"
                width, height = 1080, 1920
            else:
                orientation = "landscape"
                width, height = 1920, 1080

        images.append({
            "url": u,
            "width": width,
            "height": height,
            "orientation": orientation,
        })

    return {
        "postUrl": post_url,
        "title": title,
        "date": date,
        "tags": tags,
        "images": images,
    }


def build_save_path(output_dir: str, organize: str, naming: str, post: dict, image: dict) -> tuple:
    """Build destination folder and filename."""
    url = image["url"]
    raw_filename = os.path.basename(urllib.parse.urlparse(url).path)
    base_name, ext = os.path.splitext(raw_filename)
    if not ext:
        ext = ".jpg"
    short_hash = base_name[:10]

    # Organize subfolder
    sub_dir = ""
    if organize == "orientation":
        sub_dir = "portrait" if image.get("orientation") == "portrait" else "landscape"
    elif organize == "year":
        year_m = re.match(r"^(\d{4})", post.get("date", ""))
        sub_dir = year_m.group(1) if year_m else "unknown_year"

    # Naming convention
    if naming == "title":
        clean_title = sanitize_filename(post.get("title") or f"spotlight_{post.get('postId', 'img')}")
        orient_tag = f"_{image.get('orientation')}" if image.get("orientation") else ""
        filename = f"{clean_title} - {short_hash}{orient_tag}{ext}"
    elif naming == "id":
        p_id = post.get("postId", "img")
        orient = image.get("orientation", "img")
        filename = f"spotlight_{p_id}_{orient}_{short_hash}{ext}"
    else:  # 'hash'
        filename = raw_filename

    target_dir = os.path.join(output_dir, sub_dir)
    return target_dir, filename, os.path.join(target_dir, filename)


class VaultState:
    def __init__(self, path_str: str):
        self.path = path_str
        self.data = {
            "completedPages": [],
            "downloadedUrls": {},
            "totalDownloadedBytes": 0,
            "metadata": []
        }
        self.load()

    def load(self):
        if os.path.exists(self.path):
            try:
                with open(self.path, "r", encoding="utf-8") as f:
                    self.data = json.load(f)
            except Exception:
                pass

    def save(self):
        try:
            with open(self.path, "w", encoding="utf-8") as f:
                json.dump(self.data, f, indent=2)
        except Exception:
            pass

    def is_downloaded(self, url: str) -> bool:
        return url in self.data["downloadedUrls"]

    def record(self, url: str, info: dict):
        self.data["downloadedUrls"][url] = info
        if "size" in info:
            self.data["totalDownloadedBytes"] += info["size"]
        if "metadata" in info:
            self.data["metadata"].append(info["metadata"])


def main():
    parser = argparse.ArgumentParser(
        description="VisualVault - Windows Spotlight Wallpaper Crawler & Downloader",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python visualvault.py -p 1-5
  python visualvault.py -p 1-20 --mode fast -c 8
  python visualvault.py --orientation portrait
  python visualvault.py
        """
    )
    parser.add_argument("-p", "--pages", type=str, help="Page range (e.g. 1-10 or 5)")
    parser.add_argument("-s", "--start-page", type=int, default=1, help="Start page (default: 1)")
    parser.add_argument("-e", "--end-page", type=int, default=None, help="End page (default: auto-detected)")
    parser.add_argument("-c", "--concurrency", type=int, default=5, help="Concurrent downloads (1-20, default: 5)")
    parser.add_argument("-o", "--output", type=str, default="./spotlight_images", help="Output directory")
    parser.add_argument("-m", "--mode", choices=["deep", "fast"], default="deep", help="Mode: deep (all images) or fast (landscape only)")
    parser.add_argument("--orientation", choices=["all", "landscape", "portrait"], default="all", help="Filter orientation")
    parser.add_argument("--organize", choices=["orientation", "year", "flat"], default="orientation", help="Folder organization")
    parser.add_argument("--naming", choices=["title", "hash", "id"], default="title", help="File naming style")
    parser.add_argument("--delay", type=float, default=0.15, help="Polite delay between post requests in seconds")
    parser.add_argument("--no-metadata", action="store_true", help="Do not save metadata.json")
    parser.add_argument("--dry-run", action="store_true", help="Dry run without downloading")

    args = parser.parse_args()

    start_page = max(1, args.start_page)
    end_page = args.end_page

    if args.pages:
        if "-" in args.pages:
            s, e = args.pages.split("-", 1)
            start_page = max(1, int(s))
            end_page = max(1, int(e))
        else:
            start_page = 1
            end_page = max(1, int(args.pages))

    print("""
╔══════════════════════════════════════════════════════════════════╗
║               VisualVault - Spotlight Wallpaper Tool             ║
╚══════════════════════════════════════════════════════════════════╝""")

    if not end_page:
        print("🔍 Checking total available pages on windows10spotlight.com...", end=" ", flush=True)
        end_page = detect_total_pages()
        print(f"Found {end_page} pages.")

    if end_page < start_page:
        end_page = start_page

    if not args.dry_run:
        os.makedirs(args.output, exist_ok=True)
        if args.organize == "orientation":
            os.makedirs(os.path.join(args.output, "landscape"), exist_ok=True)
            os.makedirs(os.path.join(args.output, "portrait"), exist_ok=True)

    state = VaultState(os.path.join(args.output, "vault_state.json"))

    print(f"\n⚙️  Configuration:")
    print(f"   • Page Range:     Page {start_page} → {end_page} ({end_page - start_page + 1} pages)")
    print(f"   • Mode:           {args.mode.upper()} ({'Landscape-only fast listing crawl' if args.mode == 'fast' else 'Deep crawl of post pages'})")
    print(f"   • Orientation:    {args.orientation}")
    print(f"   • Concurrency:    {args.concurrency} worker(s)")
    print(f"   • Organize:       {args.organize}")
    print(f"   • Naming:         {args.naming}")
    print(f"   • Output Dir:     {os.path.abspath(args.output)}")
    if args.dry_run:
        print("   • Mode:           DRY RUN (no files downloaded)")

    print("\n🚀 Starting crawler...\n")

    stats = {
        "pages": 0,
        "posts": 0,
        "images_found": 0,
        "downloaded": 0,
        "skipped": 0,
        "bytes": 0,
        "errors": 0,
    }
    start_time = time.time()

    for page_num in range(start_page, end_page + 1):
        page_url = f"{BASE_URL}/" if page_num == 1 else f"{BASE_URL}/page/{page_num}"
        print(f"\n📄 [Page {page_num}/{end_page}] Crawling {page_url}...", end=" ", flush=True)

        try:
            listing_html = fetch_url(page_url)
        except Exception as e:
            print(f"❌ Failed: {e}")
            stats["errors"] += 1
            continue

        posts = parse_listing_page(listing_html)
        stats["pages"] += 1
        stats["posts"] += len(posts)
        print(f"Found {len(posts)} wallpaper posts.")

        if not posts:
            continue

        if args.mode == "fast":
            # Fast mode: download directly
            tasks = []
            for post in posts:
                if not post["fastLandscapeUrl"]:
                    continue
                if args.orientation == "portrait":
                    continue
                img_obj = {
                    "url": post["fastLandscapeUrl"],
                    "orientation": "landscape",
                    "width": 1920,
                    "height": 1080,
                }
                tasks.append((post, img_obj))

            stats["images_found"] += len(tasks)

            def worker(item):
                p, img = item
                handle_download(args, state, p, img, stats)

            with concurrent.futures.ThreadPoolExecutor(max_workers=args.concurrency) as executor:
                list(executor.map(worker, tasks))

        else:
            # Deep mode: inspect post pages
            for post in posts:
                try:
                    if args.delay > 0:
                        time.sleep(args.delay)
                    post_data = parse_post_page(post["postUrl"])
                except Exception as e:
                    print(f"   ⚠️ Could not read post {post['postUrl']}: {e}")
                    stats["errors"] += 1
                    continue

                images = post_data.get("images", [])
                if args.orientation != "all":
                    images = [img for img in images if img.get("orientation") == args.orientation]

                stats["images_found"] += len(images)

                for img in images:
                    handle_download(args, state, post_data, img, stats)

        if not args.dry_run:
            state.save()

    elapsed = round(time.time() - start_time, 1)
    print("\n" + "═" * 66)
    print(f"🎉 Crawl Completed in {elapsed}s!")
    print(f"   • Pages Processed:     {stats['pages']}")
    print(f"   • Posts Discovered:    {stats['posts']}")
    print(f"   • Total Images Found:  {stats['images_found']}")
    print(f"   • Downloaded:          {stats['downloaded']} ({format_bytes(stats['bytes'])})")
    print(f"   • Skipped (Existed):   {stats['skipped']}")
    print(f"   • Errors:              {stats['errors']}")
    print(f"   • Output Directory:    {os.path.abspath(args.output)}")
    if not args.no_metadata and not args.dry_run:
        meta_path = os.path.join(args.output, "metadata.json")
        try:
            with open(meta_path, "w", encoding="utf-8") as f:
                json.dump(state.data["metadata"], f, indent=2)
            print(f"   • Metadata saved to:   {meta_path}")
        except Exception:
            pass
    print("═" * 66 + "\n")


def handle_download(args, state: VaultState, post: dict, image: dict, stats: dict):
    target_dir, filename, full_path = build_save_path(args.output, args.organize, args.naming, post, image)

    url = image["url"]
    if state.is_downloaded(url) and os.path.exists(full_path):
        stats["skipped"] += 1
        return

    if os.path.exists(full_path) and os.path.getsize(full_path) > 0:
        stats["skipped"] += 1
        state.record(url, {"path": full_path, "size": os.path.getsize(full_path)})
        return

    if args.dry_run:
        print(f"   [DRY RUN] Would download: {filename} ({image.get('orientation')})")
        stats["downloaded"] += 1
        return

    os.makedirs(target_dir, exist_ok=True)

    try:
        short_name = (filename[:45] + "...").ljust(48)
        print(f"   ⬇️  Downloading: {short_name} [{image.get('orientation')}]...", end=" ", flush=True)
        bytes_down = download_image_file(url, full_path)
        stats["downloaded"] += 1
        stats["bytes"] += bytes_down
        print(f"✓ ({format_bytes(bytes_down)})")

        meta = {
            "title": post.get("title"),
            "postId": post.get("postId"),
            "postUrl": post.get("postUrl"),
            "date": post.get("date"),
            "tags": post.get("tags", []),
            "orientation": image.get("orientation"),
            "width": image.get("width"),
            "height": image.get("height"),
            "sourceUrl": url,
            "localFile": os.path.relpath(full_path, args.output),
            "sizeBytes": bytes_down,
            "downloadedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }

        state.record(url, {
            "path": full_path,
            "size": bytes_down,
            "metadata": meta,
        })

    except Exception as e:
        print(f"❌ Failed: {e}")
        stats["errors"] += 1


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\n⏹️  Operation paused by user. Progress is saved and can be resumed anytime!")
        sys.exit(0)
