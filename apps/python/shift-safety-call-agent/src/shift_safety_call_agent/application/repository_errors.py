"""Safe repository errors shared by persistence adapters and the CLI."""


class RepositoryError(RuntimeError):
    """Base class for persistence failures safe to present without raw data."""


class DatabaseInitializationError(RepositoryError):
    """The local database could not be initialized safely."""


class UnsupportedSchemaVersionError(DatabaseInitializationError):
    """The database schema is newer than this application supports."""


class DuplicateInterviewError(RepositoryError):
    """A save attempted to overwrite an existing interview identifier."""


class InterviewNotFoundError(RepositoryError):
    """A requested interview does not exist."""


class RepositoryDataError(RepositoryError):
    """Stored data does not satisfy the current domain contract."""


class RepositoryOperationError(RepositoryError):
    """A repository operation failed without exposing storage details."""
