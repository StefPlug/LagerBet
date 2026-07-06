import json
import os
import sqlite3
from http.server import HTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from datetime import datetime

DB_PATH = os.path.join(os.path.dirname(__file__), "camp_bet.db")


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS Users (
            user_id INTEGER PRIMARY KEY,
            username TEXT UNIQUE NOT NULL,
            balance INTEGER DEFAULT 1000,
            role TEXT DEFAULT 'player',
            daily_bonus_last TEXT
        );
        CREATE TABLE IF NOT EXISTS Events (
            event_id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            deadline TEXT,
            status TEXT DEFAULT 'active'
        );
        CREATE TABLE IF NOT EXISTS Outcomes (
            outcome_id INTEGER PRIMARY KEY AUTOINCREMENT,
            event_id INTEGER,
            name TEXT,
            coefficient REAL,
            is_winner INTEGER DEFAULT 0,
            FOREIGN KEY (event_id) REFERENCES Events(event_id)
        );
        CREATE TABLE IF NOT EXISTS Bets (
            bet_id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            event_id INTEGER,
            outcome_id INTEGER,
            amount INTEGER,
            potential_win INTEGER,
            status TEXT DEFAULT 'pending',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES Users(user_id),
            FOREIGN KEY (event_id) REFERENCES Events(event_id),
            FOREIGN KEY (outcome_id) REFERENCES Outcomes(outcome_id)
        );
        CREATE TABLE IF NOT EXISTS Transactions (
            trans_id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            amount INTEGER,
            description TEXT,
            timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES Users(user_id)
        );
    """)
    conn.commit()
    conn.close()


def json_response(handler, data, status=200):
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.end_headers()
    handler.wfile.write(json.dumps(data, ensure_ascii=False).encode("utf-8"))


def read_body(handler):
    length = int(handler.headers.get("Content-Length", 0))
    if length == 0:
        return {}
    body = handler.rfile.read(length)
    return json.loads(body.decode("utf-8"))


class APIHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=os.path.join(os.path.dirname(__file__), "static"), **kwargs)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        params = parse_qs(parsed.query)

        if path == "/api/events":
            return self.get_events()
        elif path == "/api/event":
            event_id = int(params["id"][0])
            return self.get_event(event_id)
        elif path == "/api/bets":
            user_id = int(params["user_id"][0])
            return self.get_user_bets(user_id)
        elif path == "/api/balance":
            user_id = int(params["user_id"][0])
            return self.get_balance(user_id)
        elif path == "/api/transactions":
            user_id = int(params["user_id"][0])
            return self.get_transactions(user_id)
        elif path == "/api/leaderboard":
            return self.get_leaderboard()
        elif path == "/api/event_stats":
            event_id = int(params["event_id"][0])
            return self.get_event_stats(event_id)
        elif path == "/api/users":
            return self.get_users()
        else:
            return super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path
        data = read_body(self)

        if path == "/api/login":
            return self.login(data)
        elif path == "/api/register":
            return self.register(data)
        elif path == "/api/bet":
            return self.place_bet(data)
        elif path == "/api/daily_bonus":
            return self.daily_bonus(data)
        elif path == "/api/create_event":
            return self.create_event(data)
        elif path == "/api/complete_event":
            return self.complete_event(data)
        elif path == "/api/update_balance":
            return self.update_balance(data)
        else:
            self.send_error(404)

    def login(self, data):
        username = data.get("username", "").strip()
        conn = get_db()
        user = conn.execute("SELECT * FROM Users WHERE username = ?", (username,)).fetchone()
        conn.close()
        if user:
            return json_response(self, dict(user))
        return json_response(self, {"error": "Пользователь не найден"}, 404)

    def register(self, data):
        username = data.get("username", "").strip()
        if not username:
            return json_response(self, {"error": "Введите имя"}, 400)
        conn = get_db()
        try:
            conn.execute("INSERT INTO Users (username, balance, role) VALUES (?, 1000, 'player')", (username,))
            conn.commit()
            user = conn.execute("SELECT * FROM Users WHERE username = ?", (username,)).fetchone()
            conn.close()
            return json_response(self, dict(user))
        except sqlite3.IntegrityError:
            conn.close()
            return json_response(self, {"error": "Имя уже занято"}, 400)

    def get_events(self):
        conn = get_db()
        events = conn.execute("SELECT * FROM Events WHERE status = 'active'").fetchall()
        result = []
        for ev in events:
            outcomes = conn.execute("SELECT * FROM Outcomes WHERE event_id = ?", (ev["event_id"],)).fetchall()
            stats = conn.execute(
                """SELECT o.outcome_id, o.name, o.coefficient,
                   COUNT(b.bet_id) as bet_count, COALESCE(SUM(b.amount), 0) as total_amount
                   FROM Outcomes o LEFT JOIN Bets b ON o.outcome_id = b.outcome_id AND b.status = 'pending'
                   WHERE o.event_id = ? GROUP BY o.outcome_id""",
                (ev["event_id"],)
            ).fetchall()
            result.append({
                "event_id": ev["event_id"],
                "title": ev["title"],
                "deadline": ev["deadline"],
                "status": ev["status"],
                "outcomes": [dict(o) for o in outcomes],
                "stats": [dict(s) for s in stats],
            })
        conn.close()
        return json_response(self, result)

    def get_event(self, event_id):
        conn = get_db()
        ev = conn.execute("SELECT * FROM Events WHERE event_id = ?", (event_id,)).fetchone()
        if not ev:
            conn.close()
            return json_response(self, {"error": "Событие не найдено"}, 404)
        outcomes = conn.execute("SELECT * FROM Outcomes WHERE event_id = ?", (event_id,)).fetchall()
        conn.close()
        return json_response(self, {
            "event_id": ev["event_id"],
            "title": ev["title"],
            "deadline": ev["deadline"],
            "status": ev["status"],
            "outcomes": [dict(o) for o in outcomes],
        })

    def get_user_bets(self, user_id):
        conn = get_db()
        bets = conn.execute(
            """SELECT b.*, e.title, o.name as outcome_name, o.coefficient
               FROM Bets b JOIN Events e ON b.event_id = e.event_id
               JOIN Outcomes o ON b.outcome_id = o.outcome_id
               WHERE b.user_id = ? ORDER BY b.created_at DESC""",
            (user_id,)
        ).fetchall()
        conn.close()
        return json_response(self, [dict(b) for b in bets])

    def get_balance(self, user_id):
        conn = get_db()
        user = conn.execute("SELECT balance FROM Users WHERE user_id = ?", (user_id,)).fetchone()
        conn.close()
        if user:
            return json_response(self, {"balance": user["balance"]})
        return json_response(self, {"balance": 0})

    def get_transactions(self, user_id):
        conn = get_db()
        txs = conn.execute(
            "SELECT * FROM Transactions WHERE user_id = ? ORDER BY timestamp DESC LIMIT 50",
            (user_id,)
        ).fetchall()
        conn.close()
        return json_response(self, [dict(t) for t in txs])

    def get_leaderboard(self):
        conn = get_db()
        leaders = conn.execute(
            "SELECT user_id, username, balance FROM Users ORDER BY balance DESC LIMIT 20"
        ).fetchall()
        conn.close()
        return json_response(self, [dict(l) for l in leaders])

    def get_event_stats(self, event_id):
        conn = get_db()
        stats = conn.execute(
            """SELECT o.outcome_id, o.name, o.coefficient,
               COUNT(b.bet_id) as bet_count, COALESCE(SUM(b.amount), 0) as total_amount
               FROM Outcomes o LEFT JOIN Bets b ON o.outcome_id = b.outcome_id AND b.status = 'pending'
               WHERE o.event_id = ? GROUP BY o.outcome_id""",
            (event_id,)
        ).fetchall()
        total = conn.execute(
            "SELECT COUNT(DISTINCT user_id) as cnt FROM Bets WHERE event_id = ?", (event_id,)
        ).fetchone()
        conn.close()
        return json_response(self, {
            "outcomes": [dict(s) for s in stats],
            "total_players": total["cnt"] if total else 0,
        })

    def get_users(self):
        conn = get_db()
        users = conn.execute("SELECT user_id, username, balance, role FROM Users").fetchall()
        conn.close()
        return json_response(self, [dict(u) for u in users])

    def place_bet(self, data):
        user_id = data.get("user_id")
        event_id = data.get("event_id")
        outcome_id = data.get("outcome_id")
        amount = data.get("amount", 0)

        if not user_id or not event_id or not outcome_id or amount <= 0:
            return json_response(self, {"error": "Неверные данные"}, 400)

        conn = get_db()
        user = conn.execute("SELECT balance FROM Users WHERE user_id = ?", (user_id,)).fetchone()
        if not user or user["balance"] < amount:
            conn.close()
            return json_response(self, {"error": "Недостаточно койнов"}, 400)

        event = conn.execute("SELECT status FROM Events WHERE event_id = ?", (event_id,)).fetchone()
        if not event or event["status"] != "active":
            conn.close()
            return json_response(self, {"error": "Событие закрыто"}, 400)

        outcome = conn.execute("SELECT coefficient FROM Outcomes WHERE outcome_id = ?", (outcome_id,)).fetchone()
        if not outcome:
            conn.close()
            return json_response(self, {"error": "Исход не найден"}, 400)

        potential_win = int(amount * outcome["coefficient"])

        conn.execute("UPDATE Users SET balance = balance - ? WHERE user_id = ?", (amount, user_id))
        conn.execute(
            "INSERT INTO Bets (user_id, event_id, outcome_id, amount, potential_win, status) VALUES (?, ?, ?, ?, ?, 'pending')",
            (user_id, event_id, outcome_id, amount, potential_win)
        )
        conn.execute(
            "INSERT INTO Transactions (user_id, amount, description) VALUES (?, ?, ?)",
            (user_id, -amount, "Ставка")
        )
        conn.commit()
        new_balance = conn.execute("SELECT balance FROM Users WHERE user_id = ?", (user_id,)).fetchone()["balance"]
        conn.close()

        return json_response(self, {
            "success": True,
            "potential_win": potential_win,
            "new_balance": new_balance,
        })

    def daily_bonus(self, data):
        user_id = data.get("user_id")
        conn = get_db()
        user = conn.execute("SELECT * FROM Users WHERE user_id = ?", (user_id,)).fetchone()
        if not user:
            conn.close()
            return json_response(self, {"error": "Пользователь не найден"}, 404)

        now = datetime.now()
        if user["daily_bonus_last"]:
            try:
                last = datetime.fromisoformat(user["daily_bonus_last"])
                if last.date() == now.date():
                    conn.close()
                    return json_response(self, {"error": "Бонус уже получен сегодня"}, 400)
            except (ValueError, TypeError):
                pass

        bonus = 1000
        conn.execute("UPDATE Users SET balance = balance + ?, daily_bonus_last = ? WHERE user_id = ?",
                      (bonus, now.isoformat(), user_id))
        conn.execute("INSERT INTO Transactions (user_id, amount, description) VALUES (?, ?, ?)",
                      (user_id, bonus, "Ежедневный бонус"))
        conn.commit()
        new_balance = conn.execute("SELECT balance FROM Users WHERE user_id = ?", (user_id,)).fetchone()["balance"]
        conn.close()

        return json_response(self, {"success": True, "bonus": bonus, "new_balance": new_balance})

    def create_event(self, data):
        title = data.get("title", "").strip()
        deadline = data.get("deadline", "").strip()
        outcomes = data.get("outcomes", [])

        if not title or not outcomes:
            return json_response(self, {"error": "Заполните все поля"}, 400)

        conn = get_db()
        cursor = conn.execute("INSERT INTO Events (title, deadline, status) VALUES (?, ?, 'active')", (title, deadline))
        event_id = cursor.lastrowid
        for o in outcomes:
            conn.execute(
                "INSERT INTO Outcomes (event_id, name, coefficient) VALUES (?, ?, ?)",
                (event_id, o["name"], o["coefficient"])
            )
        conn.commit()
        conn.close()

        return json_response(self, {"success": True, "event_id": event_id})

    def complete_event(self, data):
        event_id = data.get("event_id")
        winner_id = data.get("winner_id")

        conn = get_db()
        conn.execute("UPDATE Events SET status = 'completed' WHERE event_id = ?", (event_id,))
        conn.execute("UPDATE Outcomes SET is_winner = 1 WHERE outcome_id = ?", (winner_id,))

        winners = conn.execute(
            "SELECT bet_id, user_id, amount, potential_win FROM Bets WHERE event_id = ? AND outcome_id = ? AND status = 'pending'",
            (event_id, winner_id)
        ).fetchall()

        for bet in winners:
            conn.execute("UPDATE Bets SET status = 'won' WHERE bet_id = ?", (bet["bet_id"],))
            conn.execute("UPDATE Users SET balance = balance + ? WHERE user_id = ?", (bet["potential_win"], bet["user_id"]))
            conn.execute("INSERT INTO Transactions (user_id, amount, description) VALUES (?, ?, ?)",
                          (bet["user_id"], bet["potential_win"], "Выигрыш"))

        conn.execute("UPDATE Bets SET status = 'lost' WHERE event_id = ? AND status = 'pending'", (event_id,))
        conn.commit()
        conn.close()

        return json_response(self, {"success": True, "winners_count": len(winners)})

    def update_balance(self, data):
        user_id = data.get("user_id")
        amount = data.get("amount", 0)
        reason = data.get("reason", "Коррекция баланса")

        conn = get_db()
        conn.execute("UPDATE Users SET balance = balance + ? WHERE user_id = ?", (amount, user_id))
        conn.execute("INSERT INTO Transactions (user_id, amount, description) VALUES (?, ?, ?)",
                      (user_id, amount, reason))
        conn.commit()
        new_balance = conn.execute("SELECT balance FROM Users WHERE user_id = ?", (user_id,)).fetchone()["balance"]
        conn.close()

        return json_response(self, {"success": True, "new_balance": new_balance})


if __name__ == "__main__":
    init_db()
    print("База данных инициализирована")
    server = HTTPServer(("localhost", 8080), APIHandler)
    print("Сервер запущен: http://localhost:8080")
    server.serve_forever()
