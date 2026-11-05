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
- **USB-to-Lightning or USB-C cable** to connect your iPhone to your Mac.
- **An unencrypted local iPhone backup** created using Finder.

> [!IMPORTANT]
> **Encrypt Local Backup** in Finder must be **UNCHECKED**. If your backup is encrypted, both `ChatStorage.sqlite` and media files are encrypted with iOS keybags and cannot be read.

---

## Step-by-Step Guide: Connecting the Phone & Backing Up

### 1. Physical Cable Connection & Trust Pairing
1. **Unlock your iPhone** so you are on the Home Screen.
2. **Connect your iPhone to your Mac** using your USB cable.
3. **Allow accessory on Mac**:
   - If macOS displays a popup asking *"Allow accessory to connect?"*, click **Allow**.
4. **Trust this computer on iPhone**:
   - When the prompt *"Trust This Computer?"* appears on your iPhone screen, tap **Trust**.
   - Enter your **iPhone lock-screen passcode** when prompted.

### 2. Locate Your iPhone in Finder
1. On your Mac, open **Finder** (the blue-and-white icon in your Dock).
2. Look at the left sidebar under the **Locations** section.
3. Click on your **iPhone’s name** (e.g., *"Katlego's iPhone"*).
4. If Finder asks you to trust the device, click **Trust**.

### 3. Configure Backup Settings in Finder
Once your iPhone's summary window appears:
1. Click on the **General** tab at the top.
2. Under the **Backups** section, select:
   - 🔘 **"Back up all of the data on your iPhone to this Mac"**
3. Verify the **"Encrypt local backup"** checkbox:
   - ⚠️ **Ensure "Encrypt local backup" is UNCHECKED** ⬜.
   - *(If this is checked, the SQLite database and voice notes will be encrypted and unreadable).*
4. Click **Back Up Now** on the right side.

### 4. Wait for the Backup to Complete
- A progress indicator will spin next to your iPhone's name in the Finder sidebar.
- Backups usually take between 5 to 15 minutes depending on your storage usage.
- Once finished, you will see: *"Last backup to this Mac: Today at [Time]"*.
- **You can now safely unplug your iPhone.** All extraction scripts run purely on your Mac's local disk.

---

## Step-by-Step Guide: Extracting Data

### Extracting Complete Message History (Texts + Media Logs)
The extractor pulls the complete conversation timeline—including typed texts, voice note records, photos, videos, and stickers:

```bash
cd /Users/katlego/work/Whatsapp

# 1. View breakdown: Total messages, texts, media/voice notes, and top chats
python3 extract_whatsapp.py --stats

# 2. Export complete history to whatsapp_messages.csv (includes [Voice Note], [Photo], etc.)
python3 extract_whatsapp.py

# 3. Export ONLY typed text messages (skipping media placeholders)
python3 extract_whatsapp.py --text-only

# 4. Export to JSON format
python3 extract_whatsapp.py --format json -o chats.json

# 5. Filter messages by a specific person or phone number
python3 extract_whatsapp.py --filter "Sarah" -o sarah_messages.csv
```

### Extracting Voice Notes (Audio)
```bash
# Extract all voice notes into the VoiceNotes/ folder
python3 extract_audio.py
```
If `ChatStorage.sqlite` is present, voice notes are automatically sorted into subfolders by contact name with timestamps (e.g. `VoiceNotes/Sarah/2024-03-15_14-30-22_Me_audio.opus`).

---

## How to Listen to `.opus` Files on macOS

QuickTime does not support `.opus` natively out of the box. You have three simple options:

1. **Web Browser (Zero install):** Drag and drop any `.opus` file directly into **Google Chrome** or **Firefox**—they play instantly.
2. **VLC Media Player:** Open the files with [VLC for Mac](https://www.videolan.org/vlc/).
3. **Auto-convert to Apple-native `.m4a`:**
   Install `ffmpeg`:
   ```bash
   brew install ffmpeg
   ```
   Then run the audio extractor with `--convert`:
   ```bash
   python3 extract_audio.py --convert
   ```
   This generates `.m4a` files alongside the `.opus` files so you can preview them simply by tapping **Spacebar** (Quick Look) or opening them in QuickTime.

---

## Troubleshooting

- **iPhone doesn't appear in Finder sidebar:**
  - Go to **Finder → Settings (or Preferences) → Sidebar**.
  - Under **Locations**, check the box for **"CDs, DVDs, and iOS Devices"**.
- **"Operation not permitted" error in Terminal:**
  - macOS protects the `MobileSync/Backup` directory with TCC permissions.
  - Open **System Settings → Privacy & Security → Full Disk Access**.
  - Toggle **ON** the switch for **Terminal** (or your terminal emulator).
  - Alternatively, you can copy the backup files manually in Finder.
- **"Encrypt local backup" asks for a password when trying to uncheck:**
  - If an encrypted backup was set up in the past, Apple requires you to enter that password once to switch back to unencrypted backups.

---

## Privacy & Security

- **Local Only:** All processing is done offline on your computer. Nothing is sent over the network.
- **Git Safety:** `.gitignore` blocks databases (`*.sqlite`, `*.db`, `Manifest.db`), chat logs (`*.csv`, `*.json`), and audio files (`*.opus`, `*.m4a`, `VoiceNotes/`) from being tracked or committed to version control.
