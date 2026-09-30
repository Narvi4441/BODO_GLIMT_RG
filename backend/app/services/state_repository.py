"""PostgreSQL source of truth; mutations serialize on the journey row."""
import json
from datetime import datetime, timezone, timedelta
from uuid import UUID, uuid4

from sqlalchemy import text
from app.core.config import Config
from app.core.database import get_engine


class StateError(Exception):
    def __init__(self, status_code, message):
        self.status_code, self.message = status_code, message
        super().__init__(message)


def identifier(value):
    try:
        return str(UUID(str(value)))
    except (ValueError, TypeError, AttributeError):
        return None


def iso(value):
    if value is None:
        return None
    # Existing TIMESTAMP columns store UTC from the API, without a timezone.
    return value.replace(tzinfo=value.tzinfo or timezone.utc).astimezone(timezone.utc).isoformat(timespec="microseconds")


def event(connection, journey_id, event_type, payload):
    connection.execute(text("""INSERT INTO eventos_viaje(journey_id,event_type,payload)
        VALUES (:journey_id,:event_type,CAST(:payload AS jsonb))"""),
        dict(journey_id=journey_id, event_type=event_type, payload=json.dumps(payload)))


def journey_row(connection, journey_id, lock=False):
    key = identifier(journey_id)
    if not key:
        return None
    return connection.execute(text("SELECT * FROM viajes WHERE journey_id=:id" +
                                   (" FOR UPDATE" if lock else "")), {"id": key}).mappings().first()


def validate_active(row, user_id):
    if not row:
        raise StateError(404, "Journey not found")
    if row["estado"] not in {"ACTIVE", "EN_CURSO"}:
        raise StateError(409, "Journey is not active")
    if row["user_id"] != user_id:
        raise StateError(403, "User does not own this journey")


def journey_dict(row):
    return dict(journey_id=str(row["journey_id"]), user_id=row["user_id"],
                status={"EN_CURSO": "ACTIVE", "FINALIZADO": "COMPLETED"}.get(row["estado"], row["estado"]),
                started_at=iso(row["inicio_viaje"]), ended_at=iso(row["fin_viaje"]),
                last_telemetry_at=iso(row["last_telemetry_at"]), online=row["online"],
                updated_at=iso(row["updated_at"]))


def expire_connection(connection, row):
    if row and row["online"] and row["last_telemetry_at"]:
        deadline = row["last_telemetry_at"] + timedelta(seconds=Config.TELEMETRY_OFFLINE_TIMEOUT_SECONDS)
        if datetime.now(timezone.utc) > deadline:
            connection.execute(text("UPDATE viajes SET online=false,updated_at=clock_timestamp() WHERE journey_id=:id"),
                               {"id": row["journey_id"]})
            event(connection, str(row["journey_id"]), "CONNECTION_LOST", {"detected_at": iso(datetime.now(timezone.utc)),
                                                                          "offline_since": iso(deadline)})
            return journey_row(connection, str(row["journey_id"]))
    return row


def start(user_id):
    if not user_id or not user_id.strip() or len(user_id) > 200:
        raise StateError(422, "user_id must contain between 1 and 200 characters")
    with get_engine().begin() as c:
        # Numeric IDs must identify an existing account. Device strings keep their
        # identity without inventing users or violating the foreign key.
        internal_id = None
        if user_id.isascii() and user_id.isdecimal():
            internal_id = c.execute(text("SELECT id_usuario FROM usuarios WHERE id_usuario::text=:id"), {"id": user_id}).scalar()
            if internal_id is None:
                raise StateError(422, "Unknown user_id")
        key = str(uuid4())
        row = c.execute(text("""INSERT INTO viajes(journey_id,id_usuario,user_id,estado,inicio_viaje)
            VALUES (:id,:internal,:external,'ACTIVE',timezone('UTC',clock_timestamp())) RETURNING *"""),
            {"id": key, "internal": internal_id, "external": user_id}).mappings().one()
        result = journey_dict(row)
        event(c, key, "JOURNEY_STARTED", result)
    return result


def get_journey(journey_id):
    with get_engine().begin() as c:
        row = expire_connection(c, journey_row(c, journey_id, lock=True))
        return journey_dict(row) if row else None


