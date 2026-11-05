#!/usr/bin/env python3
"""
WhatsApp iOS Voice Notes & Audio Extractor
Extracts voice notes (.opus, .m4a) from unencrypted local iPhone backups using Manifest.db.
"""

import argparse
import glob
import os
import shutil
import sqlite3
import subprocess
import sys

BACKUP_BASE = os.path.expanduser("~/Library/Application Support/MobileSync/Backup")


def find_latest_backup():
    """Finds the most recent backup folder in MobileSync."""
    if not os.path.isdir(BACKUP_BASE):
        return None
    try:
        all_backups = [
            f for f in glob.glob(os.path.join(BACKUP_BASE, "*"))
            if os.path.isdir(f)
        ]
        if not all_backups:
            return None
        return max(all_backups, key=os.path.getmtime)
    except PermissionError:
        print("[!] Warning: Permission denied accessing MobileSync directory.")
        print("    Grant 'Full Disk Access' to Terminal in macOS System Settings,")
        print("    or copy Manifest.db into this directory.")
        return None


def get_manifest_path(backup_dir):
    """Checks for Manifest.db locally or inside the backup folder."""
    if os.path.isfile("Manifest.db"):
        return os.path.abspath("Manifest.db")
    if backup_dir and os.path.isfile(os.path.join(backup_dir, "Manifest.db")):
        return os.path.join(backup_dir, "Manifest.db")
    return None


def build_media_metadata_cache(chat_db_path):
    """
    If ChatStorage.sqlite is available, maps audio filenames to metadata
    (chat name, date, sender) to provide readable file names.
    """
    if not chat_db_path or not os.path.isfile(chat_db_path):
        return {}

    try:
        conn = sqlite3.connect(f"file:{os.path.abspath(chat_db_path)}?mode=ro", uri=True)
        cursor = conn.cursor()

        # Check if ZWAMEDIAITEM table exists
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='ZWAMEDIAITEM';")
        if not cursor.fetchone():
            conn.close()
            return {}

        query = """
        SELECT 
            m.ZMEDIALOCALPATH,
            datetime(msg.ZMESSAGEDATE + 978307200, 'unixepoch', 'localtime') AS msg_date,
            COALESCE(s.ZPARTNERNAME, s.ZCONTACTJID, 'Unknown') AS chat_name,
            CASE 
                WHEN msg.ZISFROMME = 1 THEN 'Me'
                WHEN msg.ZFROMJID IS NOT NULL AND msg.ZFROMJID != '' THEN msg.ZFROMJID
                ELSE COALESCE(s.ZPARTNERNAME, 'Them')
            END AS sender
        FROM ZWAMEDIAITEM m
        LEFT JOIN ZWAMESSAGE msg ON m.ZMESSAGE = msg.Z_PK
        LEFT JOIN ZWACHATSESSION s ON msg.ZCHATSESSION = s.Z_PK
        WHERE m.ZMEDIALOCALPATH IS NOT NULL;
        """
        cursor.execute(query)
        cache = {}
        for row in cursor.fetchall():
            local_path, msg_date, chat_name, sender = row
            if local_path:
                basename = os.path.basename(local_path)
                cache[basename] = {
                    "date": msg_date.replace(":", "-").replace(" ", "_") if msg_date else "unknown_date",
                    "chat": "".join(c for c in chat_name if c.isalnum() or c in (" ", "_", "-")).strip(),
                    "sender": "".join(c for c in sender if c.isalnum() or c in (" ", "_", "-")).strip(),
                }
        conn.close()
        return cache
    except Exception as e:
        print(f"[*] Note: Could not load ChatStorage.sqlite metadata ({e}). Using raw filenames.")
        return {}


def is_ffmpeg_installed():
    return shutil.which("ffmpeg") is not None


def convert_opus_to_m4a(input_file, output_file):
    """Converts .opus to .m4a (AAC) using ffmpeg for native Apple QuickTime playback."""
    cmd = [
        "ffmpeg", "-y", "-loglevel", "error",
        "-i", input_file,
        "-c:a", "aac", "-b:a", "64k",
        output_file
    ]
    res = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return res.returncode == 0


