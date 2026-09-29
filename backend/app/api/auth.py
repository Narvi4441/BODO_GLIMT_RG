from fastapi import APIRouter
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from app.schemas.auth import LoginRequest, RegisterRequest
from app.services import auth as service


class AuthRoute(APIRoute):
    """Errores de cuentas consistentes, sin devolver inputs/contraseñas."""
    def get_route_handler(self):
        original = super().get_route_handler()

        async def handler(request):
            try:
                response = await original(request)
            except RequestValidationError as error:
                errors = {}
                for item in error.errors():
                    field = ".".join(str(part) for part in item["loc"] if part != "body")
                    message = item["msg"].removeprefix("Value error, ")
                    if item["type"] == "missing":
                        message = "Este campo es obligatorio."
                    elif item["type"] == "extra_forbidden":
                        message = "Este campo no está permitido."
                    elif item["type"] in {"too_short", "string_too_short"}:
                        message = "La contraseña debe tener al menos 8 caracteres." if field == "password" and request.url.path.endswith("register") else "Este campo es obligatorio."
                    elif item["type"] in {"too_long", "string_too_long"}:
                        message = "La contraseña debe tener como máximo 128 caracteres."
                    elif item["type"] in {"json_invalid", "model_attributes_type", "string_type"}:
                        message = "Revisa el formato de los datos enviados."
                    errors.setdefault(field, message)
                response = JSONResponse(status_code=422, content={"success": False, "message": next(iter(errors.values())), "errors": errors})
            except service.AuthError as error:
                response = JSONResponse(status_code=error.status, content={"success": False, "message": error.message, "errors": error.errors})
            response.headers["Cache-Control"] = "no-store"
            return response
        return handler


router = APIRouter(prefix="/api/auth", tags=["Auth"], route_class=AuthRoute)


@router.post("/register", status_code=201)
def register(request: RegisterRequest):
    return service.register(request)


@router.post("/login")
def login(request: LoginRequest):
    return service.login(request)
