"""
BEarn Data Engine v2.2 - Fixed balance sync with browser
"""

import requests
import threading
import time
import random
import sys
import json
import os
import getpass
from pathlib import Path

API = "https://bearn-production.up.railway.app"
CONFIG_FILE = str(Path.home() / ".be_config.json")

URL_POOL = [
    "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1920",
    "https://images.unsplash.com/photo-1490730141103-6cac27aaab94?w=1920",
    "https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=1920",
    "https://images.unsplash.com/photo-1476224203421-9ac39bcb332e?w=1920",
    "https://images.unsplash.com/photo-1473093295043-cdd812d0e601?w=1920",
    "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=1920",
    "https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=1920",
    "https://images.unsplash.com/photo-1540189549336-e6e99c3679fe?w=1920",
    "https://images.unsplash.com/photo-1567620905732-2d1ec7ab7445?w=1920",
    "https://images.unsplash.com/photo-1496412705862-e00831583e64?w=1920",
    "https://fastly.picsum.photos/id/1/2000/2000.jpg",
    "https://fastly.picsum.photos/id/10/2000/2000.jpg",
    "https://fastly.picsum.photos/id/100/2000/2000.jpg",
    "https://fastly.picsum.photos/id/1000/2000/2000.jpg",
    "https://fastly.picsum.photos/id/101/2000/2000.jpg",
    "https://fastly.picsum.photos/id/102/2000/2000.jpg",
    "https://fastly.picsum.photos/id/103/2000/2000.jpg",
    "https://fastly.picsum.photos/id/104/2000/2000.jpg",
    "https://fastly.picsum.photos/id/106/2000/2000.jpg",
    "https://fastly.picsum.photos/id/107/2000/2000.jpg",
    "https://fastly.picsum.photos/id/108/2000/2000.jpg",
    "https://fastly.picsum.photos/id/169/2000/2000.jpg",
    "https://fastly.picsum.photos/id/180/2000/2000.jpg",
    "https://fastly.picsum.photos/id/20/2000/2000.jpg",
    "https://fastly.picsum.photos/id/25/2000/2000.jpg",
    "https://fastly.picsum.photos/id/29/2000/2000.jpg",
    "https://fastly.picsum.photos/id/30/2000/2000.jpg",
    "https://fastly.picsum.photos/id/31/2000/2000.jpg",
    "https://fastly.picsum.photos/id/32/2000/2000.jpg",
    "https://fastly.picsum.photos/id/33/2000/2000.jpg",
    "https://fastly.picsum.photos/id/34/2000/2000.jpg",
    "https://fastly.picsum.photos/id/35/2000/2000.jpg",
    "https://fastly.picsum.photos/id/36/2000/2000.jpg",
    "https://fastly.picsum.photos/id/37/2000/2000.jpg",
    "https://fastly.picsum.photos/id/38/2000/2000.jpg",
    "https://fastly.picsum.photos/id/39/2000/2000.jpg",
]

