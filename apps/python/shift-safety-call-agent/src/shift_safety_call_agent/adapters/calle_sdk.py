"""Lazy, read-only inspection of the optional CALL-E SDK package."""

from collections.abc import Callable
from dataclasses import dataclass
from importlib import import_module
from importlib.metadata import PackageNotFoundError, version as distribution_version

CALLE_DISTRIBUTION = "calle-ai"
CALLE_IMPORT_NAME = "calle"
SUPPORTED_CALLE_SDK_VERSION = "0.6.0"


class CalleSdkInspectionError(RuntimeError):
    """Base error for safe, local-only SDK inspection failures."""


class UnsupportedCalleSdkVersionError(CalleSdkInspectionError):
    """Raised when the installed optional SDK is not the audited version."""


class CalleSdkImportError(CalleSdkInspectionError):
    """Raised when matching distribution metadata cannot be imported safely."""


@dataclass(frozen=True, slots=True)
class CalleSdkInfo:
    """Non-sensitive facts discovered without constructing a client."""

    installed: bool
    distribution: str
    version: str | None
    import_name: str
    client_class_available: bool


def inspect_calle_sdk(
    *,
    version_reader: Callable[[str], str] = distribution_version,
    module_loader: Callable[[str], object] = import_module,
) -> CalleSdkInfo:
    """Inspect the pinned SDK lazily without reading configuration or creating a client."""

    try:
        installed_version = version_reader(CALLE_DISTRIBUTION)
    except PackageNotFoundError:
        return CalleSdkInfo(
            installed=False,
            distribution=CALLE_DISTRIBUTION,
            version=None,
            import_name=CALLE_IMPORT_NAME,
            client_class_available=False,
        )

    if installed_version != SUPPORTED_CALLE_SDK_VERSION:
        raise UnsupportedCalleSdkVersionError("Installed CALL-E SDK version is not approved")

    try:
        module = module_loader(CALLE_IMPORT_NAME)
    except ImportError:
        raise CalleSdkImportError("Approved CALL-E SDK distribution could not be imported") from None

    if not isinstance(getattr(module, "CalleClient", None), type):
        raise CalleSdkImportError("Approved CALL-E SDK client class is unavailable")

    return CalleSdkInfo(
        installed=True,
        distribution=CALLE_DISTRIBUTION,
        version=installed_version,
        import_name=CALLE_IMPORT_NAME,
        client_class_available=True,
    )
