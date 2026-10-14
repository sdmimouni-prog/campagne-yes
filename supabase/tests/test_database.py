#!/usr/bin/env python3
"""Exercise the actual portal migration on an isolated disposable PostgreSQL cluster."""

import concurrent.futures
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
import uuid


ADMIN = "11111111-1111-4111-8111-111111111111"
VIEWER = "22222222-2222-4222-8222-222222222222"
OUTSIDER = "33333333-3333-4333-8333-333333333333"
OTHER_ADMIN = "44444444-4444-4444-8444-444444444444"
SQL_FILE = Path(__file__).resolve().parents[1] / "migrations/202610040001_portal.sql"
REACH_MIGRATION = SQL_FILE.parent / "202610140001_campaign_reach_frequency.sql"
BASE = {
    "channel": "facebook", "name": "YES · Octobre", "start": "2026-10-01",
    "end": "2026-10-31", "budget": 10000.25, "impressions": 4000, "clicks": 20,
}


def literal(value):
    return "'" + str(value).replace("'", "''") + "'"


class DatabaseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory(prefix="yes-portal-pg-", dir="/tmp")
        cls.path = Path(cls.tmp.name)
        cls.bindir = Path(os.environ.get("PORTAL_PG_BIN", ""))

        def binary(name):
            configured = cls.bindir / name
            return str(configured) if configured.is_file() else shutil.which(name)

        cls.psql, cls.pg_ctl, cls.initdb = map(binary, ("psql", "pg_ctl", "initdb"))
        if not all((cls.psql, cls.pg_ctl, cls.initdb)):
            cls.tmp.cleanup()
            raise RuntimeError("PostgreSQL initdb, pg_ctl and psql are required (or PORTAL_PG_BIN).")
        cls.data = cls.path / "data"
        cls.socket = cls.path / "socket"
        cls.socket.mkdir()
        cls.started = False
        try:
            subprocess.run([cls.initdb, "-D", str(cls.data), "--username=postgres",
                            "--encoding=UTF8", "--no-locale", "--auth=trust"],
                           check=True, capture_output=True, text=True)
            subprocess.run([cls.pg_ctl, "-D", str(cls.data), "-l", str(cls.path / "postgres.log"),
                            "-o", f"-h '' -k {cls.socket} -p 18769 -F", "-w", "start"],
                           check=True, capture_output=True, text=True)
            cls.started = True
            cls.run_sql("""
              create role anon nologin;
              create role authenticated nologin;
              create role service_role nologin bypassrls;
              create schema auth;
              create table auth.users(id uuid primary key, email text);
              create function auth.uid() returns uuid language sql stable as $$
                select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
              $$;
              grant usage on schema auth to anon, authenticated, service_role;
              grant execute on function auth.uid() to anon, authenticated, service_role;
            """)
            cls.run_sql(SQL_FILE.read_text())
            # Upgrade a populated database, as production already contains campaigns.
            cls.run_sql("""
              insert into public.portal_campaigns(client_id,channel,name,start_date,end_date,budget,impressions,clicks)
              values ('yes-baby','facebook','Before migration','2026-10-01','2026-10-31',125,200,10);
            """)
            cls.before_upgrade = json.loads(cls.run_sql("select portal_private.campaign_json(c) from public.portal_campaigns c;"))
            cls.run_sql(REACH_MIGRATION.read_text())
            cls.after_upgrade = json.loads(cls.run_sql("select portal_private.campaign_json(c) from public.portal_campaigns c;"))
            cls.upgrade_history_count = cls.run_sql("select count(*) from public.portal_campaign_history;")
            cls.run_sql(f"""
              insert into auth.users(id, email) values
                ('{ADMIN}', 'admin@example.invalid'), ('{VIEWER}', 'viewer@example.invalid'),
                ('{OUTSIDER}', 'outsider@example.invalid'), ('{OTHER_ADMIN}', 'other@example.invalid');
              insert into public.portal_clients(id,name) values ('other-client', 'Other client');
              insert into public.portal_memberships(user_id,client_id,role) values
                ('{ADMIN}', 'yes-baby', 'admin'), ('{VIEWER}', 'yes-baby', 'viewer'),
                ('{OTHER_ADMIN}', 'other-client', 'admin');
            """)
        except subprocess.CalledProcessError as exc:
            cls.tearDownClass()
            raise RuntimeError(f"PostgreSQL setup failed: {exc.stderr or exc.stdout}") from exc
        except Exception:
            cls.tearDownClass()
            raise

    @classmethod
    def tearDownClass(cls):
        if getattr(cls, "started", False):
            subprocess.run([cls.pg_ctl, "-D", str(cls.data), "-m", "immediate", "-w", "stop"],
                           check=True, capture_output=True, text=True)
        cls.tmp.cleanup()

    @classmethod
    def run_sql(cls, sql, user=None, role=None, expected_error=None):
        prefix = ""
        if user:
            prefix += f"set request.jwt.claim.sub = {literal(user)};\n"
        if role or user:
            prefix += f"set role {role or 'authenticated'};\n"
        completed = subprocess.run(
            [cls.psql, "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1",
             "-v", "VERBOSITY=sqlstate", "-h", str(cls.socket), "-p", "18769", "-U", "postgres", "postgres"],
            input=prefix + sql, text=True, capture_output=True)
        if expected_error:
            if completed.returncode == 0 or expected_error not in completed.stderr:
                raise AssertionError(f"Expected {expected_error}; got {completed.stdout} {completed.stderr}")
        elif completed.returncode:
            raise AssertionError(completed.stderr)
        return completed.stdout.strip()

    def setUp(self):
        self.run_sql("truncate public.portal_campaign_history, public.portal_campaigns restart identity; "
                     "update public.portal_clients set updated_at = null;")

    def save(self, payload=None, campaign_id=None, archive=False, user=ADMIN, client="yes-baby"):
        sql = self.save_sql(payload if payload is not None else BASE, campaign_id, archive, client)
        return json.loads(self.run_sql(sql, user=user))

    @staticmethod
    def save_sql(payload, campaign_id=None, archive=False, client="yes-baby"):
        encoded = literal(json.dumps(payload, ensure_ascii=False, allow_nan=False))
        identifier = literal(campaign_id) + "::uuid" if campaign_id else "null"
        return f"select public.portal_save_campaign({literal(client)}, {encoded}::jsonb, {identifier}, {'true' if archive else 'false'});"

    def listing(self, user=ADMIN, client="yes-baby"):
        return json.loads(self.run_sql(f"select public.portal_list_campaigns({literal(client)});", user=user))

    def test_empty_live_database_has_no_demo(self):
        self.assertEqual(self.listing(), {"mode": "manual", "campaigns": [], "updatedAt": None})

    def test_additive_migration_preserves_existing_records_and_audit(self):
        self.assertEqual(self.after_upgrade, {**self.before_upgrade, "reach": None, "frequency": None})
        self.assertEqual(self.upgrade_history_count, "1")

    def test_reach_frequency_storage_and_backward_compatible_updates(self):
        c = self.save({**BASE, "reach": 2400, "frequency": 999})["campaign"]
        self.assertEqual(c["reach"], 2400)
        self.assertEqual(c["frequency"], 1.666667)
        self.assertEqual(self.listing(user=VIEWER)["campaigns"], [c])
        legacy_edit = self.save({**BASE, "revision": 1, "impressions": 8000}, c["id"])["campaign"]
        self.assertEqual(legacy_edit["reach"], 2400)
        self.assertEqual(legacy_edit["frequency"], 3.333333)
        archived = self.save({"revision": 2}, c["id"], archive=True)["campaign"]
        self.assertEqual(archived["reach"], 2400)
        self.assertEqual(archived["frequency"], 3.333333)
        self.assertEqual(self.listing(user=VIEWER)["campaigns"], [])
        restored = self.save({**BASE, "revision": 3, "reach": 0, "frequency": 999}, c["id"])["campaign"]
        self.assertEqual(restored["reach"], 0)
        self.assertIsNone(restored["frequency"])
        unknown = self.save({**BASE, "revision": 4, "reach": None}, c["id"])["campaign"]
        self.assertIsNone(unknown["reach"])
        self.assertIsNone(unknown["frequency"])
        zero_impressions = self.save({**BASE, "revision": 5, "reach": 20, "impressions": 0}, c["id"])["campaign"]
        self.assertEqual(zero_impressions["frequency"], 0)
        snapshot = json.loads(self.run_sql("select record from public.portal_campaign_history order by id desc limit 1;"))
        self.assertEqual(snapshot, zero_impressions)

    def test_create_replace_and_null_fields_with_atomic_audit(self):
        original = self.save({**BASE, "name": "  YES · Octobre\t", "ctr": 999, "source": "fake", "revision": 99})
        c = original["campaign"]
        self.assertEqual(c["name"], "YES · Octobre")
        self.assertEqual(c["ctr"], 0.5)
        self.assertEqual(c["revision"], 1)
        self.assertEqual(c["source"], "manual")
        for field in ("spend", "views", "trueviews", "interactions", "reach", "frequency"):
            self.assertIsNone(c[field])
        updated = self.save({**BASE, "revision": 1, "impressions": 5000, "clicks": 25,
                             "spend": 150.75, "views": 0, "trueviews": 300, "interactions": 42}, c["id"])["campaign"]
        self.assertEqual(updated["revision"], 2)
        self.assertEqual(updated["impressions"], 5000)  # Replacement, not addition.
        self.assertEqual(updated["createdAt"], c["createdAt"])
        self.assertEqual(updated["views"], 0)
        self.assertEqual(self.listing()["campaigns"], [updated])
        history = json.loads(self.run_sql(
            "select jsonb_agg(jsonb_build_object('actor',actor_id,'action',action,'record',record) order by id) "
            "from public.portal_campaign_history;", user=ADMIN))
        self.assertEqual([h["action"] for h in history], ["create", "update"])
        self.assertTrue(all(h["actor"] == ADMIN for h in history))
        self.assertEqual(history[-1]["record"], updated)
        self.assertIsNotNone(original["updatedAt"])

    def test_validation_preserves_storage_and_distinguishes_unknown_from_zero(self):
        c = self.save({**BASE, "impressions": 0, "clicks": 0, "budget": 0})["campaign"]
        self.assertIsNone(c["ctr"])
        invalid = [
            ("channel", "sms"), ("name", "\t  "), ("name", "x" * 161),
            ("start", "2026-02-30"), ("start", "2026-1-01"), ("start", "0000-01-01"),
            ("end", "2026-09-30"), ("budget", "10"), ("budget", True), ("budget", None),
            ("budget", 10.001), ("spend", -1), ("impressions", 1.25), ("clicks", False),
            ("views", "5"), ("views", 9000000000001), ("interactions", -1),
            ("trueviews", 0.3), ("status", None), ("status", "paused"),
            ("reach", -1), ("reach", 0.5), ("reach", True), ("reach", "25"), ("reach", 9000000000001),
        ]
        for field, value in invalid:
            with self.subTest(field=field, value=value):
                response = self.save({**BASE, field: value})
                self.assertEqual(response["status"], 422)
                self.assertIn(field, response["fields"])
        self.assertEqual(self.save([])["status"], 400)
        self.assertEqual(self.save({**BASE, "unused": "x" * 70000})["status"], 413)
        self.assertEqual(self.listing()["campaigns"], [c])
        self.assertEqual(self.run_sql("select count(*) from public.portal_campaign_history;"), "1")

    def test_optimistic_revisions_and_concurrent_edits(self):
        c = self.save()["campaign"]
        for revision in (None, True, "1", 0, 1.5):
            response = self.save({**BASE, "revision": revision}, c["id"])
            self.assertEqual(response["status"], 422)
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda name: self.save({**BASE, "revision": 1, "name": name}, c["id"]),
                                    ["Concurrent A", "Concurrent B"]))
        successes = [r for r in results if "campaign" in r]
        conflicts = [r for r in results if r.get("status") == 409]
        self.assertEqual(len(successes), 1)
        self.assertEqual(len(conflicts), 1)
        self.assertEqual(conflicts[0]["current"], successes[0]["campaign"])
        self.assertEqual(self.run_sql("select count(*) from public.portal_campaign_history;"), "2")

    def test_archive_visibility_and_restore(self):
        c = self.save()["campaign"]
        self.assertEqual(len(self.listing(user=VIEWER)["campaigns"]), 1)
        archived = self.save({"revision": 1}, c["id"], archive=True)["campaign"]
        self.assertEqual(archived["status"], "archived")
        self.assertEqual(self.listing(user=VIEWER)["campaigns"], [])
        self.assertEqual(self.run_sql("select count(*) from public.portal_campaigns;", user=VIEWER), "0")
        self.assertEqual(len(self.listing()["campaigns"]), 1)
        restored = self.save({**BASE, "revision": 2, "status": "active"}, c["id"])["campaign"]
        self.assertEqual(restored["revision"], 3)
        self.assertEqual(self.listing(user=VIEWER)["campaigns"], [restored])
        self.assertEqual(self.run_sql("select string_agg(action, ',' order by id) from public.portal_campaign_history;"),
                         "create,archive,update")

    def test_anonymous_no_membership_and_cross_client_access(self):
        c = self.save()["campaign"]
        for table in ("portal_clients", "portal_memberships", "portal_campaigns", "portal_campaign_history"):
            self.run_sql(f"select * from public.{table};", role="anon", expected_error="42501")
            self.assertEqual(self.run_sql(f"select count(*) from public.{table};", user=OUTSIDER), "0")
        self.run_sql("select public.portal_list_campaigns('yes-baby');", role="anon", expected_error="42501")
        self.run_sql("select public.portal_list_campaigns('yes-baby');", user=OUTSIDER, expected_error="42501")
        self.run_sql("select public.portal_list_campaigns('other-client');", user=ADMIN, expected_error="42501")
        self.run_sql(self.save_sql(BASE), role="anon", expected_error="42501")
        self.run_sql(self.save_sql(BASE), user=OUTSIDER, expected_error="42501")
        other = self.save(user=OTHER_ADMIN, client="other-client")["campaign"]
        self.assertEqual(self.listing()["campaigns"], [c])
        self.assertEqual(self.save({**BASE, "revision": 1}, other["id"])["status"], 404)
        self.assertEqual(self.save({**BASE, "revision": 1}, str(uuid.uuid4()))["status"], 404)

    def test_viewer_cannot_write_promote_or_read_audit(self):
        c = self.save()["campaign"]
        self.run_sql(self.save_sql(BASE), user=VIEWER, expected_error="42501")
        self.run_sql(self.save_sql({"revision": 1}, c["id"], archive=True), user=VIEWER, expected_error="42501")
        self.run_sql("set request.jwt.claims = '{\"user_metadata\":{\"role\":\"admin\"}}';" + self.save_sql(BASE),
                     user=VIEWER, expected_error="42501")
        self.run_sql("update public.portal_memberships set role = 'admin';", user=VIEWER, expected_error="42501")
        self.run_sql(f"insert into public.portal_memberships values ('{VIEWER}','other-client','admin');",
                     user=VIEWER, expected_error="42501")
        self.assertEqual(self.run_sql("select role from public.portal_memberships;", user=VIEWER), "viewer")
        self.assertEqual(self.run_sql("select count(*) from public.portal_campaign_history;", user=VIEWER), "0")
        self.assertEqual(self.run_sql("select count(*) from public.portal_memberships;", user=ADMIN), "1")
        for user in (ADMIN, VIEWER):
            self.run_sql("update public.portal_campaigns set clicks = 999;", user=user, expected_error="42501")
            self.run_sql("delete from public.portal_campaigns;", user=user, expected_error="42501")
            self.run_sql("update public.portal_clients set name = 'Changed';", user=user, expected_error="42501")
            self.run_sql("delete from public.portal_campaign_history;", user=user, expected_error="42501")
            self.run_sql("select portal_private.validate_campaign('{}'::jsonb);", user=user, expected_error="42501")

    def test_rls_hardening_and_table_constraints(self):
        self.assertEqual(self.run_sql("select count(*) from pg_class where relname in "
                                     "('portal_clients','portal_memberships','portal_campaigns','portal_campaign_history') and relrowsecurity;"), "4")
        self.assertEqual(self.run_sql("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace "
                                     "where n.nspname in ('public','portal_private') and p.proname in "
                                     "('portal_list_campaigns','portal_save_campaign','campaign_json','audit_campaign','validate_campaign') "
                                     "and array_to_string(p.proconfig,',') = 'search_path=\"\"';"), "5")
        c = self.save()["campaign"]
        self.run_sql(f"update public.portal_campaigns set spend = 'NaN'::numeric where id={literal(c['id'])};", expected_error="23514")
        self.run_sql(f"update public.portal_campaigns set budget = 0.001 where id={literal(c['id'])};", expected_error="23514")
        self.run_sql(f"update public.portal_campaigns set clicks = -1 where id={literal(c['id'])};", expected_error="23514")
        self.run_sql(f"update public.portal_campaigns set reach = -1 where id={literal(c['id'])};", expected_error="23514")
        self.run_sql(f"update public.portal_campaigns set reach = 9000000000001 where id={literal(c['id'])};", expected_error="23514")
        self.run_sql(f"update public.portal_campaigns set frequency = 999 where id={literal(c['id'])};", expected_error="428C9")
        self.assertEqual(self.listing()["campaigns"], [c])


if __name__ == "__main__":
    unittest.main(verbosity=2)
