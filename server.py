import argparse
import base64
import html
import json
import hashlib
import hmac
import mimetypes
import os
import re
import secrets
import sqlite3
import sys
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse, urlsplit

ROOT = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(ROOT, "nexuslab.db")
UPLOAD_DIR = os.path.join(ROOT, "uploads")
PORT = 8000
HOST = "127.0.0.1"
SESSION_TTL_DAYS = 30
MAX_AVATAR_BYTES = 2 * 1024 * 1024      # 头像
MAX_ICON_BYTES = 3 * 1024 * 1024        # 项目图标
MAX_IDEA_IMAGE_BYTES = 5 * 1024 * 1024  # 动态图片
MAX_ASSET_BYTES = 60 * 1024 * 1024      # 素材资产
IMAGE_EXT = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
}
ASSET_CATEGORIES = ("visual", "audio", "build", "other")
ASSET_DIR = os.path.join(UPLOAD_DIR, "assets")
ASSET_DANGEROUS_MIME = {
    "image/svg+xml", "text/html", "application/xhtml+xml",
    "application/javascript", "text/javascript", "application/xml", "text/xml",
    "application/x-sh", "text/x-shellscript",
}
ASSET_MIME_EXT = {
    "image/jpeg": ".jpg", "image/png": ".png", "image/gif": ".gif", "image/webp": ".webp",
    "image/bmp": ".bmp", "audio/mpeg": ".mp3", "audio/wav": ".wav", "audio/x-wav": ".wav",
    "audio/ogg": ".ogg", "audio/flac": ".flac", "audio/midi": ".mid", "audio/x-midi": ".mid",
    "video/mp4": ".mp4", "model/gltf-binary": ".glb", "model/gltf+json": ".gltf",
    "application/pdf": ".pdf", "application/json": ".json",
    "text/plain": ".txt", "text/csv": ".csv", "text/markdown": ".md",
}
SESSIONS = {}


def hash_password(password, salt=None):
    salt_bytes = bytes.fromhex(salt) if salt else secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt_bytes, 200000)
    return salt_bytes.hex(), digest.hex()


def public_member(row):
    return {"id": row["id"], "real_id": row["real_id"], "avatar": row["avatar"] or "", "bio": row["bio"] or ""}


def db():
    connection = sqlite3.connect(DB_PATH, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA busy_timeout = 5000")
    return connection


def init_db():
    connection = db()
    connection.execute("PRAGMA journal_mode = WAL")
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    os.makedirs(ASSET_DIR, exist_ok=True)
    connection.executescript("""
        CREATE TABLE IF NOT EXISTS members (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            real_id TEXT UNIQUE NOT NULL,
            avatar TEXT,
            bio TEXT,
            password_hash TEXT,
            password_salt TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS ideas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            member_id INTEGER NOT NULL,
            content TEXT NOT NULL,
            image TEXT,
            idea_type TEXT NOT NULL DEFAULT 'gameplay',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(member_id) REFERENCES members(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS likes (
            idea_id INTEGER NOT NULL,
            member_id INTEGER NOT NULL,
            PRIMARY KEY(idea_id, member_id),
            FOREIGN KEY(idea_id) REFERENCES ideas(id) ON DELETE CASCADE,
            FOREIGN KEY(member_id) REFERENCES members(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS comments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            idea_id INTEGER NOT NULL,
            member_id INTEGER NOT NULL,
            content TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(idea_id) REFERENCES ideas(id) ON DELETE CASCADE,
            FOREIGN KEY(member_id) REFERENCES members(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            member_id INTEGER NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(member_id) REFERENCES members(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS documents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            category TEXT NOT NULL,
            title TEXT NOT NULL,
            content TEXT NOT NULL DEFAULT '',
            author_id INTEGER NOT NULL,
            updated_by INTEGER NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(author_id) REFERENCES members(id) ON DELETE CASCADE,
            FOREIGN KEY(updated_by) REFERENCES members(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS document_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            document_id INTEGER NOT NULL,
            member_id INTEGER NOT NULL,
            action TEXT NOT NULL,
            title TEXT NOT NULL DEFAULT '',
            content TEXT NOT NULL DEFAULT '',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE,
            FOREIGN KEY(member_id) REFERENCES members(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            task_type TEXT NOT NULL,
            priority TEXT NOT NULL DEFAULT 'medium',
            status TEXT NOT NULL DEFAULT 'todo',
            author_id INTEGER NOT NULL,
            assignee_id INTEGER,
            estimated_hours REAL,
            due_date TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(author_id) REFERENCES members(id) ON DELETE CASCADE,
            FOREIGN KEY(assignee_id) REFERENCES members(id) ON DELETE SET NULL
        );
        CREATE TABLE IF NOT EXISTS project_settings (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            name TEXT NOT NULL DEFAULT '',
            icon TEXT NOT NULL DEFAULT '',
            updated_by INTEGER,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(updated_by) REFERENCES members(id) ON DELETE SET NULL
        );
        CREATE TABLE IF NOT EXISTS assets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            member_id INTEGER NOT NULL,
            filename TEXT NOT NULL,
            stored_name TEXT NOT NULL,
            category TEXT NOT NULL DEFAULT 'visual',
            mime TEXT NOT NULL DEFAULT '',
            size INTEGER NOT NULL DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(member_id) REFERENCES members(id) ON DELETE CASCADE
        );
    """)
    columns = {row[1] for row in connection.execute("PRAGMA table_info(members)").fetchall()}
    if "avatar" not in columns:
        connection.execute("ALTER TABLE members ADD COLUMN avatar TEXT")
    if "bio" not in columns:
        connection.execute("ALTER TABLE members ADD COLUMN bio TEXT")
    if "password_hash" not in columns:
        connection.execute("ALTER TABLE members ADD COLUMN password_hash TEXT")
    if "password_salt" not in columns:
        connection.execute("ALTER TABLE members ADD COLUMN password_salt TEXT")
    idea_columns = {row[1] for row in connection.execute("PRAGMA table_info(ideas)").fetchall()}
    if "idea_type" not in idea_columns:
        connection.execute("ALTER TABLE ideas ADD COLUMN idea_type TEXT NOT NULL DEFAULT 'gameplay'")
    history_columns = {row[1] for row in connection.execute("PRAGMA table_info(document_history)").fetchall()}
    if "title" not in history_columns:
        connection.execute("ALTER TABLE document_history ADD COLUMN title TEXT NOT NULL DEFAULT ''")
    if "content" not in history_columns:
        connection.execute("ALTER TABLE document_history ADD COLUMN content TEXT NOT NULL DEFAULT ''")
    connection.commit()
    connection.close()


# --------------------------------------------------------------------------
# 富文本文档净化：白名单标签 + 属性白名单，其余一律按纯文本保留
# --------------------------------------------------------------------------
VOID_TAGS = {"br", "hr"}
ALLOWED_TAGS = {
    "p", "div", "br", "h1", "h2", "h3", "h4", "h5", "h6",
    "b", "strong", "i", "em", "u", "s", "strike",
    "ul", "ol", "li", "blockquote", "pre", "code",
    "a", "hr", "table", "thead", "tbody", "tr", "td", "th",
}
ALLOWED_ATTRS = {
    "a": {"href"},
    "ol": {"start"},
    "td": {"colspan", "rowspan"},
    "th": {"colspan", "rowspan"},
}


class _SanitizeParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.buffer = []

    @staticmethod
    def _attr_safe(tag, name, value):
        if value is None:
            return False
        if tag == "a" and name == "href":
            try:
                scheme = urlsplit(value.strip()).scheme.lower()
            except ValueError:
                return False
            return scheme in ("http", "https", "mailto")
        if name in ("colspan", "rowspan"):
            return value.isdigit() and 1 <= int(value) <= 100
        return True

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        if tag not in ALLOWED_TAGS:
            return
        self.buffer.append("<" + tag)
        for raw_name, value in attrs:
            name = raw_name.lower()
            if name not in ALLOWED_ATTRS.get(tag, ()) or not self._attr_safe(tag, name, value):
                continue
            self.buffer.append(' %s="%s"' % (name, html.escape(value, quote=True)))
        self.buffer.append(">")

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)

    def handle_endtag(self, tag):
        tag = tag.lower()
        if tag in ALLOWED_TAGS and tag not in VOID_TAGS:
            self.buffer.append("</%s>" % tag)

    def handle_data(self, data):
        self.buffer.append(html.escape(data, quote=False))

    def handle_comment(self, data):
        pass

    def unknown_decl(self, data):
        pass

    def handle_pi(self, data):
        pass


