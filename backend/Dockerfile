FROM python:3.12-slim AS base

WORKDIR /app

# Install system deps for lxml + playwright.
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      libxml2 \
      libxslt1.1 \
      gcc \
      pkg-config \
      libffi-dev \
      && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Optional playwright chromium — install only if the image will run with JS pages.
# RUN pip install playwright && \
#     playwright install --with-deps chromium

COPY . /app

EXPOSE 8010

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8010/health')" || exit 1

CMD ["uvicorn", "extractor.main:app", "--host", "0.0.0.0", "--port", "8010", "--log-level", "info"]
