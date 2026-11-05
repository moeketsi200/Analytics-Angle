# WhatsApp iOS Local Backup Extractor

A lightweight, zero-dependency Python tool to parse and export WhatsApp chat history from unencrypted local iPhone backups on macOS.

---

## Why This Works

WhatsApp uses end-to-end encryption over the network, but when you perform a local, unencrypted backup of your iPhone to a Mac via Finder, iOS saves the decrypted application database onto your Mac's filesystem:

- **Target Database:** `ChatStorage.sqlite` (Core Data SQLite database)
- **Backup File Hash:** `7c7fba66680ef796b916b067077cc246adacf01d` (the SHA-1 hash of `AppDomainGroup-group.net.whatsapp.WhatsApp.shared-ChatStorage.sqlite`)
- **Location:** `~/Library/Application Support/MobileSync/Backup/<BACKUP_ID>/7c/`
- **Core Data Timestamp Offset:** Adds `978307200` seconds to convert Apple's epoch (Jan 1, 2001) to Unix epoch (Jan 1, 1970).

---

## Requirements

- **macOS** with Python 3.6+ (uses standard library modules: `sqlite3`, `csv`, `json`, `argparse`).
- **An unencrypted local iPhone backup** created using Finder.

> [!IMPORTANT]
> **Encrypt Local Backup** in Finder must be **UNCHECKED**. If your backup is encrypted, the database is locked behind iOS backup keybags and cannot be read without decryption keys.

---

## Step 1: Create an Unencrypted Backup

1. Connect your iPhone to your Mac via USB cable.
2. Open **Finder** and select your iPhone under **Locations** in the sidebar.
3. In the **General** tab under **Backups**:
   - Select **"Back up all of the data on your iPhone to this Mac"**.
   - Make sure **"Encrypt local backup"** is **unchecked**.
4. Click **Back Up Now** and wait for completion.

---

## Step 2: Locate `ChatStorage.sqlite`

### Option A: Automatic Detection
The script will automatically attempt to find the newest backup in:
```bash
~/Library/Application Support/MobileSync/Backup/
```
*(Note: If macOS displays `Permission denied`, grant Terminal **Full Disk Access** in **System Settings > Privacy & Security > Full Disk Access**, or use Option B).*

### Option B: Manual Copy (Recommended)
1. Open Finder, press `Cmd + Shift + G`, and paste:
   ```
   ~/Library/Application Support/MobileSync/Backup/
   ```
2. Open the folder with the latest date/time stamp.
3. Open folder `7c`.
4. Copy the file named `7c7fba66680ef796b916b067077cc246adacf01d` to this project directory and rename it to:
   ```
   ChatStorage.sqlite
   ```

---

## Step 3: Usage

### Basic Export (CSV)
Exports all messages to `whatsapp_messages.csv`:
```bash
python3 extract_whatsapp.py
```

### View Chat Statistics
View top contacts and message counts without writing a file:
```bash
python3 extract_whatsapp.py --stats
```

### Export to JSON
```bash
python3 extract_whatsapp.py --format json -o my_chats.json
```

### Filter by Specific Contact or Phone Number
```bash
python3 extract_whatsapp.py --filter "John" -o john_messages.csv
```

### Specify a Custom Database Path
```bash
python3 extract_whatsapp.py /path/to/ChatStorage.sqlite
```

---

## Output Fields

| Field | Description |
|---|---|
| `Timestamp` | Localized message timestamp (`YYYY-MM-DD HH:MM:SS`) |
| `Chat Name` | Name of the contact or group chat |
| `Chat ID / JID` | WhatsApp JID (phone number or group ID) |
| `Sender` | Identifies sender (`Me`, contact name, or phone number) |
| `Message` | Text content of the message |

---

## Privacy & Security

- **Never commit your database or exports.** `.gitignore` is preconfigured to prevent `ChatStorage.sqlite`, `*.db`, `*.csv`, and `*.json` from ever being staged or pushed.
- All operations run 100% offline on your local computer. No data is sent over the network.
