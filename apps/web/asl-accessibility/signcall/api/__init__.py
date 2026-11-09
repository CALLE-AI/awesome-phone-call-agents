"""
The HTTP layer. The frontend (../asl-recognition) POSTs its user-input JSON
here and polls for the result.

Deliberately thin: validation is workflow/user_input.py's job and the run is
workflow/appointment.py's. This package only turns HTTP requests into calls to
those, and nothing in the workflow knows it is being driven over HTTP.
"""
