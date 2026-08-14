FROM python:3.10-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the medops_call_commander package as a module
COPY medops_call_commander /app/apps/python/medops_call_commander

# The medops_call_commander is imported as apps.python.medops_call_commander
ENV PYTHONPATH=/app

CMD ["uvicorn", "apps.python.medops_call_commander.server:app", "--host", "0.0.0.0", "--port", "10000"]