def sanitize_html(value):
    """去除文档 HTML 中的脚本/事件属性/危险协议，只保留白名单结构。"""
    if not isinstance(value, str):
        return ""
    parser = _SanitizeParser()
    try:
        parser.feed(value)
        parser.close()
    except Exception:
        return html.escape(value, quote=False)
    return "".join(parser.buffer)


# --------------------------------------------------------------------------
# 文档历史快照 / 版本差异 / 回滚
# --------------------------------------------------------------------------
DOC_HISTORY_KEEP = 120  # 每个文档最多保留的版本快照数

TEXT_BLOCK_TAGS = {
    "p", "div", "li", "h1", "h2", "h3", "h4", "h5", "h6",
    "blockquote", "pre", "tr", "table", "thead", "tbody",
    "ul", "ol", "figure", "figcaption",
}


class _TextExtractor(HTMLParser):
    """把文档 HTML 提取为便于 diff 的文本行（块级标签处断行）。"""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []

    def _break(self):
        self.parts.append("\n")

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        if tag in TEXT_BLOCK_TAGS or tag == "br":
            self._break()

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)

    def handle_endtag(self, tag):
        if tag.lower() in TEXT_BLOCK_TAGS:
            self._break()

    def handle_data(self, data):
        self.parts.append(data)


def html_to_text_lines(value):
    """返回非空文本行列表，供版本 diff 使用。"""
    parser = _TextExtractor()
    try:
        parser.feed(value or "")
        parser.close()
    except Exception:
        return []
    lines = []
    for raw in "".join(parser.parts).split("\n"):
        line = re.sub(r"\s+", " ", raw).strip()
        if line:
            lines.append(line)
    return lines


DIFF_MAX_CELLS = 800000


def diff_lines(old_lines, new_lines):
    """经典 LCS 行级 diff，返回 [('same'|'del'|'add', 行文本), ...] 的有序序列。"""
    n, m = len(old_lines), len(new_lines)
    if n * m > DIFF_MAX_CELLS:
        # 内容过大退化为「全部替换」，保证永远有可用结果
        return [("del", line) for line in old_lines] + [("add", line) for line in new_lines]
    dp = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n - 1, -1, -1):
        row, row_next = dp[i], dp[i + 1]
        for j in range(m - 1, -1, -1):
            row[j] = row_next[j + 1] + 1 if old_lines[i] == new_lines[j] else max(row_next[j], row[j + 1])
    ops = []
    i = j = 0
    while i < n and j < m:
        if old_lines[i] == new_lines[j]:
            ops.append(("same", old_lines[i]))
            i += 1
            j += 1
        elif dp[i + 1][j] >= dp[i][j + 1]:
            ops.append(("del", old_lines[i]))
            i += 1
        else:
            ops.append(("add", new_lines[j]))
            j += 1
    while i < n:
        ops.append(("del", old_lines[i]))
        i += 1
    while j < m:
        ops.append(("add", new_lines[j]))
        j += 1
    return ops


def prune_document_history(connection, document_id):
    connection.execute(
        """
        DELETE FROM document_history WHERE document_id = ? AND id NOT IN (
            SELECT id FROM document_history WHERE document_id = ?
            ORDER BY id DESC LIMIT ?
        )
        """,
        (document_id, document_id, DOC_HISTORY_KEEP),
    )


def revision_snapshot_diff(connection, document_id, history_id):
    """返回 (data | None, error_status, error_message)。"""
    row = connection.execute(
        """
        SELECT document_history.id, document_history.title, document_history.content,
          document_history.action, document_history.created_at, members.real_id
        FROM document_history JOIN members ON members.id = document_history.member_id
        WHERE document_history.id = ? AND document_history.document_id = ?
        """,
        (history_id, document_id),
    ).fetchone()
    if not row:
        return None, 404, "版本不存在"
    prev = connection.execute(
        "SELECT title, content FROM document_history WHERE document_id = ? AND id < ? ORDER BY id DESC LIMIT 1",
        (document_id, history_id),
    ).fetchone()
    old_title = prev["title"] if prev else ""
    old_lines = html_to_text_lines(prev["content"] if prev else "")
    new_lines = html_to_text_lines(row["content"])
    ops = diff_lines(old_lines, new_lines)
    added = sum(1 for kind, _ in ops if kind == "add")
    removed = sum(1 for kind, _ in ops if kind == "del")
    return {
        "history_id": row["id"],
        "action": row["action"],
        "created_at": row["created_at"],
        "member": row["real_id"],
        "old_title": old_title,
        "new_title": row["title"],
        "ops": ops,
        "added": added,
        "removed": removed,
        "empty": not prev,
    }, 200, None


def rollback_document(connection, document_id, history_id, member_id):
    """把文档恢复到某个历史快照，并新记一条回滚动作。返回 (data|None, status, message)。"""
    entry = connection.execute(
        "SELECT id, title, content FROM document_history WHERE id = ? AND document_id = ?",
        (history_id, document_id),
    ).fetchone()
    if not entry:
        return None, 404, "版本不存在"
    title = entry["title"].strip() or entry["title"]
    content = entry["content"]
    connection.execute(
        "UPDATE documents SET title = ?, content = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        (title, content, member_id, document_id),
    )
    connection.execute(
        "INSERT INTO document_history (document_id, member_id, action, title, content) VALUES (?, ?, ?, ?, ?)",
        (document_id, member_id, "回滚到历史版本", title, content),
    )
    prune_document_history(connection, document_id)
    connection.commit()
    return {"ok": True, "document_id": document_id, "restored_history_id": entry["id"]}, 200, None


