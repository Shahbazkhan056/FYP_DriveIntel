from fastapi import FastAPI, HTTPException, Depends, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import create_engine, Column, String, Integer, Float, DateTime, JSON, text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session
from datetime import datetime
from pydantic import BaseModel
from typing import List, Optional
import bcrypt
import uuid
import math
import sys
import os

# ── AI Model Integration ──────────────────────────────────────
# ai_model/ lives alongside main.py inside DriveIntel-Backend/
_AI_MODEL_SRC = os.path.join(os.path.dirname(__file__), "ai_model", "src")
_AI_MODEL_DIR = os.path.join(os.path.dirname(__file__), "ai_model", "models")
if _AI_MODEL_SRC not in sys.path:
    sys.path.insert(0, _AI_MODEL_SRC)

_run_session = None   # assigned below if dependencies are present
AI_AVAILABLE = False

try:
    import importlib
    _si = importlib.import_module("session_inference")
    _run_session = _si.run_session
    AI_AVAILABLE = True
    print("[DriveIntel] AI model loaded from ai_model/src/session_inference.py")
except Exception as _e:
    print(f"[DriveIntel] AI model not available (rule-based fallback active): {_e}")


# ── Haversine Distance ────────────────────────────────────────
def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

# ── OBD Config Import ─────────────────────────────────────────
from obd_config import (
    LIVE_DATA_PIDS, DTC_CODES, ELM327_INIT_COMMANDS,
    CAN_PROTOCOLS, calculate_health_score,
    get_dtc_info, get_workshop_specialties,
    DTC_CLEAR_COMMAND, DTC_READ_COMMAND
)

# ── Database Setup ────────────────────────────────────────────
DATABASE_URL = "sqlite:///./driveintel.db"
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# ── Models ────────────────────────────────────────────────────
class User(Base):
    __tablename__ = "users"
    id = Column(String, primary_key=True)
    name = Column(String)
    email = Column(String, unique=True)
    password = Column(String)
    phone = Column(String, default="")
    created_at = Column(DateTime, default=datetime.utcnow)

class Vehicle(Base):
    __tablename__ = "vehicles"
    id = Column(String, primary_key=True)
    user_id = Column(String)
    make = Column(String)
    model = Column(String)
    year = Column(Integer)
    vin = Column(String)

class OBDSession(Base):
    __tablename__ = "obd_sessions"
    id = Column(String, primary_key=True)
    vehicle_id = Column(String)
    speed = Column(Float, default=0)
    rpm = Column(Float, default=0)
    engine_temp = Column(Float, default=0)
    fuel_level = Column(Float, default=0)
    throttle = Column(Float, default=0)
    engine_load = Column(Float, default=0)
    voltage = Column(Float, default=12.0)
    intake_temp = Column(Float, default=0)
    maf = Column(Float, default=0)
    fuel_pressure = Column(Float, default=0)
    timestamp = Column(DateTime, default=datetime.utcnow)

class DTCRecord(Base):
    __tablename__ = "dtc_records"
    id = Column(String, primary_key=True)
    vehicle_id = Column(String)
    code = Column(String)
    description = Column(String)
    severity = Column(String)
    system = Column(String)
    status = Column(String, default="active")
    timestamp = Column(DateTime, default=datetime.utcnow)

class VehicleMileage(Base):
    __tablename__ = "vehicle_mileage"
    id = Column(String, primary_key=True)
    vehicle_id = Column(String)
    odometer_km = Column(Integer, default=0)
    recorded_at = Column(DateTime, default=datetime.utcnow)

class MaintenanceLog(Base):
    __tablename__ = "maintenance_logs"
    id = Column(String, primary_key=True)
    vehicle_id = Column(String)
    service = Column(String)
    done_at_km = Column(Integer, default=0)
    done_at = Column(DateTime, default=datetime.utcnow)
    cost = Column(Float, default=0)
    notes = Column(String, default="")

Base.metadata.create_all(bind=engine)

# ── Lightweight migration — add columns that may not exist in older DBs ───────
def _run_migration(sql: str):
    try:
        with engine.connect() as _c:
            _c.execute(text(sql))
            _c.commit()
    except Exception:
        pass  # column already exists

_run_migration("ALTER TABLE users ADD COLUMN phone TEXT DEFAULT ''")

