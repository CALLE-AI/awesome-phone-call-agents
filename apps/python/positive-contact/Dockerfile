FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PC_DEMO_DB=/tmp/positive-contact-demo.db

WORKDIR /app
COPY . .
RUN pip install --no-cache-dir .

EXPOSE 8000
CMD ["sh", "-c", "uvicorn positive_contact.deploy:app --host 0.0.0.0 --port ${PORT:-8000}"]
