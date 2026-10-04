"""Integration tests with a temporary database and ephemeral local server."""

import http.client
import json
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from server import CampaignStore, PortalHandler, make_server


class CampaignAPITest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / "public"
        self.root.mkdir()
        (self.root / "index.html").write_text("Portal", encoding="utf-8")
        (self.root / "server.py").write_text("private server source", encoding="utf-8")
        self.log_patch = patch.object(PortalHandler, "log_message")
        self.log_patch.start()
        self.server = make_server(self.root, self.root / ".data", port=0)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.log_patch.stop()
        self.temp.cleanup()

    def request(self, method, path="/api/campaigns", data=None, headers=None, raw=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        body = json.dumps(data) if data is not None else raw
        request_headers = {"Content-Type": "application/json"} if body is not None else {}
        request_headers.update(headers or {})
        conn.request(method, path, body, request_headers)
        response = conn.getresponse()
        content = response.read()
        result = json.loads(content) if response.getheader("Content-Type", "").startswith("application/json") and content else content
        status = response.status
        conn.close()
        return status, result

    def campaign(self, **changes):
        return {"channel": "facebook", "name": "YES · Notoriété", "start": "2026-10-01",
                "end": "2026-10-31", "budget": 40000, "spend": None, "impressions": 1000,
                "clicks": 30, "views": 0, "trueviews": None, "interactions": 15, **changes}

    def test_durable_creation_replacement_conflict_and_archive(self):
        self.assertEqual(self.request("GET")[1], {"mode": "demo", "campaigns": [], "updatedAt": None})
        status, payload = self.request("POST", data=self.campaign(ctr=999))
        self.assertEqual(status, 201)
        record = payload["campaign"]
        self.assertEqual(record["ctr"], 3)
        self.assertEqual(record["revision"], 1)
        self.assertEqual(record["views"], 0)
        self.assertIsNone(record["spend"])
        self.assertEqual(record["source"], "manual")
        path = "/api/campaigns/" + record["id"]
        status, updated = self.request("PUT", path, self.campaign(impressions=2000, revision=1))
        self.assertEqual(status, 200)
        self.assertEqual(updated["campaign"]["impressions"], 2000)
        self.assertEqual(updated["campaign"]["ctr"], 1.5)
        self.assertEqual(updated["campaign"]["revision"], 2)
        self.assertEqual(updated["campaign"]["createdAt"], record["createdAt"])
        status, conflict = self.request("PUT", path, self.campaign(revision=1))
        self.assertEqual(status, 409)
        self.assertEqual(conflict["current"]["impressions"], 2000)
        status, archived = self.request("POST", path + "/archive", {"revision": 2})
        self.assertEqual(status, 200)
        self.assertEqual(archived["campaign"]["status"], "archived")
        durable = CampaignStore(self.root / ".data").list()
        self.assertEqual(durable["mode"], "manual")
        self.assertEqual(len(durable["campaigns"]), 1)
        self.assertEqual(durable["campaigns"][0]["revision"], 3)
        self.assertIsNotNone(durable["updatedAt"])
        status, restored = self.request("PUT", path, self.campaign(revision=3, status="active", impressions=0, clicks=0))
        self.assertEqual(status, 200)
        self.assertIsNone(restored["campaign"]["ctr"])

    def test_invalid_values_are_rejected_without_switching_to_manual(self):
        cases = [{"budget": -1}, {"budget": 1.001}, {"spend": "10"}, {"impressions": 0.5},
                 {"clicks": True}, {"clicks": None}, {"views": -1}, {"trueviews": "4"},
                 {"clicks": 10 ** 500},
                 {"interactions": 9_000_000_000_001}, {"channel": "meta"}, {"channel": []},
                 {"name": " "}, {"name": "x" * 161}, {"start": "2026-02-30"},
                 {"end": "2026-01-01"}, {"status": []}]
        for changes in cases:
            with self.subTest(changes=changes):
                status, error = self.request("POST", data=self.campaign(**changes))
                self.assertEqual(status, 422)
                self.assertTrue(error["fields"])
        for value in ("NaN", "Infinity", "-Infinity"):
            raw = json.dumps(self.campaign()).replace('"budget": 40000', '"budget": ' + value)
            self.assertEqual(self.request("POST", raw=raw)[0], 400)
        self.assertEqual(self.request("POST", data=[])[0], 400)
        self.assertEqual(self.request("GET")[1]["mode"], "demo")

    def test_request_boundary_and_private_files(self):
        self.assertEqual(self.request("GET", "/")[0], 200)
        for path in ("/.data/campaigns.sqlite3", "/%2Edata/campaigns.sqlite3", "/server.py", "/assets/../server.py", "/.data/"):
            with self.subTest(path=path):
                self.assertEqual(self.request("GET", path)[0], 404)
        secret = Path(self.temp.name) / "secret.txt"
        secret.write_text("private", encoding="utf-8")
        (self.root / "escape.txt").symlink_to(secret)
        self.assertEqual(self.request("GET", "/escape.txt")[0], 404)
        (self.root / "linked-index").mkdir()
        (self.root / "linked-index" / "index.html").symlink_to(secret)
        self.assertEqual(self.request("GET", "/linked-index/")[0], 404)
        self.assertEqual(self.request("GET", "/%00")[0], 404)
        self.assertEqual(self.request("GET", headers={"Host": "attacker.test"})[0], 403)
        self.assertEqual(self.request("POST", data=self.campaign(), headers={"Origin": "https://attacker.test"})[0], 403)
        self.assertEqual(self.request("POST", data=self.campaign(), headers={"Origin": "null"})[0], 403)
        self.assertEqual(self.request("POST", data=self.campaign(), headers={"Content-Type": "text/plain"})[0], 415)
        self.assertEqual(self.request("POST", raw="x" * 65537)[0], 413)
        origin = f"http://127.0.0.1:{self.server.server_port}"
        self.assertEqual(self.request("POST", data=self.campaign(), headers={"Origin": origin})[0], 201)


if __name__ == "__main__":
    unittest.main()
