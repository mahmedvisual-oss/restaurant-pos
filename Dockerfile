FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 5002

CMD ["sh", "-c", "gunicorn --timeout 120 --workers 1 --threads 4 --bind 0.0.0.0:${PORT:-5002} app:app"]
