"""Consultas parametrizadas sobre las tres tablas existentes."""
from sqlalchemy import text


def conflicts(connection, request):
    params = {"email": request.email, "telefono": request.telefono,
              "tutor_email": request.tutor.email, "tutor_telefono": request.tutor.telefono}
    # regexp_replace permite detectar teléfonos antiguos con espacios o +.
    return connection.execute(text("""
        SELECT
          EXISTS(SELECT 1 FROM usuarios WHERE lower(email) = :email) AS user_email,
          EXISTS(SELECT 1 FROM usuarios WHERE regexp_replace(telefono, '[^0-9]', '', 'g') = :telefono) AS user_phone,
          EXISTS(SELECT 1 FROM tutores WHERE lower(email) = :tutor_email) AS tutor_email,
          EXISTS(SELECT 1 FROM tutores WHERE regexp_replace(telefono, '[^0-9]', '', 'g') = :tutor_telefono) AS tutor_phone
    """), params).mappings().one()


def insert_registration(connection, request, password_hash):
    user_id = connection.execute(text("""
        INSERT INTO usuarios (nombre_completo, telefono, email, password_hash)
        VALUES (:nombre, :telefono, :email, :password_hash)
        RETURNING id_usuario
    """), {"nombre": request.nombre_completo, "telefono": request.telefono,
           "email": request.email, "password_hash": password_hash}).scalar_one()
    tutor_id = connection.execute(text("""
        INSERT INTO tutores (nombre_completo, telefono, email)
        VALUES (:nombre, :telefono, :email) RETURNING id_tutor
    """), {"nombre": request.tutor.nombre_completo, "telefono": request.tutor.telefono,
           "email": request.tutor.email}).scalar_one()
    # IDs, fechas y permisos se generan/defaultan en PostgreSQL.
    connection.execute(text("""
        INSERT INTO usuarios_tutores (id_usuario, id_tutor, relacion)
        VALUES (:user_id, :tutor_id, :relacion)
    """), {"user_id": user_id, "tutor_id": tutor_id, "relacion": request.tutor.relacion})


def find_user(connection, email):
    return connection.execute(text("""
        SELECT id_usuario, nombre_completo, email, telefono, password_hash
        FROM usuarios WHERE lower(email) = :email
    """), {"email": email}).mappings().all()


def find_tutors(connection, user_id):
    return connection.execute(text("""
        SELECT t.id_tutor, t.nombre_completo, t.email, t.telefono, ut.relacion
        FROM tutores t JOIN usuarios_tutores ut ON ut.id_tutor = t.id_tutor
        WHERE ut.id_usuario = :user_id ORDER BY t.id_tutor
    """), {"user_id": user_id}).mappings().all()


def find_user_by_id(connection, user_id):
    return connection.execute(text("""
        SELECT id_usuario, nombre_completo, email
        FROM usuarios WHERE id_usuario = :user_id
    """), {"user_id": user_id}).mappings().first()
