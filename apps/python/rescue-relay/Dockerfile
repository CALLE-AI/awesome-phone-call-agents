FROM python:3.13-slim
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
# Include every local module used by the coordinator and app.
COPY *.py ./
COPY static ./static
RUN mkdir -p /data
ENV HOST=0.0.0.0 PORT=8000 DATABASE_PATH=/data/rescue_relay.db CALL_MODE=mock ENABLE_LIVE_CALLS=false DEFAULT_CURRENCY=USD
EXPOSE 8000
CMD ["python", "run.py"]
