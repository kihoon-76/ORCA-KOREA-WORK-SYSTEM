-- ORCA Korea 업무 관리시스템 DB 스키마 (Cloudflare D1 / SQLite)

-- ============ 사용자 / 인증 ============
CREATE TABLE IF NOT EXISTS users (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  email        TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role         TEXT NOT NULL DEFAULT 'staff',   -- admin | ceo | finance | staff
  department   TEXT,
  position     TEXT,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============ 업무 / 할일 ============
CREATE TABLE IF NOT EXISTS tasks (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT NOT NULL,
  description  TEXT,
  status       TEXT NOT NULL DEFAULT 'todo',    -- todo | in_progress | done
  priority     TEXT NOT NULL DEFAULT 'normal',  -- low | normal | high | urgent
  assignee_id  INTEGER REFERENCES users(id),
  created_by   INTEGER REFERENCES users(id),
  due_date     TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============ 근태 / 출퇴근 ============
CREATE TABLE IF NOT EXISTS attendance (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id),
  work_date    TEXT NOT NULL,                   -- YYYY-MM-DD
  check_in     TEXT,
  check_out    TEXT,
  note         TEXT,
  UNIQUE(user_id, work_date)
);

-- 휴가 신청
CREATE TABLE IF NOT EXISTS leave_requests (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id),
  leave_type   TEXT NOT NULL DEFAULT 'annual',  -- annual | sick | etc
  start_date   TEXT NOT NULL,
  end_date     TEXT NOT NULL,
  reason       TEXT,
  status       TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============ 일정 / 캘린더 ============
CREATE TABLE IF NOT EXISTS calendar_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT NOT NULL,
  description  TEXT,
  event_type   TEXT NOT NULL DEFAULT 'general', -- general | meeting | deadline | shipment
  start_date   TEXT NOT NULL,
  end_date     TEXT,
  all_day      INTEGER NOT NULL DEFAULT 1,
  created_by   INTEGER REFERENCES users(id),
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============ 결재 (자금결제 등) ============
-- 워크플로우: 재무차장(finance) 상신 -> 대표(ceo) 승인 시 확정
CREATE TABLE IF NOT EXISTS approvals (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_type      TEXT NOT NULL DEFAULT 'payment', -- payment | general | trip
  title         TEXT NOT NULL,
  content       TEXT,
  amount        REAL,                            -- 금액 (자금결제)
  currency      TEXT DEFAULT 'KRW',
  requester_id  INTEGER NOT NULL REFERENCES users(id),
  status        TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  current_step  INTEGER NOT NULL DEFAULT 1,
  related_type  TEXT,                            -- 연관 모듈 (import/export 등)
  related_id    INTEGER,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS approval_steps (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  approval_id   INTEGER NOT NULL REFERENCES approvals(id) ON DELETE CASCADE,
  step_order    INTEGER NOT NULL,
  approver_role TEXT NOT NULL,                   -- 결재 권한 역할
  approver_id   INTEGER REFERENCES users(id),    -- 실제 결재자
  status        TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  comment       TEXT,
  acted_at      TEXT
);

-- ============ 첨부파일 (R2) - 모든 모듈 공용 ============
CREATE TABLE IF NOT EXISTS attachments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type   TEXT NOT NULL,   -- import | export | inventory | material | trip | approval | task
  entity_id     INTEGER NOT NULL,
  category      TEXT,            -- contract | shipping_docs | analysis | trip_plan | etc
  file_name     TEXT NOT NULL,
  file_key      TEXT NOT NULL,   -- R2 object key
  content_type  TEXT,
  size          INTEGER,
  uploaded_by   INTEGER REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_attachments_entity ON attachments(entity_type, entity_id);

-- ============ 원료 마스터 ============
CREATE TABLE IF NOT EXISTS materials (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  code          TEXT UNIQUE,
  name          TEXT NOT NULL,
  spec          TEXT,
  unit          TEXT DEFAULT 'MT',   -- 단위 (MT, KG 등)
  origin        TEXT,                -- 원산지
  note          TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 원료 샘플 분석결과 (파일은 attachments(entity_type='material', category='analysis'))
CREATE TABLE IF NOT EXISTS material_analyses (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  material_id   INTEGER REFERENCES materials(id),
  sample_no     TEXT,
  analyzed_at   TEXT,
  result_summary TEXT,
  created_by    INTEGER REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============ 원료 수입현황 ============
CREATE TABLE IF NOT EXISTS imports (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ref_no        TEXT,                 -- 관리번호
  material_id   INTEGER REFERENCES materials(id),
  material_name TEXT NOT NULL,        -- 원료명 (마스터 미등록 대비)
  supplier      TEXT,                 -- 공급사(수출자)
  lc_bank       TEXT,                 -- LC 개설은행/회사
  lc_no         TEXT,
  quantity      REAL,                 -- 수입 물량
  unit          TEXT DEFAULT 'MT',
  unit_price    REAL,                 -- 단가
  total_price   REAL,                 -- 총액
  currency      TEXT DEFAULT 'USD',
  vessel        TEXT,                 -- 선박명
  etd           TEXT,                 -- 출항 예정일
  eta           TEXT,                 -- 도착 예정일
  status        TEXT NOT NULL DEFAULT 'contracted', -- contracted | shipped | arrived | cleared | done
  note          TEXT,
  created_by    INTEGER REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============ 원료 수출현황 ============
CREATE TABLE IF NOT EXISTS exports (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ref_no        TEXT,
  material_id   INTEGER REFERENCES materials(id),
  material_name TEXT NOT NULL,
  buyer         TEXT,                 -- 수입자(바이어)
  lc_bank       TEXT,                 -- LC 개설은행/회사
  lc_no         TEXT,
  quantity      REAL,
  unit          TEXT DEFAULT 'MT',
  unit_price    REAL,
  total_price   REAL,
  currency      TEXT DEFAULT 'USD',
  vessel        TEXT,
  etd           TEXT,
  eta           TEXT,
  status        TEXT NOT NULL DEFAULT 'contracted',
  note          TEXT,
  created_by    INTEGER REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============ 재고관리 ============
-- 입출고 트랜잭션. 재고는 트랜잭션 합산으로 계산.
CREATE TABLE IF NOT EXISTS inventory_txns (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  material_id   INTEGER REFERENCES materials(id),
  material_name TEXT NOT NULL,
  txn_type      TEXT NOT NULL,        -- in (입고) | out (출고)
  source        TEXT,                 -- import | manual | export | adjust
  source_id     INTEGER,              -- 연관 import/export id
  quantity      REAL NOT NULL,        -- 수량(양수)
  unit          TEXT DEFAULT 'MT',
  warehouse     TEXT,                 -- 창고/위치
  txn_date      TEXT NOT NULL,        -- YYYY-MM-DD
  note          TEXT,
  created_by    INTEGER REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_txn_material ON inventory_txns(material_id);

-- ============ 출장 계획 ============
CREATE TABLE IF NOT EXISTS business_trips (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id),
  title         TEXT NOT NULL,
  destination   TEXT,
  purpose       TEXT,
  start_date    TEXT,
  end_date      TEXT,
  status        TEXT NOT NULL DEFAULT 'planned', -- planned | approved | completed
  note          TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============ 단체 채팅 ============
CREATE TABLE IF NOT EXISTS chat_channels (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  created_by    INTEGER REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS chat_messages (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id    INTEGER NOT NULL REFERENCES chat_channels(id),
  user_id       INTEGER NOT NULL REFERENCES users(id),
  body          TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_channel ON chat_messages(channel_id, id);

-- ============ 화상회의 ============
CREATE TABLE IF NOT EXISTS meetings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  room          TEXT NOT NULL UNIQUE,             -- Jitsi 방 식별자
  created_by    INTEGER REFERENCES users(id),
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