def stop(journey_id):
    with get_engine().begin() as c:
        row = journey_row(c, journey_id, lock=True)
        if not row:
            return None
        if row["estado"] in {"ACTIVE", "EN_CURSO"}:
            row = c.execute(text("""UPDATE viajes SET estado='COMPLETED',online=false,
                fin_viaje=timezone('UTC',clock_timestamp()),updated_at=clock_timestamp()
                WHERE journey_id=:id RETURNING *"""), {"id": row["journey_id"]}).mappings().one()
            event(c, str(row["journey_id"]), "JOURNEY_COMPLETED", journey_dict(row))
        return journey_dict(row)


def risk_row(c, journey_id):
    # Standalone set_risk_status calls also survive restarts through events.
    row = c.execute(text("""
        SELECT risk FROM (
          SELECT jsonb_build_object('status',risk_status,'score',risk_score,
            'reasons',risk_reasons,'updated_at',creado_en) AS risk, creado_en AS at
          FROM telemetria WHERE journey_id=:id
          UNION ALL
          SELECT payload->'risk',created_at FROM eventos_viaje
          WHERE journey_id=:id AND event_type='RISK_STATUS_CHANGED'
        ) history ORDER BY at DESC LIMIT 1
    """), {"id": journey_id}).scalar()
    if row:
        row["updated_at"] = iso(datetime.fromisoformat(row["updated_at"]))
    return row


def get_risk(journey_id):
    if not identifier(journey_id):
        return None
    with get_engine().connect() as c:
        return risk_row(c, journey_id)


def set_risk(journey_id, status):
    if status not in {"NORMAL", "PRECAUTION", "ALERT", "CRITICAL"}:
        raise StateError(422, "Invalid risk status")
    with get_engine().begin() as c:
        row = journey_row(c, journey_id, lock=True)
        if not row:
            raise StateError(404, "Journey not found")
        previous = risk_row(c, journey_id)
        if previous and previous["status"] == status:
            return previous
        risk = dict(status=status, score=None, reasons=[], updated_at=iso(datetime.now(timezone.utc)))
        event(c, journey_id, "RISK_STATUS_CHANGED", {"previous_status": previous["status"] if previous else None, "risk": risk})
        return risk


def command_dict(row):
    result = dict(row)
    result.pop("id_usuario", None)
    for key in ("command_id", "journey_id"):
        result[key] = str(result[key])
    for key in ("created_at", "updated_at"):
        result[key] = iso(result[key])
    return result


def insert_command(c, journey, action, value):
    row = c.execute(text("""INSERT INTO comandos(command_id,journey_id,id_usuario,user_id,action,value,status)
        VALUES(:id,:journey,:internal,:user,:action,CAST(:value AS jsonb),'SENT') RETURNING *"""),
        dict(id=str(uuid4()), journey=journey["journey_id"], internal=journey["id_usuario"],
             user=journey["user_id"], action=action, value=json.dumps(value))).mappings().one()
    command = command_dict(row)
    event(c, command["journey_id"], "COMMAND_SENT", command)
    return command


def create_command(journey_id, user_id, action, value):
    with get_engine().begin() as c:
        journey = journey_row(c, journey_id, lock=True)
        validate_active(journey, user_id)
        return insert_command(c, journey, action, value)


def get_command(command_id):
    if not identifier(command_id):
        return None
    with get_engine().connect() as c:
        row = c.execute(text("SELECT * FROM comandos WHERE command_id=:id"), {"id": command_id}).mappings().first()
        return command_dict(row) if row else None


def pending_commands(journey_id):
    # Compatibility for the existing WebSocket import; MVP commands live in RAM.
    from app.services.command_state import commands

    return [command.copy() for command in list(commands.values())
            if command["journey_id"] == journey_id
            and command["status"] in {"SENT", "RECEIVED", "EXECUTING"}]


