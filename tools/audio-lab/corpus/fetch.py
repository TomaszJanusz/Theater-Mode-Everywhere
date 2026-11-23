"""Download and verify the external audio excerpts in a cache outside the repository."""
import argparse
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import wave
from pathlib import Path


CORPUS = Path(__file__).resolve().parent
REPO = CORPUS.parents[2]
DEFAULT_CACHE = Path(os.environ.get("XDG_CACHE_HOME") or Path.home() / ".cache") / "theater-everywhere/audio-lab"
FORMAT = "bestaudio[format_id~='^251(-|$)'][language^=en]"


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def extract(ffmpeg, media, out, start, duration):
    # Seek after opening (decode from the original timeline). Use the standard
    # library WAV header so FFmpeg metadata and build strings do not affect SHA.
    pcm = subprocess.check_output([
        ffmpeg, "-v", "error", "-i", str(media), "-ss", str(start),
        "-t", str(duration), "-map", "0:a:0", "-ar", "48000", "-ac", "2",
        "-c:a", "pcm_s16le", "-f", "s16le", "pipe:1",
    ])
    if len(pcm) != round(duration * 48_000) * 4:
        raise ValueError(f"{out.name}: excerpt ended before its expected duration")
    with wave.open(str(out), "wb") as wav:
        wav.setparams((2, 2, 48000, 0, "NONE", ""))
        wav.writeframes(pcm)


def bundled_ffmpeg():
    try:
        from imageio_ffmpeg import get_ffmpeg_exe
    except ImportError as error:
        raise ValueError("Install imageio-ffmpeg or provide --ffmpeg") from error
    return get_ffmpeg_exe()


def fetch(args):
    cache = args.cache_dir.expanduser().resolve()
    if cache.is_relative_to(REPO):
        raise ValueError("Choose a cache directory outside this checkout")
    entries = json.loads((CORPUS / "manifest.json").read_text())["entries"]
    picks = [entry for entry in entries if entry["kind"] == "external"]
    if args.id:
        picks = [entry for entry in picks if entry["id"] == args.id]
        if not picks:
            raise ValueError(f"Unknown external corpus id: {args.id}")
    cache.mkdir(parents=True, exist_ok=True)
    downloads = {}
    for entry in picks:
        out = cache / entry["file"]
        if not out.is_file() or digest(out) != entry["sha256"]:
            downloads.setdefault(entry["source"], []).append(entry)
    if downloads:
        download(args, cache, downloads)
    for entry in picks:
        print(cache / entry["file"])


def download(args, cache, downloads):
    ffmpeg = args.ffmpeg or bundled_ffmpeg()
    yt_dlp = [args.yt_dlp] if args.yt_dlp else [sys.executable, "-m", "yt_dlp"]
    with tempfile.TemporaryDirectory(prefix="fetch-", dir=cache) as work:
        work = Path(work)
        for source, pending in downloads.items():
            media = work / "source.webm"
            subprocess.run([
                *yt_dlp, "--ignore-config", "--js-runtimes", "node",
                "--no-remote-components", "--no-playlist",
                "--no-progress", "-f", FORMAT, "-o", str(media), source,
            ], check=True)
            for entry in pending:
                clip = work / entry["file"]
                extract(ffmpeg, media, clip, entry["start"], entry["duration"])
                actual = digest(clip)
                if actual != entry["sha256"]:
                    raise ValueError(f"{entry['id']}: SHA-256 mismatch ({actual}); check source and FFmpeg version")
                clip.replace(cache / entry["file"])
            media.unlink()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("id", nargs="?", help="external corpus id (default: all)")
    parser.add_argument("--cache-dir", type=Path, default=DEFAULT_CACHE)
    parser.add_argument("--yt-dlp", help="yt-dlp executable (default: Python module)")
    parser.add_argument("--ffmpeg", help="FFmpeg executable (default: imageio-ffmpeg binary)")
    args = parser.parse_args()
    try:
        fetch(args)
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        parser.exit(1, f"audio lab corpus: {error}\n")
