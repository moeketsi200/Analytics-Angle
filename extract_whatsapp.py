#!/usr/bin/env python3
"""
WhatsApp iOS Local Backup Extractor
Extracts chat logs from an unencrypted iPhone backup on macOS or a local ChatStorage.sqlite file.
Supports text messages, voice notes, photos, videos, and media placeholders.
"""

import argparse
import csv
import glob
import json
import os
import sqlite3
import sys

# Standard SHA-1 hash for WhatsApp database in iOS backups:
# AppDomainGroup-group.net.whatsapp.WhatsApp.shared-ChatStorage.sqlite
WHATSAPP_BACKUP_HASH = "7c7fba66680ef796b916b067077cc246adacf01d"
BACKUP_DIR = os.path.expanduser("~/Library/Application Support/MobileSync/Backup")


def find_database():
    """
    Looks for ChatStorage.sqlite in the current directory, Desktop,
    or automatically discovers the latest unencrypted iPhone backup in MobileSync.
    """
    candidates = [
        "ChatStorage.sqlite",
        os.path.expanduser("~/Desktop/ChatStorage.sqlite"),
        os.path.expanduser("~/Downloads/ChatStorage.sqlite"),
    ]

    for path in candidates:
        if os.path.isfile(path):
            print(f"[*] Found local database file: {path}")
            return path

    # Search in macOS MobileSync Backup folder
    if os.path.isdir(BACKUP_DIR):
        try:
            backup_folders = sorted(
                glob.glob(os.path.join(BACKUP_DIR, "*")),
                key=os.path.getmtime,
                reverse=True,
            )
            for folder in backup_folders:
                target_file = os.path.join(folder, "7c", WHATSAPP_BACKUP_HASH)
                if os.path.isfile(target_file):
                    print(f"[*] Found WhatsApp backup file in: {folder}")
                    return target_file
        except PermissionError:
            print("[!] Warning: Permission denied accessing ~/Library/Application Support/MobileSync/Backup.")
            print("    Grant 'Full Disk Access' to Terminal in macOS System Settings,")
            print("    or copy the database file to this folder manually as 'ChatStorage.sqlite'.")

    return None


def get_connection(db_path):
    try:
        conn = sqlite3.connect(f"file:{os.path.abspath(db_path)}?mode=ro", uri=True)
        return conn
    except sqlite3.OperationalError as e:
        print(f"[!] Could not open SQLite database: {e}")
        print("    If the backup is encrypted, the database cannot be read without decryption keys.")
        return None


def show_stats(conn):
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) FROM ZWAMESSAGE;")
    total_messages = cursor.fetchone()[0]

    cursor.execute("SELECT COUNT(*) FROM ZWAMESSAGE WHERE ZTEXT IS NOT NULL AND ZTEXT != '';")
    text_messages = cursor.fetchone()[0]
    media_messages = total_messages - text_messages

    cursor.execute("""
        SELECT 
            COALESCE(s.ZPARTNERNAME, s.ZCONTACTJID, 'Unknown') AS chat_name,
            COUNT(m.Z_PK) AS msg_count
        FROM ZWAMESSAGE m
        LEFT JOIN ZWACHATSESSION s ON m.ZCHATSESSION = s.Z_PK
        GROUP BY m.ZCHATSESSION
        ORDER BY msg_count DESC
        LIMIT 20;
    """)
    top_chats = cursor.fetchall()

    print("\n" + "=" * 55)
    print(f"  Total Messages (All):  {total_messages:,}")
    print(f"  - Text Messages:       {text_messages:,}")
    print(f"  - Media / Voice Notes: {media_messages:,}")
    print("=" * 55)
    print(f"{'Chat Name':<38} | {'Messages':>12}")
    print("-" * 55)
    for name, count in top_chats:
        disp_name = (name[:35] + "...") if len(name) > 38 else name
        print(f"{disp_name:<38} | {count:>12,}")
    print("=" * 55 + "\n")


def build_message_text_expression(msg_cols, tables):
    """
    Builds a SQL expression that classifies message types:
    text, voice notes, photos, videos, documents, or stickers.
    """
    has_type = "ZMESSAGETYPE" in msg_cols

    if has_type:
        return """
        CASE 
            WHEN m.ZTEXT IS NOT NULL AND m.ZTEXT != '' AND m.ZMESSAGETYPE = 0 THEN m.ZTEXT
            WHEN m.ZTEXT IS NOT NULL AND m.ZTEXT != '' THEN 
                CASE m.ZMESSAGETYPE
                    WHEN 1 THEN '[Photo] ' || m.ZTEXT
                    WHEN 2 THEN '[Voice Note] ' || m.ZTEXT
                    WHEN 3 THEN '[Video] ' || m.ZTEXT
                    WHEN 8 THEN '[Document] ' || m.ZTEXT
                    ELSE '[' || m.ZTEXT || ']'
                END
            ELSE 
                CASE m.ZMESSAGETYPE
                    WHEN 1 THEN '[Photo]'
                    WHEN 2 THEN '[Voice Note / Audio]'
                    WHEN 3 THEN '[Video]'
                    WHEN 4 THEN '[Contact Card]'
                    WHEN 5 THEN '[Location]'
                    WHEN 8 THEN '[Document]'
                    WHEN 15 THEN '[Sticker]'
                    ELSE '[Media / Voice Note / Attachment]'
                END
        END
        """
    else:
        return "COALESCE(NULLIF(m.ZTEXT, ''), '[Media / Voice Note / Attachment]')"


