#!/usr/bin/env python3
"""Local YES campaign portal, static assets and durable manual campaign records.

Run: python3 server.py --port 8768
The local server has no user authentication and intentionally binds to loopback.
"""

import argparse
import functools
import json
import math
import re
import sqlite3
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit


ROOT = Path(__file__).resolve().parent
MAX_NUMBER = 9_000_000_000_000
MAX_BODY = 65_536
CHANNELS = {"facebook", "instagram", "youtube", "tiktok", "display"}


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


class APIError(Exception):
    def __init__(self, status, message, **details):
        self.status = status
        self.payload = {"error": message, **details}
        super().__init__(message)


def validate_campaign(payload):
    errors = {}
    result = {}
    channel = payload.get("channel")
    if not isinstance(channel, str) or channel not in CHANNELS:
        errors["channel"] = "Choisissez un canal valide."
    result["channel"] = channel
    name = payload.get("name")
    if not isinstance(name, str) or not name.strip() or len(name.strip()) > 160:
        errors["name"] = "Le nom doit contenir entre 1 et 160 caractères."
    result["name"] = name.strip() if isinstance(name, str) else ""
    for field in ("start", "end"):
        value = payload.get(field)
        try:
            if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
                raise ValueError
            date.fromisoformat(value)
            result[field] = value
        except ValueError:
            errors[field] = "Renseignez une date valide au format AAAA-MM-JJ."
    if "start" in result and "end" in result and result["start"] > result["end"]:
        errors["end"] = "La fin doit être égale ou postérieure au début."
    for field in ("budget", "spend", "impressions", "reach", "clicks", "views", "trueviews", "interactions"):
        value = payload.get(field)
        if value is None and field not in ("budget", "impressions", "clicks"):
            result[field] = None
            continue
        if (isinstance(value, bool) or not isinstance(value, (int, float))
                or value < 0 or value > MAX_NUMBER or not math.isfinite(value)):
            errors[field] = "Saisissez un nombre positif ou nul, inférieur ou égal à 9 000 milliards."
            continue
        if field in ("budget", "spend"):
            if Decimal(str(value)) * 100 != (Decimal(str(value)) * 100).to_integral_value():
                errors[field] = "Le montant accepte deux décimales au maximum."
            else:
                result[field] = float(value)
        elif int(value) != value:
            errors[field] = "Saisissez un nombre entier positif ou nul."
        else:
            result[field] = int(value)
    status = payload.get("status", "active")
    if not isinstance(status, str) or status not in ("active", "archived"):
        errors["status"] = "Statut invalide."
    result["status"] = status
    if errors:
        raise APIError(422, "Vérifiez les champs du formulaire.", fields=errors)
    result["ctr"] = round(result["clicks"] / result["impressions"] * 100, 6) if result["impressions"] else None
    result["frequency"] = campaign_frequency(result)
    result["source"] = "manual"
    return result


def campaign_frequency(record):
    reach = record.get("reach")
    if reach is None or reach <= 0:
        return None
    return float((Decimal(record["impressions"]) / Decimal(reach)).quantize(
        Decimal("0.000001"), rounding=ROUND_HALF_UP))


def campaign_record(encoded):
    """Expose added metrics for older JSON records without inventing a reach."""
    record = json.loads(encoded)
    record.setdefault("reach", None)
    record["frequency"] = campaign_frequency(record)
    return record


def validate_revision(payload):
    revision = payload.get("revision")
    if isinstance(revision, bool) or not isinstance(revision, int) or revision < 1:
        raise APIError(422, "La version de la campagne est requise.", fields={"revision": "Version invalide."})
    return revision