def extract_audio(backup_dir, manifest_path, output_dir, organize=True, convert=False):
    print(f"[*] Connecting to Manifest database: {manifest_path}")
    conn = sqlite3.connect(f"file:{manifest_path}?mode=ro", uri=True)
    cursor = conn.cursor()

    # Query both WhatsApp domains for all audio extensions
    query = """
    SELECT fileID, relativePath, domain 
    FROM Files 
    WHERE (domain LIKE '%whatsapp%' OR domain LIKE '%WhatsApp%')
      AND (relativePath LIKE '%.opus' OR relativePath LIKE '%.m4a' OR relativePath LIKE '%.wav')
    """
    cursor.execute(query)
    rows = cursor.fetchall()

    if not rows:
        print("[!] No WhatsApp audio files found in Manifest.db.")
        conn.close()
        return

    print(f"[*] Found {len(rows):,} voice note records in Manifest.db.")

    # Try to load ChatStorage metadata for friendlier naming
    chat_db_candidates = ["ChatStorage.sqlite", os.path.expanduser("~/Desktop/ChatStorage.sqlite")]
    chat_db = next((p for p in chat_db_candidates if os.path.isfile(p)), None)
    metadata_cache = build_media_metadata_cache(chat_db) if chat_db else {}
    if metadata_cache:
        print(f"[*] Linked {len(metadata_cache):,} media items from {os.path.basename(chat_db)} for rich naming.")

    os.makedirs(output_dir, exist_ok=True)

    extracted_count = 0
    converted_count = 0

    for file_id, relative_path, domain in rows:
        prefix = file_id[:2]
        source_path = os.path.join(backup_dir, prefix, file_id)

        if not os.path.isfile(source_path):
            continue

        base_filename = os.path.basename(relative_path)
        meta = metadata_cache.get(base_filename)

        if organize and meta:
            chat_folder = os.path.join(output_dir, meta["chat"] or "Other")
            os.makedirs(chat_folder, exist_ok=True)
            clean_name = f"{meta['date']}_{meta['sender']}_{base_filename}"
            target_path = os.path.join(chat_folder, clean_name)
        else:
            target_path = os.path.join(output_dir, base_filename)

        # Copy original file
        shutil.copy2(source_path, target_path)
        extracted_count += 1

        # Optional conversion to .m4a for instant Quick Look / QuickTime playback
        if convert and target_path.endswith(".opus") and is_ffmpeg_installed():
            m4a_target = target_path[:-5] + ".m4a"
            if convert_opus_to_m4a(target_path, m4a_target):
                converted_count += 1

    conn.close()
    print(f"\n[+] Extracted {extracted_count:,} voice notes to: {os.path.abspath(output_dir)}")
    if convert and is_ffmpeg_installed():
        print(f"[+] Converted {converted_count:,} .opus files to Apple-native .m4a format.")
    elif extracted_count > 0:
        print("\n[i] Note on playing .opus voice notes on Mac:")
        print("    1. Drag and drop any .opus file directly into Google Chrome or Firefox.")
        print("    2. Or open with VLC media player (https://www.videolan.org/vlc/).")
        if not is_ffmpeg_installed():
            print("    3. To enable Spacebar/QuickTime playback: install ffmpeg (`brew install ffmpeg`) and re-run with `--convert`.")


def parse_args():
    parser = argparse.ArgumentParser(
        description="Extract and organize WhatsApp voice notes (.opus, .m4a) from local iPhone backups."
    )
    parser.add_argument(
        "-b", "--backup-dir",
        default=None,
        help="Path to specific iPhone backup folder (defaults to most recent in MobileSync).",
    )
    parser.add_argument(
        "-m", "--manifest",
        default=None,
        help="Path to Manifest.db (optional; defaults to backup folder or current directory).",
    )
    parser.add_argument(
        "-o", "--output-dir",
        default="VoiceNotes",
        help="Directory to save extracted voice notes (default: VoiceNotes/).",
    )
    parser.add_argument(
        "--no-organize",
        action="store_true",
        help="Do not organize into contact folders even if ChatStorage.sqlite is present.",
    )
    parser.add_argument(
        "-c", "--convert",
        action="store_true",
        help="Convert .opus voice notes to .m4a using ffmpeg for native Apple QuickTime playback.",
    )
    return parser.parse_args()


def main():
    args = parse_args()

    backup_dir = args.backup_dir or find_latest_backup()
    manifest_path = args.manifest or get_manifest_path(backup_dir)

    if not manifest_path or not os.path.isfile(manifest_path):
        print("[!] Could not locate Manifest.db.")
        print("\nOptions:")
        print("  1. Copy Manifest.db to this directory:")
        print("     cp ~/Library/Application\\ Support/MobileSync/Backup/<BACKUP_ID>/Manifest.db .")
        print("  2. Or specify directly:")
        print("     python3 extract_audio.py --manifest /path/to/Manifest.db --backup-dir /path/to/backup")
        sys.exit(1)

    if not backup_dir or not os.path.isdir(backup_dir):
        print("[!] Could not find the source backup folder holding the hashed files.")
        print("    Specify with: python3 extract_audio.py --backup-dir /path/to/backup/folder")
        sys.exit(1)

    if args.convert and not is_ffmpeg_installed():
        print("[!] Notice: --convert requested, but 'ffmpeg' was not found on your system.")
        print("    You can install it with: brew install ffmpeg")
        print("    Extracting original .opus files without conversion...\n")

    extract_audio(
        backup_dir=backup_dir,
        manifest_path=manifest_path,
        output_dir=args.output_dir,
        organize=not args.no_organize,
        convert=args.convert,
    )


if __name__ == "__main__":
    main()
