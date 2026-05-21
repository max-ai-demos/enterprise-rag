class PDFProcessingError(Exception):
    """Raised when PDF parsing or processing fails."""


class DatalabConnectionError(Exception):
    """Raised on network or HTTP errors communicating with the Datalab API."""


class DatalabTimeoutError(Exception):
    """Raised when Datalab polling exceeds the configured timeout."""
