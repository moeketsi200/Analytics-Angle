import os
import sqlite3
import subprocess
import sys
import tempfile
import unittest


class TestWhatsAppExtractors(unittest.TestCase):
    def setUp(self):
        self.test_dir = tempfile.TemporaryDirectory()
        self.db_path = os.path.join(self.test_dir.name, "ChatStorage.sqlite")
        self.manifest_path = os.path.join(self.test_dir.name, "Manifest.db")
        self.setup_mock_database()
        self.setup_mock_manifest()

    def tearDown(self):
        self.test_dir.cleanup()

    def setup_mock_database(self):
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()

        # Create mock ZWACHATSESSION
        cur.execute("""
        CREATE TABLE ZWACHATSESSION (
            Z_PK INTEGER PRIMARY KEY,
            ZPARTNERNAME TEXT,
            ZCONTACTJID TEXT
        );
        """)
        cur.execute("INSERT INTO ZWACHATSESSION VALUES (1, 'Alice Smith', '1234567890@s.whatsapp.net');")

        # Create mock ZWAMESSAGE
        cur.execute("""
        CREATE TABLE ZWAMESSAGE (
            Z_PK INTEGER PRIMARY KEY,
            ZCHATSESSION INTEGER,
            ZMESSAGEDATE REAL,
            ZTEXT TEXT,
            ZISFROMME INTEGER,
            ZFROMJID TEXT,
            ZMESSAGETYPE INTEGER
        );
        """)
        # Message 1: Text from Alice
        cur.execute("INSERT INTO ZWAMESSAGE VALUES (1, 1, 700000000, 'Hello there!', 0, '1234567890@s.whatsapp.net', 0);")
        # Message 2: Text from Me
        cur.execute("INSERT INTO ZWAMESSAGE VALUES (2, 1, 700000060, 'Hey Alice!', 1, NULL, 0);")
        # Message 3: Voice Note (ZTEXT is NULL, ZMESSAGETYPE is 2)
        cur.execute("INSERT INTO ZWAMESSAGE VALUES (3, 1, 700000120, NULL, 0, '1234567890@s.whatsapp.net', 2);")

        conn.commit()
        conn.close()

    def setup_mock_manifest(self):
        conn = sqlite3.connect(self.manifest_path)
        cur = conn.cursor()
        cur.execute("""
        CREATE TABLE Files (
            fileID TEXT PRIMARY KEY,
            domain TEXT,
            relativePath TEXT,
            flags INTEGER,
            file BLOB
        );
        """)
        cur.execute("""
        INSERT INTO Files VALUES (
            'aabbccdd11223344',
            'AppDomainGroup-group.net.whatsapp.WhatsApp.shared',
            'Message/Media/audio_sample.opus',
            1,
            NULL
        );
        """)
        conn.commit()
        conn.close()

        # Create fake source audio file matching the hash
        hash_dir = os.path.join(self.test_dir.name, "aa")
        os.makedirs(hash_dir, exist_ok=True)
        with open(os.path.join(hash_dir, "aabbccdd11223344"), "wb") as f:
            f.write(b"OggS fake opus audio content")

    def test_extract_whatsapp_csv(self):
        out_csv = os.path.join(self.test_dir.name, "out.csv")
        cmd = [
            sys.executable,
            "extract_whatsapp.py",
            self.db_path,
            "-o", out_csv,
            "-f", "csv"
        ]
        res = subprocess.run(cmd, capture_output=True, text=True)
        self.assertEqual(res.returncode, 0, f"Error: {res.stderr}")
        self.assertTrue(os.path.isfile(out_csv))

        with open(out_csv, "r", encoding="utf-8") as f:
            content = f.read()
            self.assertIn("Alice Smith", content)
            self.assertIn("Hello there!", content)
            self.assertIn("Hey Alice!", content)
            self.assertIn("[Voice Note / Audio]", content)

    def test_extract_whatsapp_stats(self):
        cmd = [
            sys.executable,
            "extract_whatsapp.py",
            self.db_path,
            "--stats"
        ]
        res = subprocess.run(cmd, capture_output=True, text=True)
        self.assertEqual(res.returncode, 0, f"Error: {res.stderr}")
        self.assertIn("Total Messages", res.stdout)
        self.assertIn("Alice Smith", res.stdout)

    def test_extract_audio(self):
        audio_out = os.path.join(self.test_dir.name, "extracted_audio")
        cmd = [
            sys.executable,
            "extract_audio.py",
            "-b", self.test_dir.name,
            "-m", self.manifest_path,
            "-o", audio_out
        ]
        res = subprocess.run(cmd, capture_output=True, text=True)
        self.assertEqual(res.returncode, 0, f"Error: {res.stderr}")
        extracted_files = os.listdir(audio_out)
        self.assertTrue(len(extracted_files) > 0)
        self.assertIn("audio_sample.opus", extracted_files)


if __name__ == "__main__":
    unittest.main()

