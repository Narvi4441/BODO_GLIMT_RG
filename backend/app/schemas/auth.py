import re
from typing import Annotated
from email_validator import EmailNotValidError, validate_email
from pydantic import BaseModel, ConfigDict, Field, SecretStr, AfterValidator, field_validator


def name(value: str) -> str:
    value = value.strip()
    if not value:
        raise ValueError("El nombre es obligatorio.")
    if len(value) > 150:
        raise ValueError("El nombre debe tener como máximo 150 caracteres.")
    return value


def phone(value: str) -> str:
    value = value.strip()
    if not re.fullmatch(r"\+?[0-9 ()\-.]+", value):
        raise ValueError("Ingresa un teléfono válido.")
    digits = re.sub(r"[^0-9]", "", value)
    if not 10 <= len(digits) <= 15:
        raise ValueError("Ingresa un teléfono válido de 10 a 15 dígitos.")
    return digits


def email(value: str) -> str:
    try:
        value = validate_email(value.strip(), check_deliverability=False).normalized.lower()
    except EmailNotValidError:
        raise ValueError("Ingresa un correo electrónico válido.") from None
    if len(value) > 100:
        raise ValueError("El correo debe tener como máximo 100 caracteres.")
    return value


Name = Annotated[str, AfterValidator(name)]
Phone = Annotated[str, AfterValidator(phone)]
Email = Annotated[str, AfterValidator(email)]


class AuthModel(BaseModel):
    # No aceptar roles, IDs, permisos ni atributos inesperados desde el cliente.
    model_config = ConfigDict(extra="forbid")


class TutorRequest(AuthModel):
    nombre_completo: Name
    telefono: Phone
    email: Email
    relacion: str

    @field_validator("relacion")
    @classmethod
    def relationship(cls, value):
        value = value.strip()
        if not value or len(value) > 50:
            raise ValueError("Indica la relación con el usuario (máximo 50 caracteres).")
        return value


class RegisterRequest(AuthModel):
    nombre_completo: Name
    telefono: Phone
    email: Email
    password: SecretStr = Field(min_length=8, max_length=128)
    confirm_password: SecretStr = Field(min_length=1, max_length=128)
    tutor: TutorRequest

    @field_validator("password")
    @classmethod
    def password_not_blank(cls, value):
        if not value.get_secret_value().strip():
            raise ValueError("La contraseña no puede contener solo espacios.")
        return value

    @field_validator("confirm_password")
    @classmethod
    def matching_password(cls, value, info):
        password = info.data.get("password")
        if password and value.get_secret_value() != password.get_secret_value():
            raise ValueError("Las contraseñas no coinciden.")
        return value


class LoginRequest(AuthModel):
    email: Email
    password: SecretStr = Field(min_length=1, max_length=128)