def update_command(command_id, status, message):
    if not identifier(command_id):
        return None
    ranks = {"SENT": 0, "RECEIVED": 1, "EXECUTING": 2, "EXECUTED": 3, "FAILED": 3}
    if status not in ranks or status == "SENT":
        raise StateError(400, "Invalid ACK status")
    with get_engine().begin() as c:
        row = c.execute(text("SELECT * FROM comandos WHERE command_id=:id FOR UPDATE"), {"id": command_id}).mappings().first()
        if not row:
            return None
        if row["status"] == status:
            return command_dict(row)  # Network retries are idempotent.
        if ranks[status] < ranks[row["status"]] or row["status"] in {"EXECUTED", "FAILED"}:
            raise StateError(409, "Command has already advanced beyond this ACK")
        previous = row["status"]
        row = c.execute(text("""UPDATE comandos SET status=:status,message=:message,
            updated_at=clock_timestamp() WHERE command_id=:id RETURNING *"""),
            dict(id=command_id, status=status, message=message)).mappings().one()
        command = command_dict(row)
        event(c, command["journey_id"], "COMMAND_ACK", {**command, "previous_status": previous})
        return command


def latest_location(journey_id):
    with get_engine().connect() as c:
        row = c.execute(text("""SELECT latitude,longitude,accuracy,timestamp,creado_en
           FROM telemetria WHERE journey_id=:id ORDER BY timestamp DESC,id_telemetria DESC LIMIT 1"""),
           {"id": journey_id}).mappings().first()
        if row:
            return dict(latitude=row["latitude"], longitude=row["longitude"], accuracy=row["accuracy"],
                        timestamp=iso(row["timestamp"]), updated_at=iso(row["creado_en"]))


def record_telemetry(data, risk):
    """Persist packet, transition, alert and automatic command in one transaction."""
    with get_engine().begin() as c:
        row = journey_row(c, data["journey_id"], lock=True)
        validate_active(row, data["user_id"])
        row = expire_connection(c, row)
        previous = risk_row(c, data["journey_id"])
        previous_status = previous["status"] if previous else None
        received_at = c.execute(text("""INSERT INTO telemetria(journey_id,id_usuario,user_id,latitude,
           longitude,accuracy,speed,heading,battery,latency_ms,packet_loss,network_status,
           route_deviation_m,risk_score,risk_status,risk_reasons,timestamp)
           VALUES(:journey_id,:id_usuario,:user_id,:latitude,:longitude,:accuracy,:speed,:heading,
           :battery,:latency_ms,:packet_loss,:network_status,:route_deviation_m,:risk_score,
           :risk_status,CAST(:risk_reasons AS jsonb),:timestamp) RETURNING creado_en"""),
           {**data, "id_usuario": row["id_usuario"], "risk_reasons": json.dumps(risk["reasons"])}).scalar_one()
        if not row["online"]:
            event(c, data["journey_id"], "CONNECTION_RESTORED", {"last_telemetry_at": iso(received_at)})
        c.execute(text("""UPDATE viajes SET last_telemetry_at=:received,online=true,updated_at=clock_timestamp(),
            origen_lat=COALESCE(origen_lat,:latitude),origen_lon=COALESCE(origen_lon,:longitude)
            WHERE journey_id=:journey_id"""), {**data, "received": received_at})
        command = None
        if previous_status != risk["status"]:
            event(c, data["journey_id"], "RISK_STATUS_CHANGED",
                  {"previous_status": previous_status, "risk": {**risk, "updated_at": iso(received_at)}})
            if risk["status"] in {"PRECAUTION", "ALERT", "CRITICAL"}:
                c.execute(text("""INSERT INTO alertas(id_viaje,tipo_alerta,nivel_gravedad,
                    lat_incidente,lon_incidente,telemetria_snapshot)
                    VALUES(:id,:status,:status,:latitude,:longitude,CAST(:snapshot AS jsonb))"""),
                    dict(id=row["id_viaje"], status=risk["status"], latitude=data["latitude"],
                         longitude=data["longitude"], snapshot=json.dumps(data)))
            # Same actions/thresholds as the existing API; no new risk rules.
            action = {"PRECAUTION": ("SET_TELEMETRY_RATE", 1), "ALERT": ("REQUEST_CHECK_IN", None),
                      "CRITICAL": ("EMERGENCY_MODE", None)}.get(risk["status"])
            if risk["status"] == "NORMAL" and previous_status not in {None, "NORMAL"}:
                action = ("SET_TELEMETRY_RATE", 5)
            if action:
                command = insert_command(c, row, *action)
    return command