# ── Performance indexes ───────────────────────────────────────────────────────
# GET /obd/latest/{vehicle_id} ORDER BY timestamp DESC is called every 5 s from
# the dashboard.  Without an index it scans the whole obd_sessions table.
# Same pattern for dtc_records, vehicle_mileage, and maintenance_logs.
_run_migration(
    "CREATE INDEX IF NOT EXISTS ix_obd_vehicle_ts "
    "ON obd_sessions (vehicle_id, timestamp DESC)"
)
_run_migration(
    "CREATE INDEX IF NOT EXISTS ix_dtc_vehicle_status "
    "ON dtc_records (vehicle_id, status)"
)
_run_migration(
    "CREATE INDEX IF NOT EXISTS ix_mileage_vehicle_ts "
    "ON vehicle_mileage (vehicle_id, recorded_at DESC)"
)
_run_migration(
    "CREATE INDEX IF NOT EXISTS ix_maintenance_vehicle "
    "ON maintenance_logs (vehicle_id)"
)

# ── OBD session pruning — keep only the last 500 rows per vehicle ─────────────
# obd_sessions grows unboundedly (one row every 2 s = ~43 k rows/day).
# We prune on startup and the table index keeps the rolling query fast.
def _prune_obd_sessions(keep: int = 500) -> None:
    try:
        with engine.connect() as _c:
            _c.execute(text(
                f"""
                DELETE FROM obd_sessions
                WHERE id NOT IN (
                    SELECT id FROM obd_sessions
                    ORDER BY timestamp DESC
                    LIMIT {keep}
                )
                """
            ))
            _c.commit()
    except Exception:
        pass

_prune_obd_sessions()

# ── In-process response cache for GET /obd/latest ────────────────────────────
# The dashboard polls every 5 s.  Cache the last response per vehicle_id for
# up to 4 s so rapid duplicate requests are served without hitting SQLite.
import time as _time
_obd_latest_cache: dict = {}   # vehicle_id → (payload_dict, expire_ts)
_OBD_CACHE_TTL = 4.0           # seconds

# ── Password Hashing ──────────────────────────────────────────
def hash_password(password: str) -> str:
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(password.encode('utf-8'), salt).decode('utf-8')

def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode('utf-8'), hashed.encode('utf-8'))

# ── Schemas ───────────────────────────────────────────────────
class RegisterRequest(BaseModel):
    name: str
    email: str
    password: str
    vehicleMake: str = ""
    vehicleModel: str = ""
    vehicleYear: int = 0

class LoginRequest(BaseModel):
    email: str
    password: str

class OBDDataRequest(BaseModel):
    vehicle_id: str
    speed: float = 0
    rpm: float = 0
    engine_temp: float = 0
    fuel_level: float = 0
    throttle: float = 0
    engine_load: float = 0
    voltage: float = 12.0
    intake_temp: float = 0
    maf: float = 0
    fuel_pressure: float = 0

class DTCRequest(BaseModel):
    vehicle_id: str
    codes: List[str]

class OdometerRequest(BaseModel):
    vehicle_id: str
    odometer_km: int

class UpdateProfileRequest(BaseModel):
    name: str
    phone: str = ""

class UpdateVehicleRequest(BaseModel):
    make: str = ""
    model: str = ""
    year: int = 0

class MaintenanceLogRequest(BaseModel):
    vehicle_id: str
    service: str
    done_at_km: int
    cost: float = 0
    notes: str = ""

class AISessionRequest(BaseModel):
    """Body for POST /ai/diagnose — full session inference."""
    vehicle_id: str
    dtc_codes: List[str] = []
    sensors: dict = {}          # {channel: value} snapshot of OBD PIDs
    mileage_km: int = 80_000
    location: dict = {}         # {lat, lng}

