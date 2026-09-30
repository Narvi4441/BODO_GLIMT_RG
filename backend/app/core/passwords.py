"""Hashes Argon2id con salt aleatorio; nunca comparar contraseñas en SQL."""
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

hasher = PasswordHasher()
# Evita devolver inmediatamente cuando el correo no existe o no tiene hash.
_dummy_hash = hasher.hash("guardian-dummy-not-an-account")


def hash_password(password: str) -> str:
    return hasher.hash(password)


def verify_password(password: str, stored_hash: str | None) -> bool:
    try:
        valid = hasher.verify(stored_hash or _dummy_hash, password)
        return bool(stored_hash) and valid
    except (VerificationError, InvalidHashError):
        return False
