"""Stateless access tokens for the existing authentication endpoints."""
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import HTTPException

from app.core.config import Config


def jwt_secret():
    if not Config.JWT_SECRET or len(Config.JWT_SECRET.encode("utf-8")) < 32:
        raise HTTPException(503, "El servicio de autenticación no está configurado.")
    return Config.JWT_SECRET


def create_access_token(user_id: int) -> str:
    return jwt.encode(
        {"sub": str(user_id), "exp": datetime.now(timezone.utc)
         + timedelta(minutes=Config.JWT_EXPIRE_MINUTES)},
        jwt_secret(), algorithm="HS256",
    )


def token_user_id(token: str) -> int:
    try:
        claims = jwt.decode(token, jwt_secret(), algorithms=["HS256"],
                            options={"require": ["sub", "exp"]})
        subject = claims["sub"]
        if not isinstance(subject, str) or not subject.isascii() or not subject.isdecimal():
            raise ValueError("Invalid subject")
        user_id = int(subject)
        if not 0 < user_id <= 2147483647:
            raise ValueError("Invalid user ID")
        return user_id
    except (jwt.InvalidTokenError, ValueError, TypeError, OverflowError):
        raise HTTPException(401, "Sesión inválida o expirada. Inicia sesión de nuevo.",
                            headers={"WWW-Authenticate": "Bearer"}) from None