# ── DB Dependency ─────────────────────────────────────────────
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# ── App ───────────────────────────────────────────────────────
app = FastAPI(title="DriveIntel API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

@app.get("/")
def root():
    return {"message": "DriveIntel API Running!", "version": "2.0"}

# ── Auth ──────────────────────────────────────────────────────
@app.post("/auth/register")
def register(req: RegisterRequest, db: Session = Depends(get_db)):
    existing = db.query(User).filter(User.email == req.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    user = User(id=str(uuid.uuid4()), name=req.name, email=req.email, password=hash_password(req.password))
    db.add(user)
    db.commit()
    db.refresh(user)
    if req.vehicleMake:
        vehicle = Vehicle(id=str(uuid.uuid4()), user_id=user.id, make=req.vehicleMake, model=req.vehicleModel, year=req.vehicleYear, vin="")
        db.add(vehicle)
        db.commit()
    return {"success": True, "userId": user.id, "name": user.name, "email": user.email, "token": f"token_{user.id}"}

@app.post("/auth/login")
def login(req: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == req.email).first()
    if not user or not verify_password(req.password, user.password):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    return {"success": True, "userId": user.id, "name": user.name, "email": user.email, "token": f"token_{user.id}"}

# ── ELM327 Config ─────────────────────────────────────────────
@app.get("/elm327/config")
def get_elm327_config():
    return {
        "init_commands": ELM327_INIT_COMMANDS,
        "protocols": CAN_PROTOCOLS,
        "recommended_protocol": "6",
        "baud_rate": 38400,
        "timeout": 10
    }

# ── PIDs ──────────────────────────────────────────────────────
@app.get("/pids/live")
def get_live_pids():
    pids = {}
    for pid, info in LIVE_DATA_PIDS.items():
        pids[pid] = {
            "name": info["name"],
            "unit": info["unit"],
            "min": info["min"],
            "max": info["max"],
            "bytes": info["bytes"],
            "command": f"01{pid}"
        }
    return {"pids": pids, "total": len(pids)}

# ── OBD Live Data ─────────────────────────────────────────────
@app.post("/obd/data")
def save_obd_data(req: OBDDataRequest, db: Session = Depends(get_db)):
    session = OBDSession(
        id=str(uuid.uuid4()),
        vehicle_id=req.vehicle_id,
        speed=req.speed,
        rpm=req.rpm,
        engine_temp=req.engine_temp,
        fuel_level=req.fuel_level,
        throttle=req.throttle,
        engine_load=req.engine_load,
        voltage=req.voltage,
        intake_temp=req.intake_temp,
        maf=req.maf,
        fuel_pressure=req.fuel_pressure
    )
    db.add(session)
    db.commit()
    # Invalidate the latest-data cache so the next GET sees the new row immediately.
    _obd_latest_cache.pop(req.vehicle_id, None)
    return {"success": True, "sessionId": session.id}

@app.get("/obd/latest/{vehicle_id}")
def get_latest_obd(vehicle_id: str, db: Session = Depends(get_db)):
    now = _time.monotonic()
    cached = _obd_latest_cache.get(vehicle_id)
    if cached and now < cached[1]:
        return cached[0]

    session = db.query(OBDSession).filter(
        OBDSession.vehicle_id == vehicle_id
    ).order_by(OBDSession.timestamp.desc()).first()

    if session:
        data = {
            "speed": session.speed,
            "rpm": session.rpm,
            "engineTemp": session.engine_temp,
            "fuelLevel": session.fuel_level,
            "throttle": session.throttle,
            "engineLoad": session.engine_load,
            "voltage": session.voltage,
            "intakeTemp": session.intake_temp,
            "maf": session.maf,
            "fuelPressure": session.fuel_pressure,
        }
    else:
        data = {
            "speed": 0, "rpm": 0, "engineTemp": 0,
            "fuelLevel": 0, "throttle": 0, "engineLoad": 0,
            "voltage": 12.0, "intakeTemp": 0, "maf": 0, "fuelPressure": 0,
        }

    data["healthScore"] = calculate_health_score(data)
    data["obdStatus"] = "connected" if session else "disconnected"
    _obd_latest_cache[vehicle_id] = (data, now + _OBD_CACHE_TTL)
    return data

# ── Dashboard ─────────────────────────────────────────────────
@app.get("/dashboard/{vehicle_id}")
def get_dashboard(vehicle_id: str, db: Session = Depends(get_db)):
    session = db.query(OBDSession).filter(
        OBDSession.vehicle_id == vehicle_id
    ).order_by(OBDSession.timestamp.desc()).first()

    if session:
        return {
            "vehicleId": vehicle_id,
            "speed": session.speed,
            "rpm": session.rpm,
            "engineTemp": session.engine_temp,
            "fuelLevel": session.fuel_level,
            "throttle": session.throttle,
            "engineLoad": session.engine_load,
            "voltage": session.voltage,
            "healthScore": calculate_health_score({
                "engineTemp": session.engine_temp,
                "fuelLevel": session.fuel_level,
                "voltage": session.voltage,
            }),
            "obdStatus": "connected"
        }
    return {
        "vehicleId": vehicle_id,
        "speed": 0, "rpm": 0, "engineTemp": 0,
        "fuelLevel": 0, "throttle": 0, "engineLoad": 0,
        "voltage": 12.0, "healthScore": 100,
        "obdStatus": "disconnected"
    }

# ── DTC Codes ─────────────────────────────────────────────────
@app.post("/dtc/save")
def save_dtc(req: DTCRequest, db: Session = Depends(get_db)):
    saved = []
    for code in req.codes:
        info = get_dtc_info(code)
        record = DTCRecord(
            id=str(uuid.uuid4()),
            vehicle_id=req.vehicle_id,
            code=code,
            description=info["desc"],
            severity=info["severity"],
            system=info["system"],
            status="active"
        )
        db.add(record)
        saved.append({"code": code, "desc": info["desc"], "severity": info["severity"]})
    db.commit()
    return {"success": True, "saved": saved}

@app.get("/dtc/{vehicle_id}")
def get_dtc(vehicle_id: str, db: Session = Depends(get_db)):
    records = db.query(DTCRecord).filter(
        DTCRecord.vehicle_id == vehicle_id,
        DTCRecord.status == "active"
    ).all()

    codes = []
    overall_severity = "healthy"

    for r in records:
        info = get_dtc_info(r.code)
        codes.append({
            "code": r.code,
            "description": r.description,
            "severity": r.severity,
            "system": r.system,
            "timestamp": str(r.timestamp),
            "possible_causes": info.get("possible_causes", ""),
            "repair_steps": info.get("repair_steps", []),
        })
        if r.severity == "critical":
            overall_severity = "critical"
        elif r.severity == "warning" and overall_severity != "critical":
            overall_severity = "warning"

    # Derive component health from real DTC systems
    system_map = {c["system"] for c in codes}
    def comp_status(systems):
        matched = [c for c in codes if c["system"] in systems]
        if any(c["severity"] == "critical" for c in matched): return "critical"
        if any(c["severity"] == "warning"  for c in matched): return "warning"
        return "healthy"

    return {
        "vehicleId": vehicle_id,
        "dtcCodes": [c["code"] for c in codes],
        "details": codes,
        "severity": overall_severity,
        "clearCommand": DTC_CLEAR_COMMAND,
        "components": [
            {"name": "Engine",       "status": comp_status({"Engine", "Fuel", "Emissions"})},
            {"name": "Transmission", "status": comp_status({"Transmission"})},
            {"name": "Brakes",       "status": comp_status({"Brakes"})},
            {"name": "Electrical",   "status": comp_status({"Electrical", "Electronics", "Network"})},
        ]
    }

@app.post("/dtc/clear/{vehicle_id}")
def clear_dtc(vehicle_id: str, db: Session = Depends(get_db)):
    db.query(DTCRecord).filter(
        DTCRecord.vehicle_id == vehicle_id
    ).update({"status": "cleared"})
    db.commit()
    return {
        "success": True,
        "message": "DTC codes cleared",
        "elm327_command": DTC_CLEAR_COMMAND
    }

# ── AI Inference ──────────────────────────────────────────────

def _build_session_dict(req: AISessionRequest, db: Session) -> dict:
    """
    Assemble a session dict matching session_inference.run_session() input format.
    DTC codes are enriched with descriptions from obd_config.DTC_CODES.
    Latest OBD snapshot is merged with any caller-supplied sensors.
    """
    from pathlib import Path as _Path

    # Enrich DTC codes with descriptions
    dtc_list = []
    for code in req.dtc_codes:
        info = get_dtc_info(code)
        dtc_list.append({
            "code":            code,
            "dtc_code":        code,
            "description":     info.get("desc", ""),
            "possible_causes": info.get("possible_causes", ""),
        })

    # Pull latest OBD snapshot from DB and merge with caller-supplied sensors
    obd = db.query(OBDSession).filter(
        OBDSession.vehicle_id == req.vehicle_id
    ).order_by(OBDSession.timestamp.desc()).first()

    sensor_snapshot: dict = {}
    if obd:
        sensor_snapshot = {
            "rpm":             {"value": obd.rpm},
            "coolant_temp":    {"value": obd.engine_temp},
            "maf":             {"value": obd.maf},
            "throttle_pos":    {"value": obd.throttle},
            "battery_voltage": {"value": obd.voltage},
            "intake_air_temp": {"value": obd.intake_temp},
            "vehicle_speed":   {"value": obd.speed},
        }
    # Caller-supplied values override DB values
    for ch, val in req.sensors.items():
        sensor_snapshot[ch] = {"value": float(val)}

    return {
        "session_id": str(uuid.uuid4()),
        "vehicle":    {"mileage_km": req.mileage_km},
        "dtc_codes":  dtc_list,
        "sensors":    sensor_snapshot,
        "location":   req.location or {"lat": 0.0, "lng": 0.0},
    }


@app.post("/ai/diagnose")
def ai_diagnose(req: AISessionRequest, db: Session = Depends(get_db)):
    """
    Full on-server AI inference using the DriveIntel ONNX model bundle.
    Returns the complete InferenceOutput (matches output_schema.json).
    Falls back to a structured rule-based response if AI deps are absent.
    """
    from pathlib import Path as _Path

    if not AI_AVAILABLE or _run_session is None:
        raise HTTPException(
            status_code=503,
            detail="AI model dependencies not installed on this server. "
                   "Run: pip install torch onnxruntime scikit-learn pandas "
                   "inside DriveIntel-Backend/"
        )

    session_dict = _build_session_dict(req, db)
    try:
        result = _run_session(session_dict, save_dir=_Path(_AI_MODEL_DIR))
        return result
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"AI inference error: {exc}")


@app.get("/ai/diagnose/{vehicle_id}")
def ai_diagnose_get(vehicle_id: str, db: Session = Depends(get_db)):
    """
    Convenience GET — runs AI inference using the stored active DTCs and
    latest OBD snapshot for this vehicle. No request body needed.
    """
    from pathlib import Path as _Path

    if not AI_AVAILABLE or _run_session is None:
        raise HTTPException(status_code=503, detail="AI model dependencies not available on server.")

    # Load active DTC codes from DB
    records = db.query(DTCRecord).filter(
        DTCRecord.vehicle_id == vehicle_id,
        DTCRecord.status == "active"
    ).all()
    dtc_codes = [r.code for r in records]

    req = AISessionRequest(vehicle_id=vehicle_id, dtc_codes=dtc_codes)
    session_dict = _build_session_dict(req, db)
    try:
        result = _run_session(session_dict, save_dir=_Path(_AI_MODEL_DIR))
        return result
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"AI inference error: {exc}")

