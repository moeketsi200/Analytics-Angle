# WhatsApp iOS Local Backup Toolkit

A lightweight, zero-dependency Python toolkit to extract and export WhatsApp text messages and voice notes directly from unencrypted local iPhone backups on macOS.

---

## Tools in This Repository

1. **`extract_whatsapp.py`**: Extracts text messages, chat metadata, senders, and timestamps from `ChatStorage.sqlite` into CSV or JSON.
2. **`extract_audio.py`**: Locates and extracts all WhatsApp voice notes (`.opus`, `.m4a`) from the backup using Apple's `Manifest.db` master index, organizing them by chat/contact name and timestamp.

---

## How It Works

WhatsApp encrypts messages end-to-end over the network, but unencrypted local backups created via Finder save the decrypted application data on your Mac:

- **Text Database:** `ChatStorage.sqlite` (Hashed as `7c7fba66680ef796b916b067077cc246adacf01d` inside folder `7c/`).
- **Master Index:** `Manifest.db` (Maps the hashed filenames to their real filenames, domains, and relative paths).
- **Voice Notes:** Stored as hashed files corresponding to `.opus` or `.m4a` files.
- **Location:** `~/Library/Application Support/MobileSync/Backup/<BACKUP_ID>/`

---

## Prerequisites

- **macOS** with Python 3.6+
- **An unencrypted local iPhone backup** created using Finder.

> [!IMPORTANT]
> **Encrypt Local Backup** in Finder must be **UNCHECKED**. If your backup is encrypted, both `ChatStorage.sqlite` and media files are encrypted with iOS keybags and cannot be read.

---

## Step 1: Create an Unencrypted Backup

1. Connect your iPhone to your Mac via USB.
2. Open **Finder** and click on your iPhone in the sidebar.
3. Under **Backups**:
   - Select **"Back up all of the data on your iPhone to this Mac"**.
   - Ensure **"Encrypt local backup"** is **unchecked**.
4. Click **Back Up Now** and wait for it to complete.

---

## Step 2: Extracting Text Messages

### Basic Export (CSV)
```bash
python3 extract_whatsapp.py
```

### View Chat Statistics
```bash
python3 extract_whatsapp.py --stats
```

### Export to JSON or Filter by Contact
```bash
python3 extract_whatsapp.py --format json -o chats.json
python3 extract_whatsapp.py --filter "Sarah" -o sarah_chat.csv
```

---

## Step 3: Extracting Voice Notes (Audio)

WhatsApp voice notes are stored as `.opus` audio files. Because Apple hashes all filenames in the backup, `extract_audio.py` queries `Manifest.db` to locate and extract them.

### Basic Audio Extraction
```bash
python3 extract_audio.py
```
This extracts all voice notes into the `VoiceNotes/` folder. If `ChatStorage.sqlite` is present, it will automatically organize voice notes into subfolders by contact name with dates and sender tags (e.g. `VoiceNotes/Sarah/2024-03-15_14-30-22_Me_audio.opus`).

### How to Listen to `.opus` Files on Mac

QuickTime does not support `.opus` natively out of the box. You have three simple options:

1. **Web Browser (Zero install):** Drag and drop any `.opus` file directly into **Google Chrome** or **Firefox**—they play instantly.
2. **VLC Media Player:** Open the files with [VLC for Mac](https://www.videolan.org/vlc/).
3. **Auto-convert to Apple-native `.m4a`:**
   Install `ffmpeg`:
   ```bash
   brew install ffmpeg
   ```
   Then run the extractor with the `--convert` flag:
   ```bash
   python3 extract_audio.py --convert
   ```
   This generates `.m4a` files alongside the `.opus` files so you can preview them simply by tapping **Spacebar** (Quick Look) or opening them in QuickTime.

---

## Privacy & Security

- **Local Only:** All processing is done offline on your computer.
- **Git Safety:** `.gitignore` blocks databases (`*.sqlite`, `*.db`, `Manifest.db`), chat logs (`*.csv`, `*.json`), and audio files (`*.opus`, `*.m4a`, `VoiceNotes/`) from being tracked or committed to version control.
