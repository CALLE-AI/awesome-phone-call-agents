FROM python:3.12-slim
WORKDIR /app
COPY pyproject.toml README.md ./
COPY crc ./crc
COPY static ./static
COPY fixtures ./fixtures
RUN pip install --no-cache-dir -e .
ENV CRC_DATA_DIR=/tmp/crc PORT=8080
CMD ["sh", "-c", "uvicorn crc.app:app --host 0.0.0.0 --port ${PORT}"]