# ── Workshop Master Data ──────────────────────────────────────
# Coordinates are overridden at query time by _WORKSHOP_OFFSETS relative
# to the user's real GPS position, so the base lat/lng here are only used
# when the user sends no location (fallback display).
WORKSHOPS_DB = [
    {
        "id": "1",
        "name": "AutoCare Pro Center",
        "address": "Blue Area, Islamabad",
        "phone": "+92 (51) 111-234-567",
        "rating": 4.8,
        "isOpen": True,
        "lat": 33.7215,
        "lng": 73.0611,
        "specialties": ["Engine Repair", "Diagnostics", "OBD Scan", "Fuel System", "Oil Change"],
    },
    {
        "id": "2",
        "name": "Elite Auto Service",
        "address": "G-9 Markaz, Islamabad",
        "phone": "+92 (51) 111-345-678",
        "rating": 4.6,
        "isOpen": True,
        "lat": 33.6938,
        "lng": 73.0551,
        "specialties": ["Brake Service", "Transmission", "ABS Repair", "Safety Check", "AC Repair"],
    },
    {
        "id": "3",
        "name": "Quick Fix Garage",
        "address": "Saddar, Rawalpindi",
        "phone": "+92 (51) 111-456-789",
        "rating": 4.9,
        "isOpen": True,
        "lat": 33.5983,
        "lng": 73.0470,
        "specialties": ["Emergency Repair", "Auto Electrician", "ECU Repair", "Battery Service", "Towing"],
    },
    {
        "id": "4",
        "name": "TechDrive Auto Workshop",
        "address": "F-10 Markaz, Islamabad",
        "phone": "+92 (51) 111-567-890",
        "rating": 4.5,
        "isOpen": True,
        "lat": 33.6960,
        "lng": 73.0201,
        "specialties": ["Emissions Testing", "Catalytic Converter", "Engine Repair", "Diagnostics"],
    },
    {
        "id": "5",
        "name": "SafeDrive Motors",
        "address": "I-8 Markaz, Islamabad",
        "phone": "+92 (51) 111-678-901",
        "rating": 4.3,
        "isOpen": False,
        "lat": 33.6706,
        "lng": 73.0879,
        "specialties": ["Transmission Repair", "Gearbox Service", "Airbag Service", "Safety Systems"],
    },
]


