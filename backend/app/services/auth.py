import logging
from sqlalchemy.exc import SQLAlchemyError, IntegrityError
from app.core.database import DatabaseNotConfigured, get_engine
from app.core.passwords import hash_password, verify_password
from app.services import auth_repository as repository

logger = logging.getLogger(__name__)
CONFLICTS = {
    "user_email": ("email", "Este correo ya está registrado."),
    "user_phone": ("telefono", "Este teléfono ya está registrado."),
    "tutor_email": ("tutor.email", "El correo del tutor ya está registrado."),
    "tutor_phone": ("tutor.telefono", "El teléfono del tutor ya está registrado."),
}


class AuthError(Exception):
    def __init__(self, status, message, errors=None):
        self.status, self.message, self.errors = status, message, errors or {}


def raise_conflict(found):
    errors = {field: message for key, (field, message) in CONFLICTS.items() if found[key]}
    if errors:
        raise AuthError(409, next(iter(errors.values())), errors)


def database_error(error):
    # No registrar consultas, contraseñas, DSN ni datos personales en errores.
    logger.warning("Fallo de acceso a PostgreSQL: %s", type(error).__name__)
    return AuthError(503, "El servicio de cuentas no está disponible. Verifica la conexión y la migración de PostgreSQL.")


def register(request):
    password_hash = hash_password(request.password.get_secret_value())
    try:
        engine = get_engine()
        with engine.begin() as connection:
            raise_conflict(repository.conflicts(connection, request))
            repository.insert_registration(connection, request, password_hash)
    except IntegrityError as error:
        # La transacción anterior ya fue revertida, incluso si falló el tutor/vínculo.
        # UNIQUE resuelve también carreras entre solicitudes concurrentes.
        if getattr(error.orig, "pgcode", None) == "23505":
            try:
                with engine.connect() as connection:
                    raise_conflict(repository.conflicts(connection, request))
            except SQLAlchemyError as lookup_error:
                raise database_error(lookup_error) from None
            raise AuthError(409, "El correo o teléfono ya está registrado.") from None
        raise database_error(error) from None
    except (SQLAlchemyError, DatabaseNotConfigured, UnicodeDecodeError) as error:
        raise database_error(error) from None
    return {"success": True, "message": "Usuario registrado correctamente"}


def login(request):
    try:
        with get_engine().connect() as connection:
            rows = repository.find_user(connection, request.email)
            # Si hay cuentas antiguas ambiguas por mayúsculas, no elegir una al azar.
            user = rows[0] if len(rows) == 1 else None
            if not verify_password(request.password.get_secret_value(), user["password_hash"] if user else None):
                raise AuthError(401, "Correo o contraseña incorrectos.")
            public_user = {key: user[key] for key in ("id_usuario", "nombre_completo", "email", "telefono")}
            tutors = [dict(row) for row in repository.find_tutors(connection, user["id_usuario"])]
    except (SQLAlchemyError, DatabaseNotConfigured, UnicodeDecodeError) as error:
        raise database_error(error) from None
    return {"success": True, "message": "Credenciales verificadas correctamente",
            "usuario": public_user, "tutores": tutors}
