# Local Message Archive Toolkit

An independent personal utility with two separate tools:

1. **Linked-device collector** (`bridge/`): Captures new messages from a linked device and keeps a small local archive.
2. **iPhone backup extractor** (`extract_whatsapp.py` & `extract_audio.py`): Reads chat data from an unencrypted local iPhone backup.

---

## Linked-device collector

The collector links as a secondary device. It does not need an iPhone cable or Finder backup, but it is not zero-disk: the installed dependencies use about 54 MB, and the local database, linked-device credentials, and optional voice notes use additional space. It stores the latest 5,000 message notifications; it does not import earlier chat history. Voice-note downloads are limited to 8 MiB each and 32 MiB total.

### Start the bridge

Use Node.js 22.13 or later:

```bash
cd bridge
npm ci
npm start
```

Data is saved under `bridge/.data/`; linked-device credentials are saved under `bridge/auth_info/`. Both are ignored by Git. The dashboard listens only on the Mac by default. The Mac must be awake and connected for the bridge to receive messages.

### Remote access

Remote access is disabled by default. For access through a trusted encrypted VPN or HTTPS proxy, set a token before starting the bridge:

```bash
cd bridge
export BRIDGE_TOKEN="$(openssl rand -hex 32)"
printf 'Bridge token: %s\n' "$BRIDGE_TOKEN"
npm start
```

Keep the bridge bound to `127.0.0.1` when using a local tunnel or proxy; enter the token in the dashboard. To bind directly to a network interface, also set `BRIDGE_HOST=0.0.0.0`. The server refuses a non-local bind without a token. Use an encrypted VPN or HTTPS endpoint, and do not publish the dashboard without its token. A tunnel provider may handle the traffic that passes through its service.

---

## iPhone backup extractor

---

## How It Works



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