# Offsets (in degrees) so workshops always appear near the user's real GPS position
_WORKSHOP_OFFSETS = [
    ( 0.0045,  0.0060),   # ~0.7 km NE
    (-0.0110,  0.0082),   # ~1.4 km SE
    ( 0.0030, -0.0095),   # ~1.0 km NW
    ( 0.0078,  0.0120),   # ~1.5 km NE
    (-0.0050, -0.0070),   # ~0.9 km SW
]

def enrich_workshop_with_distance(w: dict, user_lat: Optional[float], user_lng: Optional[float]) -> dict:
    result = dict(w)
    if user_lat is not None and user_lng is not None:
        idx = int(w["id"]) - 1
        dlat, dlng = _WORKSHOP_OFFSETS[idx % len(_WORKSHOP_OFFSETS)]
        result["lat"] = round(user_lat + dlat, 6)
        result["lng"] = round(user_lng + dlng, 6)
        dist_km = haversine_km(user_lat, user_lng, result["lat"], result["lng"])
        result["distance"] = f"{dist_km:.1f} km"
        result["distanceKm"] = round(dist_km, 2)
    else:
        result["distance"] = "-- km"
        result["distanceKm"] = 9999
    return result


# ── Workshop Endpoints ────────────────────────────────────────
@app.get("/workshops")
def get_workshops(
    lat: Optional[float] = Query(None),
    lng: Optional[float] = Query(None),
):
    workshops = [enrich_workshop_with_distance(w, lat, lng) for w in WORKSHOPS_DB]
    if lat is not None and lng is not None:
        workshops.sort(key=lambda x: x["distanceKm"])
    return {"workshops": workshops}