# --------------------------------------------------------------------------
# 任务字段校验（POST 与 PUT 共用）
# --------------------------------------------------------------------------
TASK_TYPES = ("planning", "art", "programming", "audio", "other")
TASK_PRIORITIES = ("low", "medium", "high", "urgent")
TASK_STATUSES = ("todo", "in_progress", "review", "done")


def normalize_task_payload(payload):
    """校验并规范化任务字段；只处理 payload 中出现的键，供 POST/PUT 复用。异常抛出带中文的 ValueError。"""
    if not isinstance(payload, dict):
        raise ValueError("任务数据无效")
    result = {}
    if "title" in payload:
        raw_title = payload["title"]
        title = "" if raw_title is None else str(raw_title).strip()
        if not title or len(title) > 150:
            raise ValueError("任务标题需 1 到 150 字")
        result["title"] = title
    if "description" in payload:
        raw_description = payload["description"]
        description = "" if raw_description is None else str(raw_description).strip()
        if len(description) > 5000:
            raise ValueError("任务描述不能超过 5000 字")
        result["description"] = description
    if "task_type" in payload:
        task_type = str(payload["task_type"])
        if task_type not in TASK_TYPES:
            raise ValueError("任务类型无效")
        result["task_type"] = task_type
    if "priority" in payload:
        priority = str(payload["priority"])
        if priority not in TASK_PRIORITIES:
            raise ValueError("任务优先级无效")
        result["priority"] = priority
    if "status" in payload:
        status = str(payload["status"])
        if status not in TASK_STATUSES:
            raise ValueError("任务状态无效")
        result["status"] = status
    if "assignee_id" in payload:
        raw = payload["assignee_id"]
        if raw in ("", None):
            result["assignee_id"] = None
        else:
            try:
                assignee_id = int(raw)
            except (TypeError, ValueError):
                raise ValueError("指派成员无效")
            if assignee_id <= 0:
                raise ValueError("指派成员无效")
            result["assignee_id"] = assignee_id
    if "estimated_hours" in payload:
        raw = payload["estimated_hours"]
        if raw in ("", None):
            result["estimated_hours"] = None
        else:
            try:
                hours = float(raw)
            except (TypeError, ValueError):
                raise ValueError("预计工时无效")
            if hours < 0 or hours > 10000:
                raise ValueError("预计工时无效")
            result["estimated_hours"] = hours
    if "due_date" in payload:
        raw = payload["due_date"]
        result["due_date"] = str(raw).strip() or None
        if result["due_date"] and len(result["due_date"]) > 20:
            raise ValueError("预计完成时间无效")
    if not result:
        raise ValueError("没有需要保存的字段")
    return result


def task_assignee_exists(connection, assignee_id):
    if assignee_id is None:
        return True
    return connection.execute("SELECT 1 FROM members WHERE id = ?", (assignee_id,)).fetchone() is not None