class DataEngine:
    def __init__(self):
        self.token = None
        self.bytes = 0
        self.lock = threading.Lock()
        self.running = False
        self.threads = 15
        self.report_interval = 30
        self.session = requests.Session()
        self.total_gb_reported = 0          # Server-tracked
        self.server_balance = 0.0           # Live from API
        self.username = ""
        self.password = ""
        self.session_gb = 0.0               # Local session counter

    def load_config(self):
        if os.path.exists(CONFIG_FILE):
            try:
                with open(CONFIG_FILE) as f:
                    cfg = json.load(f)
                self.username = cfg.get("username", "")
                self.password = cfg.get("password", "")
                if cfg.get("threads"):
                    self.threads = int(cfg["threads"])
                return True
            except:
                pass
        return False

    def save_config(self):
        try:
            with open(CONFIG_FILE, "w") as f:
                json.dump({
                    "username": self.username,
                    "password": self.password,
                    "threads": self.threads
                }, f)
            print(f"[+] Config saved to {CONFIG_FILE}")
        except:
            print("[-] Could not save config")

    def login(self):
        try:
            r = self.session.post(f"{API}/api/auth/login",
                json={"username": self.username, "password": self.password}, timeout=10)
            d = r.json()
            if "token" in d:
                self.token = d["token"]
                print(f"[+] ✅ Logged in as: {self.username}")
                return True
            else:
                print(f"[-] ❌ Login failed: {d.get('error', 'unknown')}")
                return False
        except requests.exceptions.ConnectionError:
            print(f"[-] ❌ Server not running at {API}")
            print("    First start: cd server && node index.js")
            return False
        except Exception as e:
            print(f"[-] Error: {e}")
            return False

    def register(self):
        email = f"{self.username}@be.com"
        try:
            r = self.session.post(f"{API}/api/auth/register",
                json={"username": self.username, "password": self.password, "email": email},
                timeout=10)
            d = r.json()
            if "token" in d:
                self.token = d["token"]
                print(f"[+] ✅ Registered new user: {self.username}")
                self.save_config()
                return True
            print(f"[-] Register failed: {d.get('error', 'unknown')}")
            return False
        except Exception as e:
            print(f"[-] Error: {e}")
            return False

    def get_settings(self):
        try:
            r = self.session.get(f"{API}/api/settings",
                headers={"Authorization": f"Bearer {self.token}"}, timeout=10)
            s = r.json()
            self.threads = s.get("threads", 10)
            print(f"[+] Settings loaded: {self.threads} threads")
            if s.get("theme"): print(f"[+] Theme: {s['theme']}")
            if s.get("lang"): print(f"[+] Language: {'বাংলা' if s['lang']=='bn' else 'English'}")
        except:
            print("[*] Server settings not loaded, using defaults")

    def worker(self, wid):
        timeout = 60
        while self.running:
            try:
                url = random.choice(URL_POOL)
                ua = random.choice([
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0",
                    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                ])
                r = self.session.get(url, headers={"User-Agent": ua}, timeout=timeout, stream=True)
                for chunk in r.iter_content(chunk_size=262144):
                    if not self.running:
                        break
                    if chunk:
                        with self.lock:
                            self.bytes += len(chunk)
            except:
                pass
            time.sleep(random.uniform(0.05, 0.3))

    def reporter(self):
        """প্রতি 30s এ server এ report করে, balance sync রাখে"""
        while self.running:
            time.sleep(self.report_interval)
            with self.lock:
                b = self.bytes
                self.bytes = 0
            gb = b / (1024**3)
            if gb > 0 and self.token:
                try:
                    r = self.session.post(f"{API}/api/data/report",
                        json={"gb": round(gb, 4)},
                        headers={"Authorization": f"Bearer {self.token}"},
                        timeout=10)
                    d = r.json()
                    if d.get("success"):
                        self.total_gb_reported += gb
                        self.server_balance = d.get("balance", self.server_balance)
                        earned = d.get("earned", gb * 0.50)
                        print(f"\n[+] 📊 {gb:.3f}GB → +${earned:.3f}")
                        print(f"[+] 💰 SERVER BALANCE: ${self.server_balance:.2f} ← Same as Browser")
                    else:
                        print(f"\n[-] Report error: {d.get('error', 'unknown')}")
                except Exception as e:
                    print(f"\n[-] Report failed: {e}")
            elif gb > 0:
                print(f"\n[*] ⚠️ {gb:.3f}GB collected but not reported (no token)")

    def stats_printer(self):
        """FIXED: এখন terminal এ server balance দেখায়, local total না"""
        while self.running:
            time.sleep(2)
            with self.lock:
                b = self.bytes
            mb = b / (1024*1024)
            speed = mb / 2
            session_gb = self.total_gb_reported + (b / (1024**3))
            bar_count = min(int(speed / 2), 25)
            bar = "█" * bar_count + "░" * (25 - bar_count)
            # FIX: লোকাল earn_total দেখানোর পরিবর্তে SERVER BALANCE দেখানো হচ্ছে
            sys.stdout.write(f"\r⚡ {speed:.1f} MB/s {bar} | 📦 {session_gb:.2f}GB | 💰 ${self.server_balance:.2f}")
            sys.stdout.flush()

    def run(self):
        print("\n" + "=" * 55)
        print("  🚀 BEarn DATA ENGINE v2.2 (Mismatch Fixed)")
        print("=" * 55)

        self.load_config()

        if not self.username:
            self.username = input("\n👤 Username: ").strip()
            self.password = getpass.getpass("🔑 Password: ").strip()
            threads_input = input(f"🧵 Threads [{self.threads}]: ").strip()
            if threads_input.isdigit():
                self.threads = int(threads_input)
            self.save_config()
        else:
            print(f"\n[+] Loaded config for: {self.username}")
            print(f"[+] Threads: {self.threads}")
            change = input("Change settings? (y/N): ").strip().lower()
            if change == 'y':
                self.password = getpass.getpass("🔑 Password: ").strip()
                t = input(f"🧵 Threads [{self.threads}]: ").strip()
                if t.isdigit(): self.threads = int(t)
                self.save_config()

        if not self.login():
            print("[*] Trying to register...")
            if not self.register():
                print("[-] ❌ Cannot continue. Check server is running.")
                print("    Start: cd server && node index.js")
                sys.exit(1)

        self.get_settings()

        print(f"\n[+] 🚀 Starting {self.threads} threads...")
        print(f"[+]   ~{self.threads*0.3:.1f} - {self.threads*0.7:.1f} GB/hour expected")
        print(f"[+]   Reporting every {self.report_interval}s")
        print("[+]   Press ENTER to stop\n")

        self.running = True

        for i in range(self.threads):
            t = threading.Thread(target=self.worker, args=(i,), daemon=True)
            t.start()

        threading.Thread(target=self.reporter, daemon=True).start()
        threading.Thread(target=self.stats_printer, daemon=True).start()

        try:
            input()
        except KeyboardInterrupt:
            pass

        self.running = False
        print("\n\n[-] ⏹ Engine stopped")
        print(f"[+] 📊 Session total: {self.total_gb_reported:.2f}GB")
        print(f"[+] 💰 Final Server Balance: ${self.server_balance:.2f}")
        print("[+] ✅ Done\n")


if __name__ == "__main__":
    engine = DataEngine()
    engine.run()