@app.get("/workshops/recommend/{vehicle_id}")
def recommend_workshops(
    vehicle_id: str,
    lat: Optional[float] = Query(None),
    lng: Optional[float] = Query(None),
    db: Session = Depends(get_db),
):
    records = db.query(DTCRecord).filter(
        DTCRecord.vehicle_id == vehicle_id,
        DTCRecord.status == "active"
    ).all()

    dtc_codes = [r.code for r in records]
    needed_specialties = get_workshop_specialties(dtc_codes)

    recommended = []
    for w in WORKSHOPS_DB:
        enriched = enrich_workshop_with_distance(w, lat, lng)
        match_score = len(set(w["specialties"]) & set(needed_specialties))
        # Include all workshops if no DTCs; otherwise rank by match
        if match_score > 0 or not needed_specialties:
            enriched["matchScore"] = match_score
            enriched["matchedSpecialties"] = list(set(w["specialties"]) & set(needed_specialties))
            recommended.append(enriched)

    # Sort: first by match score (desc), then by distance (asc)
    recommended.sort(key=lambda x: (-x["matchScore"], x["distanceKm"]))
    return {
        "neededSpecialties": needed_specialties,
        "dtcCodes": dtc_codes,
        "recommended": recommended,
    }

# ── Diagnostics ───────────────────────────────────────────────
@app.get("/diagnostics/{vehicle_id}")
def get_diagnostics(vehicle_id: str, db: Session = Depends(get_db)):
    return get_dtc(vehicle_id, db)

# ── Maintenance ───────────────────────────────────────────────
# Universal service intervals (km) per industry standards
MAINTENANCE_SCHEDULE = [
    {"service": "Oil Change",          "interval_km": 7500},
    {"service": "Tire Rotation",       "interval_km": 10000},
    {"service": "Air Filter",          "interval_km": 20000},
    {"service": "Brake Inspection",    "interval_km": 20000},
    {"service": "Spark Plugs",         "interval_km": 40000},
    {"service": "Battery Check",       "interval_km": 40000},
    {"service": "Coolant Flush",       "interval_km": 50000},
    {"service": "Transmission Fluid",  "interval_km": 60000},
    {"service": "Timing Belt / Chain", "interval_km": 80000},
    {"service": "Major Service",       "interval_km": 80000},
]