def extract_messages(conn, output_path, export_format="csv", chat_filter=None, text_only=False):
    cursor = conn.cursor()

    # Discover tables & columns
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
    tables = {row[0] for row in cursor.fetchall()}

    if "ZWAMESSAGE" not in tables:
        print("[!] Error: 'ZWAMESSAGE' table not found in this database.")
        return

    cursor.execute("PRAGMA table_info(ZWAMESSAGE);")
    msg_cols = {col[1] for col in cursor.fetchall()}

    has_chat_session = "ZWACHATSESSION" in tables
    has_is_from_me = "ZISFROMME" in msg_cols
    has_from_jid = "ZFROMJID" in msg_cols

    date_expr = "datetime(m.ZMESSAGEDATE + 978307200, 'unixepoch', 'localtime') AS MessageDate"
    text_expr = build_message_text_expression(msg_cols, tables)

    where_clauses = []
    params = []

    if text_only:
        where_clauses.append("m.ZTEXT IS NOT NULL AND m.ZTEXT != ''")

    if has_chat_session:
        cursor.execute("PRAGMA table_info(ZWACHATSESSION);")
        chat_cols = {col[1] for col in cursor.fetchall()}
        partner_col = "s.ZPARTNERNAME" if "ZPARTNERNAME" in chat_cols else "''"
        jid_col = "s.ZCONTACTJID" if "ZCONTACTJID" in chat_cols else "''"
        from_me_expr = "m.ZISFROMME" if has_is_from_me else "0"
        from_jid_expr = "m.ZFROMJID" if has_from_jid else "''"

        if chat_filter:
            where_clauses.append(f"({partner_col} LIKE ? OR {jid_col} LIKE ?)")
            params.extend([f"%{chat_filter}%", f"%{chat_filter}%"])

        where_sql = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""

        query = f"""
        SELECT 
            {date_expr},
            COALESCE({partner_col}, {jid_col}, 'Unknown Chat') AS ChatName,
            COALESCE({jid_col}, '') AS ChatJID,
            CASE 
                WHEN {from_me_expr} = 1 THEN 'Me'
                WHEN {from_jid_expr} IS NOT NULL AND {from_jid_expr} != '' THEN {from_jid_expr}
                ELSE COALESCE({partner_col}, 'Them')
            END AS Sender,
            {text_expr} AS MessageText
        FROM ZWAMESSAGE m
        LEFT JOIN ZWACHATSESSION s ON m.ZCHATSESSION = s.Z_PK
        {where_sql}
        ORDER BY m.ZMESSAGEDATE ASC;
        """
    else:
        from_jid_expr = "m.ZFROMJID" if has_from_jid else "'Unknown'"
        where_sql = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""

        query = f"""
        SELECT 
            {date_expr},
            'Chat' AS ChatName,
            '' AS ChatJID,
            COALESCE({from_jid_expr}, 'Unknown') AS Sender,
            {text_expr} AS MessageText
        FROM ZWAMESSAGE m
        {where_sql}
        ORDER BY m.ZMESSAGEDATE ASC;
        """

    print("[*] Executing extraction query...")
    cursor.execute(query, params)
    rows = cursor.fetchall()

    if not rows:
        print("[*] No messages found matching criteria.")
        return

    headers = ["Timestamp", "Chat Name", "Chat ID / JID", "Sender", "Message"]

    if export_format.lower() == "json":
        data = [dict(zip(headers, row)) for row in rows]
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    else:
        with open(output_path, "w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            writer.writerow(headers)
            writer.writerows(rows)

    print(f"[+] Successfully exported {len(rows):,} total messages to: {os.path.abspath(output_path)}")


def parse_args():
    parser = argparse.ArgumentParser(
        description="Extract and export complete WhatsApp chat history (texts, voice notes, media logs) from local iPhone backups."
    )
    parser.add_argument(
        "database",
        nargs="?",
        default=None,
        help="Path to ChatStorage.sqlite or hashed backup file (optional; auto-detected if omitted).",
    )
    parser.add_argument(
        "-o",
        "--output",
        default=None,
        help="Output file path (defaults to whatsapp_messages.csv or whatsapp_messages.json).",
    )
    parser.add_argument(
        "-f",
        "--format",
        choices=["csv", "json"],
        default="csv",
        help="Export format: csv or json (default: csv).",
    )
    parser.add_argument(
        "--filter",
        dest="chat_filter",
        default=None,
        help="Filter messages by contact name or phone number/JID.",
    )
    parser.add_argument(
        "--text-only",
        action="store_true",
        help="Only export typed text messages, skipping standalone voice notes and media placeholders.",
    )
    parser.add_argument(
        "-s",
        "--stats",
        action="store_true",
        help="Display message stats (total, texts, media) and top chats without exporting.",
    )
    return parser.parse_args()


def main():
    args = parse_args()

    db_path = args.database or find_database()
    if not db_path:
        print("[!] No ChatStorage.sqlite or unencrypted iPhone backup found.")
        print("\nUsage options:")
        print("  1. Run with explicit path: python3 extract_whatsapp.py /path/to/ChatStorage.sqlite")
        print("  2. Or copy the backup file 7c7fba66680ef796b916b067077cc246adacf01d into this directory")
        print("     and rename it to ChatStorage.sqlite, then run: python3 extract_whatsapp.py")
        sys.exit(1)

    conn = get_connection(db_path)
    if not conn:
        sys.exit(1)

    try:
        if args.stats:
            show_stats(conn)
        else:
            out_file = args.output or f"whatsapp_messages.{args.format}"
            extract_messages(
                conn,
                out_file,
                export_format=args.format,
                chat_filter=args.chat_filter,
                text_only=args.text_only,
            )
    finally:
        conn.close()


if __name__ == "__main__":
    main()
