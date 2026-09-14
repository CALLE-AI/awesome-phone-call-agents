FROM python:3.10-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the medops_call_commander package as a top-level importable package.
COPY medops_call_commander /app/medops_call_commander

# The package is imported as medops_call_commander.* (not apps.python.*),
# matching this Dockerfile's WORKDIR and the local dev instructions in
# ../README.md. Setting PYTHONPATH=/app makes `medops_call_commander` importable.
ENV PYTHONPATH=/app

CMD ["uvicorn", "medops_call_commander.server:app", "--host", "0.0.0.0", "--port", "10000"]