# --------------------------------------------------------------------------
# 图片上传：dataURL -> 磁盘文件，返回可访问的 /uploads/... 路径
# --------------------------------------------------------------------------
def save_data_image(payload, label, max_bytes):
    if not payload:
        return ""
    if payload.startswith("/uploads/"):
        return payload
    if not payload.startswith("data:image/"):
        raise ValueError("%s格式无效" % label)
    try:
        header, encoded = payload.split(",", 1)
        mime = header[5:].split(";", 1)[0].strip().lower()
        extension = IMAGE_EXT.get(mime)
        if not extension:
            raise ValueError("仅支持 PNG、JPG、GIF、WebP 图片")
        raw = base64.b64decode(encoded, validate=True)
    except (ValueError, TypeError):
        raise ValueError("%s格式无效" % label)
    if len(raw) > max_bytes:
        raise ValueError("%s不能超过 %d MB" % (label, max_bytes // (1024 * 1024)))
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    filename = secrets.token_hex(12) + extension
    with open(os.path.join(UPLOAD_DIR, filename), "wb") as file:
        file.write(raw)
    return "/uploads/" + filename


def remove_upload(url):
    """删除 /uploads/ 下的旧图片文件（尽力而为，失败不报错）。"""
    if not url or not url.startswith("/uploads/"):
        return
    try:
        path = os.path.abspath(os.path.join(UPLOAD_DIR, os.path.basename(url)))
        if path.startswith(os.path.abspath(UPLOAD_DIR)) and os.path.isfile(path):
            os.remove(path)
    except OSError:
        pass


# --------------------------------------------------------------------------
# 素材资产：dataURL -> uploads/assets/ 磁盘文件
# --------------------------------------------------------------------------
def asset_mime_allowed(mime):
    if not mime or mime in ASSET_DANGEROUS_MIME:
        return False
    if mime.startswith(("image/", "audio/", "video/", "model/")):
        return True
    return mime in (
        "application/octet-stream", "application/zip", "application/x-zip-compressed",
        "application/gzip", "application/pdf", "application/json",
        "text/plain", "text/csv", "text/markdown",
    )


def clean_asset_filename(filename):
    base = os.path.basename((filename or "file").replace("\\", "/")).strip() or "file"
    base = re.sub(r"[^\w\u4e00-\u9fff. -]", "_", base)
    base = re.sub(r"\s+", " ", base).strip(" .")
    if not base:
        base = "file"
    if len(base) > 120:
        root, ext = os.path.splitext(base)
        base = root[:108] + ext
    return base


def save_asset_data(data_url, filename):
    """校验并落盘一个素材文件，返回 (mime, size, url, stored_name)。"""
    if not isinstance(data_url, str) or not data_url.startswith("data:"):
        raise ValueError("文件数据无效")
    try:
        header, encoded = data_url.split(",", 1)
        parts = header[5:].split(";")
        mime = (parts[0].strip().lower() or "application/octet-stream")
        if "base64" not in parts:
            raise ValueError("文件数据无效")
        raw = base64.b64decode(encoded, validate=True)
    except (ValueError, TypeError):
        raise ValueError("文件数据无效")
    if not asset_mime_allowed(mime):
        raise ValueError("不支持该文件类型")
    if len(raw) > MAX_ASSET_BYTES:
        raise ValueError("文件不能超过 60 MB")
    extension = os.path.splitext(filename)[1].lower()
    if not extension or len(extension) > 8 or not re.fullmatch(r"\.[a-z0-9]+", extension):
        extension = ASSET_MIME_EXT.get(mime, "")
    os.makedirs(ASSET_DIR, exist_ok=True)
    stored_name = secrets.token_hex(12) + extension
    with open(os.path.join(ASSET_DIR, stored_name), "wb") as file:
        file.write(raw)
    return mime, len(raw), "/uploads/assets/" + stored_name, stored_name


def remove_asset_file(stored_name):
    if not stored_name:
        return
    try:
        path = os.path.abspath(os.path.join(ASSET_DIR, os.path.basename(stored_name)))
        if path.startswith(os.path.abspath(ASSET_DIR)) and os.path.isfile(path):
            os.remove(path)
    except OSError:
        pass


# --------------------------------------------------------------------------
# 会话过期
# --------------------------------------------------------------------------
def session_expired(created_at):
    try:
        created = datetime.strptime(created_at, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
    except (ValueError, TypeError):
        return True
    return datetime.now(timezone.utc) - created > timedelta(days=SESSION_TTL_DAYS)


def purge_expired_sessions():
    try:
        with db() as connection:
            connection.execute("DELETE FROM sessions WHERE created_at < datetime('now', ?)", ("-%d days" % SESSION_TTL_DAYS,))
            connection.commit()
    except sqlite3.Error:
        pass


def idea_rows(connection, current_member):
    rows = connection.execute("""
        SELECT ideas.id, ideas.member_id, ideas.content, ideas.image, ideas.idea_type, ideas.created_at, members.real_id, members.avatar,
          (SELECT COUNT(*) FROM likes WHERE idea_id = ideas.id) AS likes,
          (SELECT COUNT(*) FROM comments WHERE idea_id = ideas.id) AS comments,
          EXISTS(SELECT 1 FROM likes WHERE idea_id = ideas.id AND member_id = ?) AS liked
        FROM ideas JOIN members ON members.id = ideas.member_id
        ORDER BY ideas.created_at DESC, ideas.id DESC
    """, (current_member,)).fetchall()
    result = []
    for row in rows:
        comments = connection.execute("""
            SELECT comments.id, comments.member_id, comments.content, members.real_id, members.avatar FROM comments
            JOIN members ON members.id = comments.member_id
            WHERE comments.idea_id = ? ORDER BY comments.id ASC
        """, (row["id"],)).fetchall()
        comment_items = [{"id": item["id"], "real_id": item["real_id"], "avatar": item["avatar"] or "", "content": item["content"], "owned": item["member_id"] == current_member} for item in comments]
        result.append({"id": row["id"], "name": row["real_id"], "avatar": row["avatar"] or "", "content": row["content"], "image": row["image"] or "", "idea_type": row["idea_type"], "created_at": row["created_at"], "likes": row["likes"], "comments": row["comments"], "liked": bool(row["liked"]), "owned": row["member_id"] == current_member, "comment_items": comment_items})
    return result


class Handler(BaseHTTPRequestHandler):
    def json_response(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def read_json(self, max_bytes=8 * 1024 * 1024):
        length = int(self.headers.get("Content-Length", "0"))
        if length > max_bytes:
            raise ValueError("payload too large")
        return json.loads(self.rfile.read(length) or "{}")

    def member(self, required=True):
        token = self.headers.get("X-Session")
        member_id = SESSIONS.get(token)
        if token and not member_id:
            with db() as connection:
                row = connection.execute("SELECT member_id, created_at FROM sessions WHERE token = ?", (token,)).fetchone()
            if row and not session_expired(row["created_at"]):
                member_id = row["member_id"]
                SESSIONS[token] = member_id
            elif row:
                with db() as connection:
                    connection.execute("DELETE FROM sessions WHERE token = ?", (token,))
                    connection.commit()
                SESSIONS.pop(token, None)
        if required and not member_id:
            self.json_response({"error": "请先使用实名 ID 登录"}, 401)
            return None
        return member_id

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        if path == "/api/session":
            member_id = self.member(False)
            if not member_id:
                return self.json_response({"member": None})
            with db() as connection:
                row = connection.execute("SELECT id, real_id, avatar, bio FROM members WHERE id = ?", (member_id,)).fetchone()
            return self.json_response({"member": public_member(row) if row else None})
        if path == "/api/members":
            with db() as connection:
                rows = connection.execute("SELECT id, real_id, avatar, bio FROM members ORDER BY id ASC").fetchall()
            return self.json_response({"members": [public_member(row) for row in rows]})
        if path == "/api/project":
            with db() as connection:
                row = connection.execute("SELECT name, icon, updated_at FROM project_settings WHERE id = 1").fetchone()
            return self.json_response({"project": dict(row) if row else {"name": "", "icon": "", "updated_at": None}})
        if path == "/api/ideas":
            member_id = self.member(False) or 0
            with db() as connection:
                return self.json_response({"ideas": idea_rows(connection, member_id)})
        if path == "/api/tasks":
            with db() as connection:
                rows = connection.execute("""
                    SELECT tasks.id, tasks.title, tasks.description, tasks.task_type, tasks.priority, tasks.status,
                      tasks.estimated_hours, tasks.due_date, tasks.created_at, tasks.updated_at,
                      tasks.author_id AS author_id, tasks.assignee_id AS assignee_id,
                      author.real_id AS author, assignee.real_id AS assignee, assignee.avatar AS assignee_avatar
                    FROM tasks JOIN members author ON author.id = tasks.author_id
                    LEFT JOIN members assignee ON assignee.id = tasks.assignee_id
                    ORDER BY CASE tasks.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
                      tasks.due_date IS NULL, tasks.due_date ASC, tasks.id DESC
                """).fetchall()
            return self.json_response({"tasks": [dict(row) for row in rows]})
        if path == "/api/documents":
            category = parse_qs(parsed.query).get("category", ["planning"])[0]
            if category not in ("planning", "environment"):
                return self.json_response({"error": "文档类型无效"}, 400)
            with db() as connection:
                rows = connection.execute("""
                    SELECT documents.id, documents.title, documents.category, documents.created_at, documents.updated_at,
                      author.real_id AS author, updater.real_id AS updated_by,
                      (SELECT COUNT(*) FROM document_history WHERE document_id = documents.id) AS history_count
                    FROM documents
                    JOIN members author ON author.id = documents.author_id
                    JOIN members updater ON updater.id = documents.updated_by
                    WHERE documents.category = ? ORDER BY documents.updated_at DESC, documents.id DESC
                """, (category,)).fetchall()
            return self.json_response({"documents": [dict(row) for row in rows]})
        if path.startswith("/api/documents/"):
            parts = path.strip("/").split("/")
            if len(parts) == 4 and parts[1] == "documents" and parts[3] == "export":
                try:
                    document_id = int(parts[2])
                except ValueError:
                    return self.json_response({"error": "文档不存在"}, 404)
                with db() as connection:
                    row = connection.execute("SELECT title, content FROM documents WHERE id = ?", (document_id,)).fetchone()
                if not row:
                    return self.json_response({"error": "文档不存在"}, 404)
                return self.json_response({
                    "title": row["title"],
                    "text": "\n".join(html_to_text_lines(row["content"])),
                    "html": sanitize_html(row["content"] or ""),
                })
            if len(parts) == 6 and parts[1] == "documents" and parts[3] == "revisions" and parts[5] == "diff":
                try:
                    document_id = int(parts[2])
                    history_id = int(parts[4])
                except ValueError:
                    return self.json_response({"error": "版本不存在"}, 404)
                with db() as connection:
                    data, status, message = revision_snapshot_diff(connection, document_id, history_id)
                if data is None:
                    return self.json_response({"error": message}, status)
                return self.json_response(data)
            try:
                document_id = int(path.rsplit("/", 1)[1])
            except ValueError:
                return self.json_response({"error": "文档不存在"}, 404)
            with db() as connection:
                row = connection.execute("""
                    SELECT documents.id, documents.title, documents.content, documents.category, documents.created_at, documents.updated_at,
                      author.real_id AS author, updater.real_id AS updated_by
                    FROM documents JOIN members author ON author.id = documents.author_id
                    JOIN members updater ON updater.id = documents.updated_by WHERE documents.id = ?
                """, (document_id,)).fetchone()
                if not row:
                    return self.json_response({"error": "文档不存在"}, 404)
                history = connection.execute("""
                    SELECT document_history.id, document_history.action, document_history.created_at, members.real_id
                    FROM document_history JOIN members ON members.id = document_history.member_id
                    WHERE document_history.document_id = ? ORDER BY document_history.id DESC LIMIT ?
                """, (document_id, DOC_HISTORY_KEEP)).fetchall()
            document = dict(row)
            document["content"] = sanitize_html(document.get("content") or "")
            return self.json_response({"document": document, "history": [dict(item) for item in history]})
        if path == "/api/overview":
            with db() as connection:
                project = connection.execute("SELECT name, icon, updated_at FROM project_settings WHERE id = 1").fetchone()
                def count_sql(sql):
                    return connection.execute(sql).fetchone()[0]
                status_rows = connection.execute("SELECT status, COUNT(*) AS c FROM tasks GROUP BY status").fetchall()
                type_rows = connection.execute("SELECT task_type, COUNT(*) AS c FROM tasks GROUP BY task_type").fetchall()
                priority_rows = connection.execute("SELECT priority, COUNT(*) AS c FROM tasks GROUP BY priority").fetchall()
                hours_total = connection.execute("SELECT COALESCE(SUM(estimated_hours), 0) FROM tasks").fetchone()[0]
                hours_done = connection.execute("SELECT COALESCE(SUM(estimated_hours), 0) FROM tasks WHERE status = 'done'").fetchone()[0]
                recent_ideas = connection.execute("""
                    SELECT ideas.id, ideas.content, ideas.idea_type, ideas.created_at,
                      members.real_id, members.avatar,
                      (SELECT COUNT(*) FROM likes WHERE likes.idea_id = ideas.id) AS likes,
                      (SELECT COUNT(*) FROM comments WHERE comments.idea_id = ideas.id) AS comments
                    FROM ideas JOIN members ON members.id = ideas.member_id
                    ORDER BY ideas.created_at DESC, ideas.id DESC LIMIT 6
                """).fetchall()
                recent_documents = connection.execute("""
                    SELECT documents.id, documents.title, documents.category, documents.updated_at,
                      author.real_id AS author, updater.real_id AS updated_by
                    FROM documents
                    JOIN members author ON author.id = documents.author_id
                    JOIN members updater ON updater.id = documents.updated_by
                    ORDER BY documents.updated_at DESC, documents.id DESC LIMIT 6
                """).fetchall()
                recent_tasks = connection.execute("""
                    SELECT tasks.id, tasks.title, tasks.task_type, tasks.status, tasks.priority, tasks.updated_at, tasks.assignee_id,
                      author.real_id AS author, assignee.real_id AS assignee
                    FROM tasks
                    JOIN members author ON author.id = tasks.author_id
                    LEFT JOIN members assignee ON assignee.id = tasks.assignee_id
                    ORDER BY tasks.updated_at DESC, tasks.id DESC LIMIT 6
                """).fetchall()
            task_by_status = {name: 0 for name in TASK_STATUSES}
            task_by_status.update({row["status"]: row["c"] for row in status_rows})
            task_by_type = {name: 0 for name in TASK_TYPES}
            task_by_type.update({row["task_type"]: row["c"] for row in type_rows})
            task_by_priority = {name: 0 for name in TASK_PRIORITIES}
            task_by_priority.update({row["priority"]: row["c"] for row in priority_rows})
            idea_items = []
            for row in recent_ideas:
                text = re.sub(r"\s+", " ", row["content"]).strip()
                idea_items.append({
                    "id": row["id"], "name": row["real_id"], "avatar": row["avatar"] or "",
                    "content": text[:160] + ("…" if len(text) > 160 else ""),
                    "idea_type": row["idea_type"], "created_at": row["created_at"],
                    "likes": row["likes"], "comments": row["comments"],
                })
            return self.json_response({
                "project": dict(project) if project else {"name": "", "icon": "", "updated_at": None},
                "counts": {
                    "members": count_sql("SELECT COUNT(*) FROM members"),
                    "ideas": count_sql("SELECT COUNT(*) FROM ideas"),
                    "comments": count_sql("SELECT COUNT(*) FROM comments"),
                    "tasks": count_sql("SELECT COUNT(*) FROM tasks"),
                    "documents": count_sql("SELECT COUNT(*) FROM documents"),
                },
                "tasks_by_status": task_by_status,
                "tasks_by_type": task_by_type,
                "tasks_by_priority": task_by_priority,
                "hours": {"total": hours_total, "done": hours_done},
                "recent_ideas": idea_items,
                "recent_documents": [dict(row) for row in recent_documents],
                "recent_tasks": [dict(row) for row in recent_tasks],
            })
        if path == "/api/assets":
            category = parse_qs(parsed.query).get("category", ["all"])[0]
            if category != "all" and category not in ASSET_CATEGORIES:
                return self.json_response({"error": "素材分类无效"}, 400)
            with db() as connection:
                if category == "all":
                    rows = connection.execute("""
                        SELECT assets.id, assets.filename, assets.stored_name, assets.category, assets.mime,
                          assets.size, assets.created_at, assets.member_id AS author_id,
                          members.real_id AS author, members.avatar
                        FROM assets JOIN members ON members.id = assets.member_id
                        ORDER BY assets.created_at DESC, assets.id DESC
                    """).fetchall()
                else:
                    rows = connection.execute("""
                        SELECT assets.id, assets.filename, assets.stored_name, assets.category, assets.mime,
                          assets.size, assets.created_at, assets.member_id AS author_id,
                          members.real_id AS author, members.avatar
                        FROM assets JOIN members ON members.id = assets.member_id
                        WHERE assets.category = ?
                        ORDER BY assets.created_at DESC, assets.id DESC
                    """, (category,)).fetchall()
                total = connection.execute("SELECT COUNT(*) FROM assets").fetchone()[0]
            items = []
            for row in rows:
                item = dict(row)
                item["url"] = "/uploads/assets/" + item.pop("stored_name")
                item["avatar"] = item.get("avatar") or ""
                items.append(item)
            return self.json_response({"assets": items, "total": total})
        self.serve_static(path)

    def do_POST(self):
        path = urlparse(self.path).path
        if path == "/api/assets":
            return self.handle_asset_upload()
        try:
            payload = self.read_json()
        except (ValueError, json.JSONDecodeError):
            return self.json_response({"error": "请求数据无效"}, 400)
        if path == "/api/logout":
            token = self.headers.get("X-Session")
            member_id = self.member()
            if not member_id:
                return
            SESSIONS.pop(token, None)
            if token:
                with db() as connection:
                    connection.execute("DELETE FROM sessions WHERE token = ?", (token,))
                    connection.commit()
            return self.json_response({"ok": True})
        if path == "/api/login":
            real_id = str(payload.get("real_id", "")).strip()
            password = str(payload.get("password", ""))
            with db() as connection:
                member = connection.execute("SELECT id, real_id, avatar, bio, password_hash, password_salt FROM members WHERE real_id = ?", (real_id,)).fetchone()
            if not member or not member["password_hash"]:
                return self.json_response({"error": "账号不存在，请先注册"}, 401)
            _, supplied_hash = hash_password(password, member["password_salt"])
            if not hmac.compare_digest(supplied_hash, member["password_hash"]):
                return self.json_response({"error": "账号或密码错误"}, 401)
            member_id = member["id"]
            token = secrets.token_urlsafe(24)
            SESSIONS[token] = member_id
            with db() as connection:
                connection.execute("INSERT INTO sessions (token, member_id) VALUES (?, ?)", (token, member_id))
                connection.commit()
            purge_expired_sessions()
            return self.json_response({"member": public_member(member), "token": token})
        if path == "/api/register":
            real_id = str(payload.get("real_id", "")).strip()
            password = str(payload.get("password", ""))
            bio = str(payload.get("bio", "")).strip()
            if len(real_id) < 2 or len(real_id) > 32:
                return self.json_response({"error": "名称 ID 需要 2 到 32 个字符"}, 400)
            if len(password) < 6 or len(password) > 128:
                return self.json_response({"error": "密码需要 6 到 128 个字符"}, 400)
            if len(bio) > 200:
                return self.json_response({"error": "自我介绍不能超过 200 字"}, 400)
            salt, password_hash = hash_password(password)
            with db() as connection:
                existing = connection.execute("SELECT id, password_hash FROM members WHERE real_id = ?", (real_id,)).fetchone()
                if existing and existing["password_hash"]:
                    return self.json_response({"error": "该名称 ID 已被注册"}, 409)
                if existing:
                    member_id = existing["id"]
                    connection.execute("UPDATE members SET password_hash = ?, password_salt = ?, bio = ? WHERE id = ?", (password_hash, salt, bio, member_id))
                else:
                    cursor = connection.execute("INSERT INTO members (real_id, bio, password_hash, password_salt) VALUES (?, ?, ?, ?)", (real_id, bio, password_hash, salt))
                    member_id = cursor.lastrowid
                connection.commit()
                member = connection.execute("SELECT id, real_id, avatar, bio FROM members WHERE id = ?", (member_id,)).fetchone()
            token = secrets.token_urlsafe(24)
            SESSIONS[token] = member_id
            with db() as connection:
                connection.execute("INSERT INTO sessions (token, member_id) VALUES (?, ?)", (token, member_id))
                connection.commit()
            return self.json_response({"member": public_member(member), "token": token}, 201)
        if path == "/api/profile":
            member_id = self.member()
            if not member_id:
                return
            bio = str(payload.get("bio", "")).strip()
            if len(bio) > 200:
                return self.json_response({"error": "自我介绍不能超过 200 字"}, 400)
            try:
                avatar = save_data_image(str(payload.get("avatar", "")), "头像", MAX_AVATAR_BYTES)
            except ValueError as error:
                return self.json_response({"error": str(error)}, 400)
            with db() as connection:
                old = connection.execute("SELECT avatar FROM members WHERE id = ?", (member_id,)).fetchone()
                connection.execute("UPDATE members SET avatar = ?, bio = ? WHERE id = ?", (avatar, bio, member_id))
                row = connection.execute("SELECT id, real_id, avatar, bio FROM members WHERE id = ?", (member_id,)).fetchone()
                connection.commit()
            if old and old["avatar"] != avatar:
                remove_upload(old["avatar"])
            return self.json_response({"member": public_member(row)})
        if path == "/api/project":
            member_id = self.member()
            if not member_id:
                return
            name = str(payload.get("name", "")).strip()
            if len(name) > 80:
                return self.json_response({"error": "项目名称不能超过 80 字"}, 400)
            try:
                icon = save_data_image(str(payload.get("icon", "")), "项目图标", MAX_ICON_BYTES)
            except ValueError as error:
                return self.json_response({"error": str(error)}, 400)
            with db() as connection:
                old = connection.execute("SELECT icon FROM project_settings WHERE id = 1").fetchone()
                connection.execute("""
                    INSERT INTO project_settings (id, name, icon, updated_by, updated_at) VALUES (1, ?, ?, ?, CURRENT_TIMESTAMP)
                    ON CONFLICT(id) DO UPDATE SET name=excluded.name, icon=excluded.icon, updated_by=excluded.updated_by, updated_at=CURRENT_TIMESTAMP
                """, (name, icon, member_id))
                connection.commit()
            if old and old["icon"] != icon:
                remove_upload(old["icon"])
            return self.json_response({"project": {"name": name, "icon": icon}})
        member_id = self.member()
        if not member_id:
            return
        if path == "/api/ideas":
            content = str(payload.get("content", "")).strip()
            idea_type = str(payload.get("idea_type", "gameplay"))
            if not content or len(content) > 5000:
                return self.json_response({"error": "动态内容不能为空且不能超过 5000 字"}, 400)
            if idea_type not in ("gameplay", "concept"):
                return self.json_response({"error": "创意类型无效"}, 400)
            try:
                image = save_data_image(str(payload.get("image", "")), "图片", MAX_IDEA_IMAGE_BYTES)
            except ValueError as error:
                return self.json_response({"error": str(error)}, 400)
            with db() as connection:
                connection.execute("INSERT INTO ideas (member_id, content, image, idea_type) VALUES (?, ?, ?, ?)", (member_id, content, image, idea_type))
                connection.commit()
            return self.json_response({"ideas": self.get_ideas(member_id)})
        if path == "/api/documents":
            title = str(payload.get("title", "")).strip()
            category = str(payload.get("category", "planning"))
            if not title or len(title) > 100:
                return self.json_response({"error": "文档标题不能为空且不能超过 100 字"}, 400)
            if category not in ("planning", "environment"):
                return self.json_response({"error": "文档类型无效"}, 400)
            with db() as connection:
                cursor = connection.execute("INSERT INTO documents (category, title, author_id, updated_by) VALUES (?, ?, ?, ?)", (category, title, member_id, member_id))
                document_id = cursor.lastrowid
                connection.execute(
                    "INSERT INTO document_history (document_id, member_id, action, title, content) VALUES (?, ?, ?, ?, ?)",
                    (document_id, member_id, "创建了文档", title, ""),
                )
                connection.commit()
            return self.json_response({"id": document_id}, 201)
        if path == "/api/tasks":
            fields = {
                "title": payload.get("title"),
                "description": payload.get("description", ""),
                "task_type": payload.get("task_type", "planning"),
                "priority": payload.get("priority", "medium"),
                "status": payload.get("status", "todo"),
                "assignee_id": payload.get("assignee_id"),
                "estimated_hours": payload.get("estimated_hours"),
                "due_date": payload.get("due_date", ""),
            }
            try:
                task = normalize_task_payload(fields)
            except ValueError as error:
                return self.json_response({"error": str(error)}, 400)
            if "title" not in task:
                return self.json_response({"error": "任务标题不能为空"}, 400)
            with db() as connection:
                if not task_assignee_exists(connection, task.get("assignee_id")):
                    return self.json_response({"error": "指派成员不存在"}, 400)
                cursor = connection.execute("""
                    INSERT INTO tasks (title, description, task_type, priority, status, author_id, assignee_id, estimated_hours, due_date)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (task["title"], task.get("description", ""), task.get("task_type", "planning"),
                      task.get("priority", "medium"), task.get("status", "todo"), member_id,
                      task.get("assignee_id"), task.get("estimated_hours"), task.get("due_date")))
                connection.commit()
            return self.json_response({"id": cursor.lastrowid}, 201)
        rollback_parts = path.strip("/").split("/")
        if len(rollback_parts) == 4 and rollback_parts[0] == "api" and rollback_parts[1] == "documents" and rollback_parts[3] == "duplicate":
            try:
                document_id = int(rollback_parts[2])
            except ValueError:
                return self.json_response({"error": "文档不存在"}, 404)
            with db() as connection:
                row = connection.execute("SELECT title, content, category FROM documents WHERE id = ?", (document_id,)).fetchone()
                if not row:
                    return self.json_response({"error": "文档不存在"}, 404)
                copy_title = row["title"]
                if not copy_title.endswith(("（副本）", "(copy)")):
                    copy_title = (copy_title[:88] + "（副本）") if len(copy_title) <= 90 else (copy_title[:90] + "（副本）")
                cursor = connection.execute(
                    "INSERT INTO documents (category, title, content, author_id, updated_by) VALUES (?, ?, ?, ?, ?)",
                    (row["category"], copy_title, row["content"], member_id, member_id),
                )
                new_id = cursor.lastrowid
                connection.execute(
                    "INSERT INTO document_history (document_id, member_id, action, title, content) VALUES (?, ?, ?, ?, ?)",
                    (new_id, member_id, "复制了文档", copy_title, row["content"]),
                )
                connection.commit()
            return self.json_response({"id": new_id}, 201)
        if len(rollback_parts) == 4 and rollback_parts[0] == "api" and rollback_parts[1] == "documents" and rollback_parts[3] == "rollback":
            try:
                document_id = int(rollback_parts[2])
                history_id = int(payload.get("history_id"))
            except (TypeError, ValueError):
                return self.json_response({"error": "请求数据无效"}, 400)
            with db() as connection:
                if not connection.execute("SELECT 1 FROM documents WHERE id = ?", (document_id,)).fetchone():
                    return self.json_response({"error": "文档不存在"}, 404)
                data, status, message = rollback_document(connection, document_id, history_id, member_id)
            if data is None:
                return self.json_response({"error": message}, status)
            return self.json_response(data)
        parts = path.strip("/").split("/")
        if len(parts) == 4 and parts[0] == "api" and parts[1] == "ideas":
            try:
                idea_id = int(parts[2])
            except ValueError:
                return self.json_response({"error": "动态不存在"}, 404)
            with db() as connection:
                exists = connection.execute("SELECT 1 FROM ideas WHERE id = ?", (idea_id,)).fetchone()
                if not exists:
                    return self.json_response({"error": "动态不存在"}, 404)
                if parts[3] == "like":
                    exists_like = connection.execute("SELECT 1 FROM likes WHERE idea_id = ? AND member_id = ?", (idea_id, member_id)).fetchone()
                    if exists_like:
                        connection.execute("DELETE FROM likes WHERE idea_id = ? AND member_id = ?", (idea_id, member_id))
                    else:
                        connection.execute("INSERT INTO likes (idea_id, member_id) VALUES (?, ?)", (idea_id, member_id))
                    connection.commit()
                    return self.json_response({"ideas": idea_rows(connection, member_id)})
                if parts[3] == "comments":
                    content = str(payload.get("content", "")).strip()
                    if not content or len(content) > 1000:
                        return self.json_response({"error": "评论不能为空且不能超过 1000 字"}, 400)
                    connection.execute("INSERT INTO comments (idea_id, member_id, content) VALUES (?, ?, ?)", (idea_id, member_id, content))
                    connection.commit()
                    return self.json_response({"ideas": idea_rows(connection, member_id)})
        if len(parts) == 3 and parts[0] == "api" and parts[1] == "ideas" and parts[2] == "delete":
            return self.json_response({"error": "接口参数无效"}, 400)
        return self.json_response({"error": "接口不存在"}, 404)

    def do_PUT(self):
        member_id = self.member()
        if not member_id:
            return
        path = urlparse(self.path).path
        if path.startswith("/api/tasks/"):
            try:
                task_id = int(path.rsplit("/", 1)[1])
                payload = self.read_json()
            except (ValueError, json.JSONDecodeError):
                return self.json_response({"error": "请求数据无效"}, 400)
            try:
                updates = normalize_task_payload(payload)
            except ValueError as error:
                return self.json_response({"error": str(error)}, 400)
            with db() as connection:
                if not connection.execute("SELECT 1 FROM tasks WHERE id = ?", (task_id,)).fetchone():
                    return self.json_response({"error": "任务不存在"}, 404)
                if not task_assignee_exists(connection, updates.get("assignee_id")):
                    return self.json_response({"error": "指派成员不存在"}, 400)
                sets = ", ".join("%s = ?" % column for column in updates)
                values = list(updates.values()) + [task_id]
                connection.execute(
                    "UPDATE tasks SET %s, updated_at = CURRENT_TIMESTAMP WHERE id = ?" % sets, values
                )
                connection.commit()
            return self.json_response({"saved": True})
        if not path.startswith("/api/documents/"):
            return self.json_response({"error": "接口不存在"}, 404)
        try:
            document_id = int(path.rsplit("/", 1)[1])
            payload = self.read_json()
        except (ValueError, json.JSONDecodeError):
            return self.json_response({"error": "请求数据无效"}, 400)
        title = str(payload.get("title", "")).strip()
        content = sanitize_html(str(payload.get("content", "")))
        if not title or len(title) > 100 or len(content) > 500000:
            return self.json_response({"error": "文档内容无效"}, 400)
        with db() as connection:
            exists = connection.execute("SELECT 1 FROM documents WHERE id = ?", (document_id,)).fetchone()
            if not exists:
                return self.json_response({"error": "文档不存在"}, 404)
            connection.execute("UPDATE documents SET title = ?, content = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", (title, content, member_id, document_id))
            connection.execute(
                "INSERT INTO document_history (document_id, member_id, action, title, content) VALUES (?, ?, ?, ?, ?)",
                (document_id, member_id, "修改了文档", title, content),
            )
            prune_document_history(connection, document_id)
            connection.commit()
        return self.json_response({"saved": True})

    def do_DELETE(self):
        member_id = self.member()
        if not member_id:
            return
        parts = urlparse(self.path).path.strip("/").split("/")
        if len(parts) == 3 and parts[0] == "api" and parts[1] == "tasks":
            try:
                task_id = int(parts[2])
            except ValueError:
                return self.json_response({"error": "任务不存在"}, 404)
            with db() as connection:
                if not connection.execute("SELECT 1 FROM tasks WHERE id = ?", (task_id,)).fetchone():
                    return self.json_response({"error": "任务不存在"}, 404)
                connection.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
                connection.commit()
            return self.json_response({"ok": True})
        if len(parts) == 3 and parts[0] == "api" and parts[1] == "documents":
            try:
                document_id = int(parts[2])
            except ValueError:
                return self.json_response({"error": "文档不存在"}, 404)
            with db() as connection:
                if not connection.execute("SELECT 1 FROM documents WHERE id = ?", (document_id,)).fetchone():
                    return self.json_response({"error": "文档不存在"}, 404)
                connection.execute("DELETE FROM documents WHERE id = ?", (document_id,))
                connection.commit()
            return self.json_response({"ok": True})
        if len(parts) == 3 and parts[0] == "api" and parts[1] == "assets":
            try:
                asset_id = int(parts[2])
            except ValueError:
                return self.json_response({"error": "素材不存在"}, 404)
            with db() as connection:
                row = connection.execute("SELECT member_id, stored_name FROM assets WHERE id = ?", (asset_id,)).fetchone()
                if not row:
                    return self.json_response({"error": "素材不存在"}, 404)
                if row["member_id"] != member_id:
                    return self.json_response({"error": "只能删除自己上传的素材"}, 403)
                connection.execute("DELETE FROM assets WHERE id = ?", (asset_id,))
                connection.commit()
            remove_asset_file(row["stored_name"])
            return self.json_response({"ok": True})
        if len(parts) == 3 and parts[0] == "api" and parts[1] == "ideas":
            try:
                idea_id = int(parts[2])
            except ValueError:
                return self.json_response({"error": "动态不存在"}, 404)
            with db() as connection:
                owner = connection.execute("SELECT member_id, image FROM ideas WHERE id = ?", (idea_id,)).fetchone()
                if not owner:
                    return self.json_response({"error": "动态不存在"}, 404)
                if owner["member_id"] != member_id:
                    return self.json_response({"error": "只能删除自己发布的动态"}, 403)
                connection.execute("DELETE FROM ideas WHERE id = ?", (idea_id,))
                connection.commit()
            remove_upload(owner["image"])
            return self.json_response({"ideas": self.get_ideas(member_id)})
        if len(parts) == 3 and parts[0] == "api" and parts[1] == "comments":
            try:
                comment_id = int(parts[2])
            except ValueError:
                return self.json_response({"error": "评论不存在"}, 404)
            with db() as connection:
                owner = connection.execute("SELECT member_id FROM comments WHERE id = ?", (comment_id,)).fetchone()
                if not owner:
                    return self.json_response({"error": "评论不存在"}, 404)
                if owner[0] != member_id:
                    return self.json_response({"error": "只能删除自己的评论"}, 403)
                connection.execute("DELETE FROM comments WHERE id = ?", (comment_id,))
                connection.commit()
            return self.json_response({"ideas": self.get_ideas(member_id)})
        return self.json_response({"error": "接口不存在"}, 404)

    def handle_asset_upload(self):
        member_id = self.member()
        if not member_id:
            return None
        try:
            payload = self.read_json(MAX_ASSET_BYTES + 16 * 1024 * 1024)
        except ValueError as error:
            too_large = "large" in str(error)
            return self.json_response({"error": "文件过大（最大 60 MB）" if too_large else "请求数据无效"}, 413 if too_large else 400)
        filename = clean_asset_filename(str(payload.get("filename", "")))
        category = str(payload.get("category", "other"))
        if category not in ASSET_CATEGORIES:
            return self.json_response({"error": "素材分类无效"}, 400)
        try:
            mime, size, url, stored_name = save_asset_data(str(payload.get("data", "")), filename)
        except ValueError as error:
            return self.json_response({"error": str(error)}, 400)
        with db() as connection:
            cursor = connection.execute(
                "INSERT INTO assets (member_id, filename, stored_name, category, mime, size) VALUES (?, ?, ?, ?, ?, ?)",
                (member_id, filename, stored_name, category, mime, size),
            )
            connection.commit()
            row = connection.execute("""
                SELECT assets.id, assets.filename, assets.category, assets.mime, assets.size, assets.created_at,
                  assets.member_id AS author_id, members.real_id AS author, members.avatar
                FROM assets JOIN members ON members.id = assets.member_id WHERE assets.id = ?
            """, (cursor.lastrowid,)).fetchone()
        asset = dict(row)
        asset["url"] = url
        asset["avatar"] = asset.get("avatar") or ""
        return self.json_response({"asset": asset}, 201)

    def get_ideas(self, member_id):
        with db() as connection:
            return idea_rows(connection, member_id)

    def serve_static(self, path):
        relative = "index.html" if path in ("", "/") else path.lstrip("/")
        if relative.startswith("uploads/"):
            full_path = os.path.abspath(os.path.join(UPLOAD_DIR, relative[len("uploads/"):]))
            root = os.path.abspath(UPLOAD_DIR)
        else:
            full_path = os.path.abspath(os.path.join(ROOT, relative))
            root = os.path.abspath(ROOT)
        if (full_path != root and not full_path.startswith(root + os.sep)) or not os.path.isfile(full_path):
            self.send_error(404)
            return
        content_type = mimetypes.guess_type(full_path)[0] or "application/octet-stream"
        with open(full_path, "rb") as file:
            body = file.read()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        print("[%s] %s" % (self.log_date_time_string(), format % args))


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description="NEXUS LAB 协作服务（无第三方依赖）")
    parser.add_argument("--host", default=HOST, help="监听地址，默认 127.0.0.1；局域网协作请用 0.0.0.0")
    parser.add_argument("--port", type=int, default=PORT, help="监听端口，默认 %d" % PORT)
    parser.add_argument("--db", default=DB_PATH, help="SQLite 数据库文件路径")
    parser.add_argument("--uploads", default=UPLOAD_DIR, help="上传文件存储目录")
    return parser.parse_args(argv)


if __name__ == "__main__":
    args = parse_args()
    DB_PATH = os.path.abspath(args.db)
    UPLOAD_DIR = os.path.abspath(args.uploads)
    ASSET_DIR = os.path.join(UPLOAD_DIR, "assets")
    HOST = args.host
    PORT = args.port
    init_db()
    purge_expired_sessions()
    print("NEXUS LAB server running at http://%s:%s" % (HOST, PORT))
    print("  db:      %s" % DB_PATH)
    print("  uploads: %s" % UPLOAD_DIR)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
