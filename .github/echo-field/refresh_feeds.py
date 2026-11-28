"""Refresh only public RSS metadata. Existing snapshots survive rolling feeds and outages."""
import argparse
import datetime as dt
import email.utils
import hashlib
import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import urljoin, urlparse
from xml.etree import ElementTree

import requests

BLOG = Path(__file__).resolve().parents[3]
DEFAULT = BLOG / "source/toolbox/echo-field/data"
IT = "{http://www.itunes.com/dtds/podcast-1.0.dtd}"
TRANSCRIPTS = "{https://podcastindex.org/namespace/1.0}transcript"


def secure(url, base):
    if not url:
        return ""
    parsed = urlparse(urljoin(base, url.strip()))
    return parsed.geturl() if parsed.scheme == "https" and parsed.hostname else ""


def seconds(value):
    try:
        total = 0
        for part in value.split(":"):
            total = total * 60 + int(float(part))
        return max(0, total)
    except (ValueError, OverflowError):
        return 0


def snapshot(category, source):
    feed, home = source[4:]
    request = requests.get(feed, timeout=45, stream=True)
    with request as response:
        response.raise_for_status()
        chunks = bytearray()
        for chunk in response.iter_content(65536):
            chunks.extend(chunk)
            if len(chunks) > 32 * 1024 * 1024:
                break
        xml = bytes(chunks)
    if len(xml) > 32 * 1024 * 1024:
        raise ValueError("RSS exceeded size limit")
    channel = ElementTree.fromstring(xml).find("channel")
    items = []
    for item in channel.findall("item"):
        file = item.find("enclosure")
        media = secure(file.get("url"), feed) if file is not None else ""
        title = " ".join(item.findtext("title", "").split())
        if not media or not title or item.findtext(IT + "episodeType") == "trailer":
            continue
        guid = (item.findtext("guid") or media).strip()
        key = hashlib.sha256(guid.encode()).hexdigest()[:24]
        try:
            date = email.utils.parsedate_to_datetime(item.findtext("pubDate")).date().isoformat()
        except (TypeError, ValueError):
            date = ""
        tracks = []
        for track in item.findall(TRANSCRIPTS):
            link = secure(track.get("url"), feed)
            if link:
                tracks.append({"url": link, "type": track.get("type", ""), "lang": track.get("language", "en")})
        episode_page = secure(item.findtext("link"), home)
        items.append({
            "id": category + "-" + key, "cat": category, "title": title,
            "source": source[3], "audio": media, "date": date, "kind": "podcast",
            "url": episode_page or home,
            "transcript": "",
            "tracks": tracks,
            "explicit": item.findtext(IT + "explicit", "").strip().lower() in {"yes", "true", "explicit"},
            "duration": seconds(item.findtext(IT + "duration", "")),
        })
    if not items:
        raise ValueError("RSS provided no HTTPS audio enclosures")
    return items


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", type=Path, default=DEFAULT)
    parser.add_argument("--category", choices=("food", "travel", "news", "tech", "history", "film"))
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    file = args.output or args.data / "podcasts.json"
    previous = json.loads(file.read_text(encoding="utf-8")) if file.exists() else {"items": [], "feeds": {}}
    merged = {item["id"]: item for item in previous["items"]}
    state = previous.get("feeds", {})
    sources = json.loads((args.data / "sources.json").read_text(encoding="utf-8"))
    extra = {"news-npr": ["NPR Up First", "https://feeds.npr.org/510318/podcast.xml", "https://www.npr.org/podcasts/510318/up-first"], "tech-voa": ["VOA Science & Technology", "https://learningenglish.voanews.com/podcast/?count=250&zoneId=1579", "https://learningenglish.voanews.com/podcasts"]}
    sources.update({key: [*sources[key.split('-')[0]][:3], *value] for key, value in extra.items()})
    if args.category:
        sources = {key: source for key, source in sources.items() if key.split("-")[0] == args.category}
    updated = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    successes = 0
    with ThreadPoolExecutor(max_workers=6) as pool:
        pending = {category: pool.submit(snapshot, category.split("-")[0], source) for category, source in sources.items()}
        for category, job in pending.items():
            try:
                items = job.result()
            except Exception as error:
                print(f"{category}: {error}; retained previous entries")
                continue
            merged.update((item["id"], item) for item in items)
            state[category] = {"at": updated, "feedCount": len(items)}
            successes += 1
            print(f"{category}: {len(items)} feed entries")
    if not successes:
        raise SystemExit("All feeds failed, snapshot unchanged")
    items = sorted(merged.values(), key=lambda item: (item["date"], item["id"]), reverse=True)
    tmp = file.with_suffix(".tmp")
    tmp.write_text(json.dumps({"feeds": state, "items": items}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    tmp.replace(file)


if __name__ == "__main__":
    main()
