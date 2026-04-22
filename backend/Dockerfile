FROM python:3.11-slim

WORKDIR /app

# Install system dependencies (none needed for PyMySQL)
# But we keep build tools for any package compilation
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Create media directory with proper permissions
RUN mkdir -p /app/media && chmod 777 /app/media

EXPOSE 8000