# -*- coding: utf-8 -*-
"""NEXUS LAB API 回归测试。

自动在临时目录启动一个独立的 server 实例（--db/--uploads/随机端口），
覆盖：认证与会话、图片上传、创意中心、任务 CRUD、文档历史/差异/回滚/复制/导出/删除、
素材资产、概览统计与富文本净化。

运行：python -m unittest discover -s tests -v
"""
import base64
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVER = os.path.join(ROOT, "server.py")
PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)
PNG_URL = "data:image/png;base64," + base64.b64encode(PNG).decode()


def free_port():
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    sock.close()
    return port


class NexusApiTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp(prefix="nexuslab_test_")
        cls.port = free_port()
        cls.base = "http://127.0.0.1:%d" % cls.port
        cls.proc = subprocess.Popen(
            [sys.executable, SERVER, "--port", str(cls.port),
             "--db", os.path.join(cls.tmp, "test.db"),
             "--uploads", os.path.join(cls.tmp, "uploads")],
            cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        deadline = time.time() + 15
        while time.time() < deadline:
            if cls.proc.poll() is not None:
                raise RuntimeError("server exited early with code %s" % cls.proc.returncode)
            try:
                urllib.request.urlopen(cls.base + "/api/session", timeout=1).close()
                return
            except Exception:
                time.sleep(0.2)
        cls.proc.kill()
        raise RuntimeError("server did not start in time")

    @classmethod
    def tearDownClass(cls):
        if getattr(cls, "proc", None):
            cls.proc.terminate()
            try:
                cls.proc.wait(timeout=5)
            except Exception:
                cls.proc.kill()
        shutil.rmtree(getattr(cls, "tmp", ""), ignore_errors=True)

    def request(self, method, path, payload=None, token=None):
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8") if payload is not None else None
        req = urllib.request.Request(self.base + path, data=data, method=method)
        req.add_header("Content-Type", "application/json")
        if token:
            req.add_header("X-Session", token)
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                raw = resp.read()
                try:
                    return resp.status, json.loads(raw.decode("utf-8"))
                except ValueError:
                    return resp.status, raw
        except urllib.error.HTTPError as err:
            raw = err.read()
            try:
                return err.code, json.loads(raw.decode("utf-8"))
            except ValueError:
                return err.code, raw

    def register(self, real_id):
        status, data = self.request("POST", "/api/register", {"real_id": real_id, "password": "pass123456", "bio": "测试"})
        self.assertEqual(status, 201, data)
        return data["token"]

    def create_document(self, token, title="文档", category="planning"):
        status, data = self.request("POST", "/api/documents", {"title": title, "category": category}, token)
        self.assertEqual(status, 201, data)
        return data["id"]

    # ---------- 认证与会话 ----------
    def test_auth_session(self):
        token_a = self.register("auth_a")
        token_b = self.register("auth_b")
        status, data = self.request("POST", "/api/login", {"real_id": "auth_a", "password": "wrong!"})
        self.assertEqual(status, 401, data)
        status, data = self.request("POST", "/api/logout", {}, token_a)
        self.assertEqual(status, 200, data)
        status, data = self.request("GET", "/api/session", token=token_a)
        self.assertEqual(status, 200, data)
        self.assertIsNone(data.get("member"))
        status, data = self.request("POST", "/api/ideas", {"content": "未登录发不了"}, token_b)
        self.assertEqual(status, 200, data)

    # ---------- 图片上传与限制 ----------
    def test_image_upload_limits(self):
        token = self.register("img_a")
        status, data = self.request("POST", "/api/profile", {"avatar": PNG_URL, "bio": "头像"}, token)
        self.assertEqual(status, 200, data)
        self.assertTrue(data["member"]["avatar"].startswith("/uploads/"), data)
        status, raw = self.request("GET", data["member"]["avatar"])
        self.assertEqual(status, 200)
        self.assertEqual(raw, PNG)
        big = base64.b64encode(b"x" * (2 * 1024 * 1024 + 1)).decode()
        status, data = self.request("POST", "/api/profile", {"avatar": "data:image/png;base64," + big, "bio": ""}, token)
        self.assertEqual(status, 400, data)
        status, data = self.request("POST", "/api/profile", {"avatar": "data:image/svg+xml;base64," + base64.b64encode(b"<svg/>").decode(), "bio": ""}, token)
        self.assertEqual(status, 400, data)

    # ---------- 创意中心 ----------
    def test_ideas_lifecycle(self):
        token = self.register("idea_a")
        token_b = self.register("idea_b")
        status, data = self.request("POST", "/api/ideas", {"content": "玩法：重力反转", "image": PNG_URL, "idea_type": "gameplay"}, token)
        self.assertEqual(status, 200, data)
        idea = next(i for i in data["ideas"] if i["content"] == "玩法：重力反转")
        idea_id = idea["id"]
        self.assertTrue(idea["image"].startswith("/uploads/"), idea)
        status, data = self.request("POST", "/api/ideas/%s/like" % idea_id, {}, token_b)
        self.assertEqual(status, 200, data)
        status, data = self.request("POST", "/api/ideas/%s/comments" % idea_id, {"content": "不错"}, token_b)
        self.assertEqual(status, 200, data)
        status, data = self.request("DELETE", "/api/ideas/%s" % idea_id, None, token_b)
        self.assertEqual(status, 403, data)
        status, data = self.request("DELETE", "/api/ideas/%s" % idea_id, None, token)
        self.assertEqual(status, 200, data)
        status, data = self.request("POST", "/api/ideas/999999/like", {}, token_b)
        self.assertEqual(status, 404, data)

    # ---------- 任务 ----------
    def test_tasks_lifecycle(self):
        token = self.register("task_a")
        status, data = self.request("POST", "/api/tasks", {
            "title": "核心循环原型", "description": "", "task_type": "programming",
            "priority": "high", "status": "todo", "assignee_id": "",
            "estimated_hours": "", "due_date": ""}, token)
        self.assertEqual(status, 201, data)
        task_id = data["id"]
        status, data = self.request("PUT", "/api/tasks/%s" % task_id, {
            "title": "核心循环原型 v2", "description": "加需求", "task_type": "programming",
            "priority": "urgent", "status": "in_progress", "estimated_hours": 4, "due_date": "2026-09-30"}, token)
        self.assertEqual(status, 200, data)
        status, data = self.request("PUT", "/api/tasks/%s" % task_id, {"status": "review"}, token)
        self.assertEqual(status, 200, data)
        status, data = self.request("GET", "/api/tasks")
        task = next(t for t in data["tasks"] if t["id"] == task_id)
        self.assertEqual(task["title"], "核心循环原型 v2")
        self.assertEqual(task["status"], "review")
        self.assertEqual(task["estimated_hours"], 4)
        status, data = self.request("PUT", "/api/tasks/%s" % task_id, {"status": "bogus"}, token)
        self.assertEqual(status, 400, data)
        status, data = self.request("DELETE", "/api/tasks/%s" % task_id, None, token)
        self.assertEqual(status, 200, data)
        status, data = self.request("DELETE", "/api/tasks/%s" % task_id, None, token)
        self.assertEqual(status, 404, data)

    # ---------- 文档：历史 / 差异 / 回滚 / 导出 / 复制 / 删除 ----------
    def test_documents_history_and_friends(self):
        token = self.register("doc_a")
        doc_id = self.create_document(token, "设计文档", "planning")
        status, data = self.request("GET", "/api/documents/%s" % doc_id)
        self.assertEqual(len(data["history"]), 1, data)
        create_hid = data["history"][0]["id"]
        self.assertIn("id", data["history"][0])
        v1 = "<h2>版本一</h2><p>保留的一行。</p>"
        v2 = "<h2>版本二</h2><p>改动的一行。</p><p>新增行。</p>"
        self.request("PUT", "/api/documents/%s" % doc_id, {"title": "设计文档", "content": v1}, token)
        status, data = self.request("PUT", "/api/documents/%s" % doc_id, {"title": "设计文档", "content": v2}, token)
        self.assertEqual(status, 200, data)
        status, data = self.request("GET", "/api/documents/%s" % doc_id)
        self.assertEqual(len(data["history"]), 3, data)
        hid_v2 = data["history"][0]["id"]
        status, diff = self.request("GET", "/api/documents/%s/revisions/%s/diff" % (doc_id, hid_v2))
        self.assertEqual(status, 200, diff)
        self.assertGreaterEqual(diff["added"], 1, diff)
        self.assertGreaterEqual(diff["removed"], 1, diff)
        self.assertTrue(any(op[0] == "add" and "新增行" in op[1] for op in diff["ops"]), diff["ops"])
        # 回滚到初始版本
        status, data = self.request("POST", "/api/documents/%s/rollback" % doc_id, {"history_id": create_hid}, token)
        self.assertEqual(status, 200, data)
        status, data = self.request("GET", "/api/documents/%s" % doc_id)
        self.assertEqual(data["document"]["content"], "", data)
        self.assertEqual(data["history"][0]["action"], "回滚到历史版本")
        # 净化：恶意标签被剥除
        evil = '<h2>净化</h2><script>alert(1)</script><img src=x onerror=alert(2)><p onclick="x()">正文<b>粗</b></p>'
        self.request("PUT", "/api/documents/%s" % doc_id, {"title": "设计文档", "content": evil}, token)
        status, data = self.request("GET", "/api/documents/%s" % doc_id)
        content = data["document"]["content"]
        self.assertNotIn("<script", content)
        self.assertNotIn("onerror", content)
        self.assertNotIn("onclick", content)
        self.assertNotIn("<img", content)
        self.assertIn("<b>粗</b>", content)
        # 导出
        status, data = self.request("GET", "/api/documents/%s/export" % doc_id)
        self.assertEqual(status, 200, data)
        self.assertIn("正文", data["text"])
        # 复制
        status, data = self.request("POST", "/api/documents/%s/duplicate" % doc_id, {}, token)
        self.assertEqual(status, 201, data)
        copy_id = data["id"]
        status, data = self.request("GET", "/api/documents/%s" % copy_id)
        self.assertIn("副本", data["document"]["title"], data)
        self.assertTrue(data["document"]["content"].startswith("<h2>"), data["document"])
        # 删除
        status, data = self.request("DELETE", "/api/documents/%s" % copy_id, None, token)
        self.assertEqual(status, 200, data)
        status, data = self.request("GET", "/api/documents/%s" % copy_id)
        self.assertEqual(status, 404, data)

    # ---------- 素材资产 ----------
    def test_assets_lifecycle(self):
        token = self.register("asset_a")
        token_b = self.register("asset_b")
        status, data = self.request("POST", "/api/assets", {"filename": "moodboard.png", "category": "visual", "data": PNG_URL}, token)
        self.assertEqual(status, 201, data)
        self.assertTrue(data["asset"]["url"].startswith("/uploads/assets/"), data)
        asset_id = data["asset"]["id"]
        status, raw = self.request("GET", data["asset"]["url"])
        self.assertEqual(status, 200)
        self.assertEqual(raw, PNG)
        zip_url = "data:application/zip;base64," + base64.b64encode(b"PK\x03\x04fake").decode()
        status, data = self.request("POST", "/api/assets", {"filename": "..\\..\\build.zip", "category": "build", "data": zip_url}, token)
        self.assertEqual(status, 201, data)
        self.assertEqual(data["asset"]["filename"], "build.zip", data)
        bad = "data:text/html;base64," + base64.b64encode(b"<script>x</script>").decode()
        status, data = self.request("POST", "/api/assets", {"filename": "x.html", "category": "visual", "data": bad}, token)
        self.assertEqual(status, 400, data)
        status, data = self.request("GET", "/api/assets")
        self.assertEqual(data["total"], 2, data)
        status, data = self.request("GET", "/api/assets?category=audio")
        self.assertEqual(len(data["assets"]), 0, data)
        status, data = self.request("DELETE", "/api/assets/%s" % asset_id, None, token_b)
        self.assertEqual(status, 403, data)
        status, data = self.request("DELETE", "/api/assets/%s" % asset_id, None, token)
        self.assertEqual(status, 200, data)
        status, data = self.request("DELETE", "/api/assets/%s" % asset_id, None, token)
        self.assertEqual(status, 404, data)

    # ---------- 概览统计 ----------
    def test_overview(self):
        token = self.register("ov_a")
        self.create_document(token, "进度文档", "planning")
        status, data = self.request("GET", "/api/overview")
        self.assertEqual(status, 200, data)
        self.assertIn("counts", data)
        self.assertGreaterEqual(data["counts"]["members"], 1, data)
        self.assertGreaterEqual(data["counts"]["documents"], 1, data)
        self.assertEqual(sum(data["tasks_by_status"].values()), data["counts"]["tasks"], data)
        self.assertIn("hours", data)
        self.assertIsInstance(data["recent_documents"], list)
        self.assertTrue(any("task_type" in row for row in data["recent_tasks"]) or data["counts"]["tasks"] == 0, data)


if __name__ == "__main__":
    unittest.main()