class CampaignStore:
    def __init__(self, data_dir):
        self.data_dir = Path(data_dir).resolve()
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.path = self.data_dir / "campaigns.sqlite3"
        with self.connect() as conn:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS campaigns (
                    id TEXT PRIMARY KEY, record TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS metadata (
                    key TEXT PRIMARY KEY, value TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    campaign_id TEXT NOT NULL, action TEXT NOT NULL,
                    recorded_at TEXT NOT NULL, record TEXT NOT NULL
                );
            """)

    def connect(self):
        return sqlite3.connect(self.path, timeout=10)

    def list(self):
        with self.connect() as conn:
            conn.execute("BEGIN")
            records = [campaign_record(row[0]) for row in conn.execute("SELECT record FROM campaigns ORDER BY rowid DESC")]
            metadata = dict(conn.execute("SELECT key, value FROM metadata"))
        return {"mode": metadata.get("mode", "demo"), "campaigns": records, "updatedAt": metadata.get("updatedAt")}

    def save(self, payload, campaign_id=None, archive=False):
        record = None if archive else validate_campaign(payload)
        revision = validate_revision(payload) if campaign_id else None
        now = utc_now()
        with self.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            if campaign_id:
                row = conn.execute("SELECT record FROM campaigns WHERE id = ?", (campaign_id,)).fetchone()
                if not row:
                    raise APIError(404, "Campagne introuvable.")
                current = campaign_record(row[0])
                if current["revision"] != revision:
                    raise APIError(409, "Cette campagne a été modifiée. Rechargez sa dernière version.", current=current)
                if archive:
                    record = {**current, "status": "archived"}
                elif "reach" not in payload:
                    # An older open editor cannot clear a metric it does not know about.
                    record["reach"] = current["reach"]
                    record["frequency"] = campaign_frequency(record)
                record.update(id=campaign_id, revision=revision + 1, createdAt=current["createdAt"], updatedAt=now)
            else:
                record.update(id=str(uuid.uuid4()), revision=1, createdAt=now, updatedAt=now)
            encoded = json.dumps(record, ensure_ascii=False, allow_nan=False)
            conn.execute("INSERT OR REPLACE INTO campaigns(id, record) VALUES (?, ?)", (record["id"], encoded))
            conn.execute("INSERT OR REPLACE INTO metadata(key, value) VALUES ('mode', 'manual')")
            conn.execute("INSERT OR REPLACE INTO metadata(key, value) VALUES ('updatedAt', ?)", (now,))
            action = "archive" if archive else "update" if campaign_id else "create"
            conn.execute("INSERT INTO history(campaign_id, action, recorded_at, record) VALUES (?, ?, ?, ?)",
                         (record["id"], action, now, encoded))
        return {"campaign": record, "mode": "manual", "updatedAt": now}


class PortalHandler(SimpleHTTPRequestHandler):
    server_version = "RichmediaPortal/1.0"

    def __init__(self, *args, root, store, **kwargs):
        self.root = Path(root).resolve()
        self.store = store
        super().__init__(*args, directory=str(self.root), **kwargs)

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def json_response(self, status, payload):
        encoded = json.dumps(payload, ensure_ascii=False, allow_nan=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(encoded)

    def check_host(self, mutation=False):
        hosts = self.headers.get_all("Host", [])
        try:
            if len(hosts) != 1:
                raise ValueError
            parsed = urlsplit("http://" + hosts[0])
            if (parsed.hostname not in ("localhost", "127.0.0.1", "::1")
                    or parsed.username or parsed.password or parsed.path
                    or parsed.query or parsed.fragment
                    or (parsed.port or 80) != self.server.server_port):
                raise ValueError
        except ValueError:
            raise APIError(403, "Cet accès est réservé au serveur local.")
        if mutation:
            origins = self.headers.get_all("Origin", [])
            if origins:
                try:
                    if len(origins) != 1:
                        raise ValueError
                    origin = urlsplit(origins[0])
                    if (origin.scheme != "http" or origin.hostname != parsed.hostname
                            or (origin.port or 80) != self.server.server_port
                            or origin.username or origin.password or origin.path
                            or origin.query or origin.fragment):
                        raise ValueError
                except ValueError:
                    raise APIError(403, "Origine de la requête non autorisée.")
            if self.headers.get("Sec-Fetch-Site") == "cross-site":
                raise APIError(403, "Origine de la requête non autorisée.")

    def read_json(self):
        if self.headers.get_content_type() != "application/json":
            raise APIError(415, "Le format application/json est requis.")
        if self.headers.get("Transfer-Encoding"):
            raise APIError(400, "Transfert non pris en charge.")
        lengths = self.headers.get_all("Content-Length", [])
        try:
            if len(lengths) != 1 or not re.fullmatch(r"\d+", lengths[0]):
                raise ValueError
            length = int(lengths[0])
        except ValueError:
            raise APIError(411, "La taille de la requête est requise.")
        if length > MAX_BODY:
            raise APIError(413, "La requête est trop volumineuse.")
        try:
            # Non-standard NaN and Infinity must not enter validation or storage.
            def reject_constant(_value):
                raise ValueError
            payload = json.loads(self.rfile.read(length), parse_constant=reject_constant)
        except (ValueError, UnicodeDecodeError):
            raise APIError(400, "Le contenu JSON est invalide.")
        if not isinstance(payload, dict):
            raise APIError(400, "Un objet JSON est requis.")
        return payload

    def static_allowed(self, path):
        decoded = unquote(path)
        parts = decoded.split("/")
        if any(part.startswith(".") for part in parts if part):
            return False
        try:
            candidate = (self.root / decoded.lstrip("/")).resolve()
            if candidate.is_dir():
                for index in ("index.html", "index.htm"):
                    if (candidate / index).is_file():
                        candidate = (candidate / index).resolve()
                        break
            if not candidate.is_relative_to(self.root) or candidate.is_relative_to(self.store.data_dir):
                return False
            if any(part.startswith(".") for part in candidate.relative_to(self.root).parts):
                return False
            if candidate.name in ("server.py", "test_server.py") or candidate.suffix in (".py", ".pyc", ".sqlite3", ".sqlite", ".db"):
                return False
        except (OSError, ValueError, RuntimeError):
            return False
        return True

    def do_GET(self):
        self.handle_read()

    def do_HEAD(self):
        self.handle_read()

    def handle_read(self):
        try:
            self.check_host()
            path = urlsplit(self.path).path
            if path == "/api/campaigns":
                self.json_response(200, self.store.list())
            elif path.startswith("/api/"):
                raise APIError(404, "Ressource introuvable.")
            elif not self.static_allowed(path):
                self.send_error(HTTPStatus.NOT_FOUND)
            else:
                super().do_HEAD() if self.command == "HEAD" else super().do_GET()
        except APIError as error:
            self.json_response(error.status, error.payload)

    def list_directory(self, path):
        self.send_error(HTTPStatus.NOT_FOUND)
        return None

    def do_POST(self):
        self.handle_mutation()

    def do_PUT(self):
        self.handle_mutation()

    def handle_mutation(self):
        try:
            self.check_host(mutation=True)
            path = urlsplit(self.path).path
            match = re.fullmatch(r"/api/campaigns/([0-9a-f-]{36})(/archive)?", path)
            if self.command == "POST" and path == "/api/campaigns":
                self.json_response(201, self.store.save(self.read_json()))
            elif match and ((self.command == "PUT" and not match[2]) or (self.command == "POST" and match[2])):
                self.json_response(200, self.store.save(self.read_json(), match[1], archive=bool(match[2])))
            else:
                raise APIError(404, "Ressource introuvable.")
        except APIError as error:
            self.json_response(error.status, error.payload)
        except sqlite3.Error:
            self.json_response(503, {"error": "L’enregistrement est temporairement indisponible. Réessayez."})


def make_server(root=ROOT, data_dir=None, host="127.0.0.1", port=8768):
    root = Path(root).resolve()
    store = CampaignStore(data_dir or root / ".data")
    handler = functools.partial(PortalHandler, root=root, store=store)
    return ThreadingHTTPServer((host, port), handler)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8768)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--data-dir", type=Path)
    args = parser.parse_args()
    server = make_server(root=args.root, data_dir=args.data_dir, port=args.port)
    print(f"Richmedia portal: http://127.0.0.1:{server.server_port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