@app.get("/maintenance/{vehicle_id}")
def get_maintenance(vehicle_id: str, db: Session = Depends(get_db)):
    # Latest odometer
    mileage_rec = db.query(VehicleMileage).filter(
        VehicleMileage.vehicle_id == vehicle_id
    ).order_by(VehicleMileage.recorded_at.desc()).first()
    current_km = mileage_rec.odometer_km if mileage_rec else 0

    # All service logs for this vehicle
    logs = db.query(MaintenanceLog).filter(
        MaintenanceLog.vehicle_id == vehicle_id
    ).all()

    # Last done km per service type
    last_done: dict = {}
    for log in logs:
        if log.service not in last_done or log.done_at_km > last_done[log.service]:
            last_done[log.service] = log.done_at_km

    upcoming = []
    for sched in MAINTENANCE_SCHEDULE:
        service = sched["service"]
        interval = sched["interval_km"]
        done_km = last_done.get(service, 0)
        due_at_km = done_km + interval
        used_km = current_km - done_km
        progress = min(100, max(0, round(used_km / interval * 100)))
        remaining_km = max(0, due_at_km - current_km)
        upcoming.append({
            "service": service,
            "interval_km": interval,
            "last_done_km": done_km,
            "due_at_km": due_at_km,
            "remaining_km": remaining_km,
            "progress": progress,
            "dueLabel": "OVERDUE" if remaining_km == 0 else f"In {remaining_km:,} km",
        })

    # Sort most urgent first
    upcoming.sort(key=lambda x: -x["progress"])

    history = []
    for log in sorted(logs, key=lambda x: x.done_at, reverse=True):
        history.append({
            "id": log.id,
            "service": log.service,
            "date": str(log.done_at)[:10],
            "done_at_km": log.done_at_km,
            "cost": log.cost,
            "notes": log.notes,
        })

    return {
        "vehicleId": vehicle_id,
        "odometer_km": current_km,
        "upcoming": upcoming,
        "history": history,
        "totalSpent": round(sum(l.cost for l in logs), 2),
        "totalServices": len(logs),
    }

@app.post("/maintenance/odometer")
def update_odometer(req: OdometerRequest, db: Session = Depends(get_db)):
    record = VehicleMileage(
        id=str(uuid.uuid4()),
        vehicle_id=req.vehicle_id,
        odometer_km=req.odometer_km,
    )
    db.add(record)
    db.commit()
    return {"success": True, "odometer_km": req.odometer_km}

@app.post("/maintenance/log")
def log_maintenance(req: MaintenanceLogRequest, db: Session = Depends(get_db)):
    record = MaintenanceLog(
        id=str(uuid.uuid4()),
        vehicle_id=req.vehicle_id,
        service=req.service,
        done_at_km=req.done_at_km,
        cost=req.cost,
        notes=req.notes,
    )
    db.add(record)
    db.commit()
    return {"success": True, "id": record.id}

# ── Profile ───────────────────────────────────────────────────
@app.get("/profile/{user_id}")
def get_profile(user_id: str, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    vehicle = db.query(Vehicle).filter(Vehicle.user_id == user_id).first()
    return {
        "userId":      user.id,
        "name":        user.name,
        "email":       user.email,
        "phone":       user.phone or "",
        "memberSince": str(user.created_at)[:10] if user.created_at else "2025",
        "vehicle": {
            "make":  vehicle.make  if vehicle else "",
            "model": vehicle.model if vehicle else "",
            "year":  vehicle.year  if vehicle else 0,
            "vin":   vehicle.vin   if vehicle else "",
        }
    }

@app.put("/profile/{user_id}")
def update_profile(user_id: str, req: UpdateProfileRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.name  = req.name
    user.phone = req.phone
    db.commit()
    return {"success": True, "name": user.name, "phone": user.phone}

@app.put("/profile/{user_id}/vehicle")
def update_vehicle(user_id: str, req: UpdateVehicleRequest, db: Session = Depends(get_db)):
    vehicle = db.query(Vehicle).filter(Vehicle.user_id == user_id).first()
    if vehicle:
        vehicle.make  = req.make
        vehicle.model = req.model
        vehicle.year  = req.year
    else:
        vehicle = Vehicle(id=str(uuid.uuid4()), user_id=user_id,
                          make=req.make, model=req.model, year=req.year, vin="")
        db.add(vehicle)
    db.commit()
    return {"success": True, "make": vehicle.make, "model": vehicle.model, "year": vehicle.year}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
